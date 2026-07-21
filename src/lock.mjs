// @ts-check
import path from 'node:path';
import os from 'node:os';
import { nowSec } from './clock.mjs';
import * as git from './git.mjs';
import { refName } from './paths.mjs';
import { cloneId, host, session } from './identity.mjs';
import { resolveEnabled, isConfigured } from './config.mjs';
import { readHeld, upsertHeld, removeHeld } from './heldCache.mjs';

/**
 * Kết quả của một thao tác lock. `status` là discriminant; `payload`/`message`
 * chỉ có ở một số nhánh nên để optional.
 * @typedef {{status:string,payload?:LockPayload,message?:string,count?:number,removed?:number}} LockResult
 */

/**
 * Thư mục mirror bare cục bộ cho lock-repo (dùng chung mọi clone cùng projectKey
 * trên máy này). Mặc định ~/.cache/cc-lock để không lọt vào working tree; có thể
 * override qua env `CC_LOCK_CACHE_DIR` (đổi nơi cache; cũng để test cô lập tmp).
 * Đọc thẳng từ `process.env` vì cache-dir là cấu hình ở cấp process, không phải
 * tham số per-call như env FAKE_NOW/CC_LOCK truyền xuống từng thao tác lock.
 * @param {CcLockConfig} cfg
 * @returns {string}
 */
const mirrorDir = (cfg) => {
  const base = process.env.CC_LOCK_CACHE_DIR || path.join(os.homedir(), '.cache', 'cc-lock');
  return path.join(base, `${cfg.projectKey}.git`);
};

/**
 * Áp dụng offline policy: fail-open ⇒ cho qua (acquired), fail-closed ⇒ chặn.
 * @param {CcLockConfig} cfg
 * @returns {LockResult}
 */
const offline = (cfg) =>
  cfg.offlinePolicy === 'fail-open' ? { status: 'acquired' } : { status: 'offline-deny' };

/**
 * Dựng payload mới cho clone hiện tại tại thời điểm `now`.
 * @param {CcLockConfig} cfg
 * @param {string} repoRoot
 * @param {string} relpath
 * @param {number} now
 * @param {NodeJS.ProcessEnv} env
 * @returns {LockPayload}
 */
function makePayload(cfg, repoRoot, relpath, now, env) {
  return {
    relpath,
    owner: cloneId(repoRoot),
    host: host(),
    pid: process.pid,
    session: session(env),
    acquired_at: now,
    expires_at: now + cfg.ttlSec,
    renewed_at: now,
  };
}

/**
 * Cố gắng giữ lock cho `relpath`.
 *
 * Trình tự:
 *  1. disabled / bypass ⇒ trả ngay, KHÔNG chạm lock-repo.
 *  2. Fast-path: file đang là của mình trong held-cache & còn hạn ⇒ already-mine
 *     (0 round-trip mạng; renew nền nếu sắp tới hạn heartbeat).
 *  3. ref trống ⇒ pushCreate (CAS must-not-exist).
 *  4. ref đã có ⇒ occupied(): của mình / stale (reclaim) / held.
 *
 * Mọi lỗi mạng/server từ git.* trả Err ⇒ áp offline policy (fail-closed mặc định
 * ⇒ offline-deny) để không bao giờ cho ghi khi không xác minh được lock.
 *
 * @param {CcLockConfig} cfg
 * @param {string} repoRoot
 * @param {string} relpath
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {LockResult}
 */
