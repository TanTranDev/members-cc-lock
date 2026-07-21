// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, toRelpath, stateDir, classifyPath } from './paths.mjs';
import { checkFreshness } from './freshness.mjs';
import { loadConfig, resolveEnabled, isConfigured } from './config.mjs';
import { cloneId, host } from './identity.mjs';
import * as lock from './lock.mjs';

/**
 * Định vị repo + nạp config từ cwd. Không phải git repo ⇒ exit 2 (lệnh người dùng
 * luôn cần một repo để xác định lock-repo/projectKey).
 * @param {string} [cwd]
 * @returns {{root:string, cfg:CcLockConfig}}
 */
function ctx(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  if (!root.ok) {
    console.error('cc-lock: không phải git repo');
    process.exit(2);
  }
  return { root: root.value, cfg: loadConfig(root.value) };
}

/**
 * Ghi cờ enabled cho riêng clone này vào `<stateDir>/cc-lock-local.json`
 * (hỗ trợ linked worktree). MERGE với nội dung cũ — file này còn có thể chứa
 * override per-clone (lockRepoUrl/projectKey), on/off không được xoá chúng.
 * @param {string} root
 * @param {boolean} enabled
 */
function setLocalEnabled(root, enabled) {
  const p = path.join(stateDir(root), 'cc-lock-local.json');
  /** @type {object} */
  let old = {};
  try { old = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* chưa có */ }
  fs.writeFileSync(p, JSON.stringify({ ...old, enabled }, null, 2));
}

/** Đọc toàn bộ stdin (JSON sự kiện hook). @returns {Promise<string>} */
async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * In giờ hết hạn local (HH:MM:SS theo locale) từ epoch giây.
 * @param {number} epochSec
 */
const fmtExpire = (epochSec) => new Date(epochSec * 1000).toLocaleTimeString();

/**
 * PreToolUse hook: đọc JSON {tool_name, cwd, tool_input.file_path} từ stdin.
 * DENY = exit 2 + stderr (cơ chế chặn cứng của PreToolUse trong plan).
 *
 * Pipeline 3 lớp (spec 2026-07-21 §5), chạy sau khi đã qua trơ-toàn-phần:
 *   trơ (chưa config ⇒ exit 0) → lớp 1 escape → lớp 2 freshness → lớp 3 lock CAS.
 * CC_LOCK_BYPASS bỏ qua lớp 1+2 (lớp 3 tự audit qua nhánh bypass của acquire).
 *
 * ALLOW (exit 0) khi: tool ngoài guardedTools, cơ chế tắt, không phải repo, chưa
 * config (trơ), file ngoài repo, freshness fresh/skip/warn, hoặc acquire trả
 * acquired|already-mine|reclaimed|disabled|unconfigured|bypass.
 * DENY (exit 2) khi: symlink-escape, stale-base (freshnessMode=deny),
 * offline-deny (fail-closed), hoặc held/error.
 */