export function acquire(cfg, repoRoot, relpath, env = process.env) {
  if (!resolveEnabled(repoRoot, cfg, env).enabled) return { status: 'disabled' };
  // Chưa điền lockRepoUrl thật (rỗng/placeholder) ⇒ cc-lock trơ: trả TRƯỚC mọi
  // thao tác git để không chạm mạng và không brick clone mới (xem isConfigured).
  if (!isConfigured(cfg)) return { status: 'unconfigured' };
  if (env.CC_LOCK_BYPASS) return { status: 'bypass' };

  const now = nowSec(env);
  const ref = refName(cfg, relpath);
  const me = cloneId(repoRoot);

  // Fast-path: lock đang là của mình và còn hạn (đã trừ skew) ⇒ không cần mạng.
  const mine = readHeld(repoRoot).find((e) => e.relpath === relpath);
  if (mine && mine.expires_at > now + cfg.skewSec) {
    // Sắp tới hạn heartbeat ⇒ renew nền. Defense-in-depth chống clock-skew: nếu
    // renew báo lock đã KHÔNG còn của mình (remote bị reclaim/xoá), KHÔNG khẳng
    // định already-mine — dọn held-cache và rơi xuống slow-path xác minh lại.
    if (mine.expires_at - now < cfg.heartbeatSec) {
      const r = renew(cfg, repoRoot, relpath, env);
      if (r.status === 'lost' || r.status === 'not-held') {
        removeHeld(repoRoot, relpath);
      } else {
        return { status: 'already-mine' };
      }
    } else {
      return { status: 'already-mine' };
    }
  }

  const md = git.ensureMirror(cfg, mirrorDir(cfg));
  if (!md.ok) return offline(cfg);
  const cur = git.lsRemoteRef(cfg, ref);
  if (!cur.ok) return offline(cfg);

  if (cur.value == null) {
    const payload = makePayload(cfg, repoRoot, relpath, now, env);
    const sha = git.commitPayload(md.value, payload);
    if (!sha.ok) return { status: 'error', message: sha.error };
    const r = git.pushCreate(cfg, md.value, ref, sha.value);
    if (!r.ok) return offline(cfg);
    if (r.value === 'created') {
      upsertHeld(repoRoot, { relpath, ref, sha: sha.value, expires_at: payload.expires_at });
      return { status: 'acquired' };
    }
    // 'exists': clone khác chen ngang giữa ls-remote và push ⇒ xử như occupied.
    return occupied(cfg, repoRoot, relpath, ref, md.value, now, me, env);
  }
  return occupied(cfg, repoRoot, relpath, ref, md.value, now, me, env, cur.value);
}

/**
 * Xử lý khi ref đã tồn tại: đọc payload, phân loại của-mình / stale / held.
 * @param {CcLockConfig} cfg
 * @param {string} repoRoot
 * @param {string} relpath
 * @param {string} ref
 * @param {string} md mirrorDir
 * @param {number} now
 * @param {string} me cloneId hiện tại
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [knownSha] sha đã biết (tránh ls-remote lần 2)
 * @returns {LockResult}
 */
function occupied(cfg, repoRoot, relpath, ref, md, now, me, env, knownSha) {
  const cur = knownSha ? { ok: /** @type {const} */ (true), value: knownSha } : git.lsRemoteRef(cfg, ref);
  if (!cur.ok) return offline(cfg);
  if (cur.value == null) return acquire(cfg, repoRoot, relpath, env); // vừa được release ⇒ thử lại

  const p = git.readPayload(cfg, md, ref, cur.value);
  if (!p.ok) return { status: 'error', message: p.error };

  if (p.value.owner === me) {
    upsertHeld(repoRoot, { relpath, ref, sha: cur.value, expires_at: p.value.expires_at });
    return { status: 'already-mine' };
  }

  // Stale ⇒ reclaim qua CAS (chỉ thắng nếu ref vẫn đúng sha cũ).
  if (p.value.expires_at + cfg.skewSec < now) {
    const np = makePayload(cfg, repoRoot, relpath, now, env);
    const sha = git.commitPayload(md, np);
    if (!sha.ok) return { status: 'error', message: sha.error };
    const r = git.pushCas(cfg, md, ref, cur.value, sha.value);
    if (!r.ok) return offline(cfg);
    if (r.value === 'updated') {
      upsertHeld(repoRoot, { relpath, ref, sha: sha.value, expires_at: np.expires_at });
      return { status: 'reclaimed' };
    }
    // Thua CAS ⇒ clone khác vừa reclaim trước. `p.value` là payload CŨ đã hết hạn
    // (owner cũ) — không phản ánh chủ mới. Re-read ref hiện tại để trả owner đúng;
    // re-read fail (mạng chập chờn) ⇒ fallback payload cũ thay vì báo offline.
    const fresh = git.lsRemoteRef(cfg, ref);
    if (fresh.ok && fresh.value) {
      const np2 = git.readPayload(cfg, md, ref, fresh.value);
      if (np2.ok) return { status: 'held', payload: np2.value };
    }
    return { status: 'held', payload: p.value };
  }
  return { status: 'held', payload: p.value };
}