async function hookGuard() {
  /** @type {any} */
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    process.exit(0); // stdin không phải JSON ⇒ không chặn được an toàn ⇒ cho qua
  }
  const tool = input.tool_name;
  const cwd = input.cwd || process.cwd();
  const root = repoRoot(cwd);
  if (!root.ok) process.exit(0);
  const cfg = loadConfig(root.value);
  if (!cfg.guardedTools.includes(tool)) process.exit(0);
  if (!resolveEnabled(root.value, cfg).enabled) process.exit(0);
  // Trơ TOÀN PHẦN khi chưa config: mọi lớp (escape/freshness/lock) đều bỏ qua —
  // fresh clone chưa điền config không bao giờ bị brick (spec 2026-07-21 §5).
  if (!isConfigured(cfg)) process.exit(0);
  const fp = input.tool_input?.file_path;
  if (!fp) process.exit(0);

  // Lớp 1 — symlink-escape (spec §5.1). CC_LOCK_BYPASS bỏ qua lớp 1+2 (vượt rào
  // khẩn cấp — lớp 3 tự audit qua nhánh bypass của acquire).
  const bypass = !!process.env.CC_LOCK_BYPASS;
  const cls = classifyPath(root.value, fp);
  if (cls.kind === 'outside') process.exit(0); // file ngoài repo ⇒ không quản (v1)
  if (cls.kind === 'escape' && !bypass) {
    console.error(
      `⛔ cc-lock SYMLINK-ESCAPE: ${fp}\n` +
        `   → file vật lý: ${cls.realpath} (NGOÀI repo này — thường là repo bộ khung).\n` +
        'Sửa tại repo chứa file thật (mở session ở đó), commit + push để các máy khác pull. ' +
        '⇒ Xử lý theo skill cc-lock-coordination.',
    );
    process.exit(2);
  }
  const rel = cls.kind === 'inside' ? cls.relpath : toRelpath(root.value, fp);
  if (!rel) process.exit(0);

  // Lớp 2 — freshness (advisory, fail-open; spec §5.2)
  if (!bypass && cfg.freshnessMode !== 'off') {
    const f = checkFreshness(cfg, root.value, rel);
    if (f.status === 'stale') {
      if (cfg.freshnessMode === 'deny') {
        console.error(
          `⛔ cc-lock STALE-BASE: ${rel} đã đổi trên ${f.mainline} sau điểm rẽ nhánh của bạn\n` +
            `   (mới nhất: ${f.subject}).\n` +
            `Rebase rồi sửa tiếp:  git fetch origin && git rebase ${f.mainline}\n` +
            'Nhánh feature của CHÍNH session: tự rebase nếu áp SẠCH; có conflict ⇒ dừng, hỏi user. ' +
            '(skill cc-lock-coordination §STALE-BASE)',
        );
        process.exit(2);
      }
      // warn: systemMessage cho user, vẫn cho qua lớp 3
      console.log(JSON.stringify({
        systemMessage: `cc-lock: ${rel} đã đổi trên ${f.mainline} (${f.subject}) — nên rebase trước khi sửa.`,
      }));
    }
  }

  // Lớp 3 — lock CAS (không đổi so với v1)
  const r = lock.acquire(cfg, root.value, rel);
  if (r.status === 'bypass') {
    // Vượt rào khẩn cấp: cho ghi NHƯNG để vết audit qua stderr (không chặn tool,
    // vẫn lưu trong transcript) — spec §14 / README §5. Các ALLOW khác im lặng.
    console.error(`cc-lock: BYPASS ${rel} bởi ${cloneId(root.value)}@${host()}`);
    process.exit(0);
  }
  if (['acquired', 'already-mine', 'reclaimed', 'disabled', 'unconfigured'].includes(r.status)) {
    process.exit(0);
  }
  if (r.status === 'offline-deny') {
    console.error(
      'cc-lock: không kết nối được lock-repo (fail-closed) ⇒ chặn ghi. ' +
        "Đặt CC_LOCK_BYPASS=1 để vượt khẩn cấp, hoặc 'cc-lock off' cho clone này. " +
        '⇒ Xử lý theo skill cc-lock-coordination.',
    );
    process.exit(2);
  }
  // held / error
  const p = r.payload;
  const owner = p ? `${p.owner}@${p.host}` : '?';
  const exp = p ? fmtExpire(p.expires_at) : '?';
  console.error(
    `🔒 ${rel} đang bị giữ bởi ${owner} (hết hạn ~${exp}). ` +
      `Chạy 'cc-lock wait ${rel}' để xếp hàng, hoặc làm file khác. ` +
      `⇒ Xử lý theo skill cc-lock-coordination.`,
  );
  process.exit(2);
}

/**
 * SessionEnd hook: trả tất cả lock của clone hiện tại rồi exit 0.
 * CHỈ gắn vào SessionEnd (kết thúc phiên) — KHÔNG gắn vào Stop (kết thúc mỗi
 * lượt trả lời): khoá phải giữ nguyên giữa các turn của cùng một task; idle quá
 * ttlSec thì khoá tự hết hạn cho clone khác reclaim.
 */
async function hookReleaseAll() {
  const root = repoRoot(process.cwd());
  if (!root.ok) process.exit(0);
  lock.releaseAll(loadConfig(root.value), root.value);
  process.exit(0);
}

/** In held-cache của clone hiện tại (lệnh `mine`). @param {string} root */
function printMine(root) {
  const held = lock.listMine(root);
  held.forEach((e) => console.log(`${e.relpath}\t(hết hạn ${fmtExpire(e.expires_at)})`));
}

/**
 * Parse argv + dispatch.
 * @param {string[]} [argv]
 * @returns {Promise<void>}
 */
export async function main(argv = process.argv.slice(2)) {
  const [cmd, arg] = argv;
  switch (cmd) {
    case 'hook-guard':
      return hookGuard();
    case 'hook-release-all':
      return hookReleaseAll();
    case 'acquire': {
      const { root, cfg } = ctx();
      console.log(JSON.stringify(lock.acquire(cfg, root, arg)));
      break;
    }
    case 'release': {
      const { root, cfg } = ctx();
      console.log(JSON.stringify(lock.release(cfg, root, arg)));
      break;
    }
    case 'release-all': {
      const { root, cfg } = ctx();
      console.log(JSON.stringify(lock.releaseAll(cfg, root)));
      break;
    }
    case 'check': {
      const { root, cfg } = ctx();
      console.log(JSON.stringify(lock.check(cfg, root, arg)));
      break;
    }
    case 'fresh': {
      if (!arg) {
        console.error('usage: cc-lock fresh <relpath>');
        process.exit(2);
      }
      const { root, cfg } = ctx();
      // ép mode ≠ off để lệnh probe luôn trả lời thật (kể cả repo tắt freshness).
      // arg = relpath cần soi (khớp help `[relpath]`); env truyền tường minh.
      console.log(
        JSON.stringify(checkFreshness({ ...cfg, freshnessMode: 'deny' }, root, arg, process.env)),
      );
      break;
    }
    case 'renew': {
      const { root, cfg } = ctx();
      console.log(JSON.stringify(lock.renew(cfg, root, arg)));
      break;
    }
    case 'wait': {
      const { root, cfg } = ctx();
      console.log(JSON.stringify(await lock.wait(cfg, root, arg)));
      break;
    }
    case 'gc': {
      const { root, cfg } = ctx();
      console.log(JSON.stringify(lock.gc(cfg, root)));
      break;
    }
    case 'mine': {
      const { root } = ctx();
      printMine(root);
      break;
    }
    case 'list': {
      const { cfg } = ctx();
      const r = lock.list(cfg);
      r.locks.forEach((p) =>
        console.log(`${p.relpath}\t${p.owner}@${p.host}\t(hết hạn ${fmtExpire(p.expires_at)})`),
      );
      console.log(JSON.stringify({ status: r.status, count: r.locks.length }));
      break;
    }
    case 'on': {
      const { root } = ctx();
      setLocalEnabled(root, true);
      console.log('cc-lock: ON (clone này)');
      break;
    }
    case 'off': {
      const { root } = ctx();
      setLocalEnabled(root, false);
      console.log('cc-lock: OFF (clone này)');
      break;
    }
    case 'status': {
      const { root, cfg } = ctx();
      const e = resolveEnabled(root, cfg);
      if (!isConfigured(cfg)) {
        const why = cfg.projectKey === 'auto'
          ? 'projectKey "auto" không derive được (repo không có remote origin?)'
          : 'lockRepoUrl/projectKey chưa cấu hình';
        console.log(`active: false (${why} — cc-lock đang trơ, mọi edit được phép)`);
      } else {
        console.log(`active: ${e.enabled}`);
      }
      console.log(`enabled: ${e.enabled} (source: ${e.source})`);
      console.log(
        `lockRepo: ${cfg.lockRepoUrl || '(chưa cấu hình)'}  project: ${cfg.projectKey}` +
          ` (nguồn: ${cfg.projectKeySource === 'auto' ? 'auto ← origin' : cfg.projectKeySource})`,
      );
      console.log(`freshness: ${cfg.freshnessMode} (mainline: ${cfg.mainlineRef})`);
      console.log(`clone: ${cloneId(root)}`); // để so với owner khi bị DENY (skill B0)
      break;
    }
    case 'init': {
      const { root, cfg } = ctx();
      console.log(JSON.stringify(lock.init(cfg, root)));
      break;
    }
    default:
      console.log(
        'cc-lock <acquire|release|release-all|check|fresh|renew|wait|list|mine|gc|on|off|status|init> [relpath]',
      );
  }
}