/**
 * Gia hạn lock đang giữ. CAS lease theo sha CỦA MÌNH (held-cache), KHÔNG theo sha
 * remote hiện tại: nếu remote đã bị clone khác reclaim/đổi (sha khác mine.sha),
 * CAS thua ⇒ 'lost' — KHÔNG cướp lock của chủ mới. Renew chỉ thắng khi remote vẫn
 * đúng sha ta từng push, tức ta thật sự còn đang giữ.
 * @param {CcLockConfig} cfg
 * @param {string} repoRoot
 * @param {string} relpath
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {LockResult}
 */
export function renew(cfg, repoRoot, relpath, env = process.env) {
  const ref = refName(cfg, relpath);
  const mine = readHeld(repoRoot).find((e) => e.relpath === relpath);
  if (!mine) return { status: 'not-held' };
  const md = git.ensureMirror(cfg, mirrorDir(cfg));
  if (!md.ok) return { status: 'offline' };
  const np = makePayload(cfg, repoRoot, relpath, nowSec(env), env);
  const sha = git.commitPayload(md.value, np);
  if (!sha.ok) return { status: 'error', message: sha.error };
  const r = git.pushCas(cfg, md.value, ref, mine.sha, sha.value);
  if (!r.ok) return { status: 'offline' };
  if (r.value === 'updated') {
    upsertHeld(repoRoot, { relpath, ref, sha: sha.value, expires_at: np.expires_at });
    return { status: 'renewed' };
  }
  return { status: 'lost' };
}

/**
 * Trả lock (chỉ xoá ref trên remote nếu ta đang là chủ). Luôn dọn held-cache.
 * @param {CcLockConfig} cfg
 * @param {string} repoRoot
 * @param {string} relpath
 * @returns {LockResult}
 */
export function release(cfg, repoRoot, relpath) {
  const md = git.ensureMirror(cfg, mirrorDir(cfg));
  const ref = refName(cfg, relpath);
  const me = cloneId(repoRoot);
  if (md.ok) {
    const cur = git.lsRemoteRef(cfg, ref);
    if (cur.ok && cur.value) {
      const p = git.readPayload(cfg, md.value, ref, cur.value);
      if (p.ok && p.value.owner === me) git.pushDelete(cfg, md.value, ref, cur.value);
    }
  }
  removeHeld(repoRoot, relpath);
  return { status: 'released' };
}

/**
 * Liệt kê các lock clone hiện tại đang giữ (đọc held-cache, 0 round-trip mạng).
 * Dùng cho lệnh `mine`.
 * @param {string} repoRoot
 * @returns {HeldEntry[]}
 */
export function listMine(repoRoot) {
  return readHeld(repoRoot);
}

/**
 * Trả tất cả lock ghi trong held-cache (dùng cho Stop/SessionEnd hook).
 * @param {CcLockConfig} cfg
 * @param {string} repoRoot
 * @returns {LockResult}
 */
export function releaseAll(cfg, repoRoot) {
  const held = readHeld(repoRoot);
  for (const e of held) release(cfg, repoRoot, e.relpath);
  return { status: 'released-all', count: held.length };
}

/**
 * Soi trạng thái lock của 1 file (không cố giữ).
 * @param {CcLockConfig} cfg
 * @param {string} repoRoot
 * @param {string} relpath
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {LockResult}
 */
export function check(cfg, repoRoot, relpath, env = process.env) {
  const md = git.ensureMirror(cfg, mirrorDir(cfg));
  if (!md.ok) return { status: 'offline' };
  const ref = refName(cfg, relpath);
  const cur = git.lsRemoteRef(cfg, ref);
  if (!cur.ok) return { status: 'offline' };
  if (cur.value == null) return { status: 'free' };
  const p = git.readPayload(cfg, md.value, ref, cur.value);
  if (!p.ok) return { status: 'error', message: p.error };
  const now = nowSec(env);
  if (p.value.owner === cloneId(repoRoot)) return { status: 'mine', payload: p.value };
  if (p.value.expires_at + cfg.skewSec < now) return { status: 'stale', payload: p.value };
  return { status: 'held', payload: p.value };
}

/**
 * Chờ tới khi giữ được lock hoặc hết timeout. Poll có jitter để giảm đụng độ.
 * @param {CcLockConfig} cfg
 * @param {string} repoRoot
 * @param {string} relpath
 * @param {number} [timeoutSec]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<LockResult>}
 */
export async function wait(cfg, repoRoot, relpath, timeoutSec = 600, env = process.env) {
  const deadline = nowSec(env) + timeoutSec;
  for (;;) {
    const r = acquire(cfg, repoRoot, relpath, env);
    if (['acquired', 'reclaimed', 'already-mine'].includes(r.status)) return r;
    // Trạng thái không thể đổi bằng cách poll thêm ⇒ thoát ngay (kể cả unconfigured:
    // clone chưa cấu hình thì poll vô ích tới timeout).
    if (['offline-deny', 'disabled', 'bypass', 'unconfigured'].includes(r.status)) return r;
    if (nowSec(env) > deadline) return { status: 'timeout' };
    const jitter = cfg.waitPollSec * (0.5 + (process.pid % 100) / 100);
    await new Promise((res) => setTimeout(res, jitter * 1000));
  }
}

/**
 * Liệt kê MỌI lock của project (mọi clone): đọc từng ref dưới namespace/project,
 * lấy payload. Khác `listMine` (chỉ held-cache cục bộ): hàm này hỏi lock-repo.
 * @param {CcLockConfig} cfg
 * @returns {{status:'ok'|'offline', locks:LockPayload[]}}
 */
export function list(cfg) {
  const md = git.ensureMirror(cfg, mirrorDir(cfg));
  if (!md.ok) return { status: 'offline', locks: [] };
  const refs = git.listRefs(cfg, `${cfg.refNamespace}/${cfg.projectKey}`);
  if (!refs.ok) return { status: 'offline', locks: [] };
  /** @type {LockPayload[]} */
  const locks = [];
  for (const ref of refs.value) {
    const cur = git.lsRemoteRef(cfg, ref);
    if (!cur.ok || !cur.value) continue;
    const p = git.readPayload(cfg, md.value, ref, cur.value);
    if (p.ok) locks.push(p.value);
  }
  return { status: 'ok', locks };
}

/**
 * Khởi tạo cho clone hiện tại: kiểm tra cấu hình + kết nối lock-repo, sinh clone-id.
 *  - `lockRepoUrl` rỗng/placeholder ⇒ unconfigured (cc-lock trơ, KHÔNG cố clone) —
 *    nhất quán với acquire/hook-guard/status, tránh hiểu nhầm "offline" với clone mới.
 *  - `ensureMirror` fail ⇒ offline (không reach được lock-repo).
 *  - else ⇒ ok kèm cloneId + đường dẫn mirror.
 * @param {CcLockConfig} cfg
 * @param {string} repoRoot
 * @returns {LockResult & {cloneId?:string, mirror?:string}}
 */
export function init(cfg, repoRoot) {
  if (!isConfigured(cfg)) {
    return {
      status: 'unconfigured',
      message:
        'lockRepoUrl còn placeholder/để trống — điền URL thật vào .claude/cc-lock.config.json để kích hoạt',
    };
  }
  const md = git.ensureMirror(cfg, mirrorDir(cfg));
  if (!md.ok) return { status: 'offline', message: 'không kết nối được lock-repo' };
  return { status: 'ok', cloneId: cloneId(repoRoot), mirror: md.value };
}

/**
 * Dọn các ref đã hết hạn dưới namespace/project (CAS delete từng cái).
 * @param {CcLockConfig} cfg
 * @param {string} repoRoot
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {LockResult}
 */
export function gc(cfg, repoRoot, env = process.env) {
  const md = git.ensureMirror(cfg, mirrorDir(cfg));
  if (!md.ok) return { status: 'offline', removed: 0 };
  const refs = git.listRefs(cfg, `${cfg.refNamespace}/${cfg.projectKey}`);
  if (!refs.ok) return { status: 'offline', removed: 0 };
  const now = nowSec(env);
  let removed = 0;
  for (const ref of refs.value) {
    const cur = git.lsRemoteRef(cfg, ref);
    if (!cur.ok || !cur.value) continue;
    const p = git.readPayload(cfg, md.value, ref, cur.value);
    if (p.ok && p.value.expires_at + cfg.skewSec < now) {
      const d = git.pushDelete(cfg, md.value, ref, cur.value);
      if (d.ok && d.value === 'deleted') removed++;
    }
  }
  return { status: 'ok', removed };
}
