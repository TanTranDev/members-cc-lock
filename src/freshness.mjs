// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { nowSec } from './clock.mjs';
import { stateDir } from './paths.mjs';

/**
 * Chạy git trong REPO DỰ ÁN (khác git.mjs: đó là mirror lock-repo), không throw.
 * @param {string} repoRoot @param {string[]} args @param {object} [opts] tuỳ chọn thêm cho execFileSync (vd timeout)
 * @returns {{code:number,stdout:string}}
 */
function runGit(repoRoot, args, opts = {}) {
  try {
    return { code: 0, stdout: execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', ...opts }) };
  } catch (/** @type {any} */ e) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? '') };
  }
}

/**
 * Ref mainline để so: cfg.mainlineRef nếu tồn tại local, fallback origin/master,
 * không có gì ⇒ null (caller skip — repo không theo git-flow vẫn dùng được cc-lock).
 * @param {string} repoRoot @param {{mainlineRef:string}} cfg
 * @returns {string|null}
 */
export function resolveMainline(repoRoot, cfg) {
  for (const ref of [cfg.mainlineRef, 'origin/master']) {
    if (!ref) continue;
    if (runGit(repoRoot, ['rev-parse', '--verify', '--quiet', ref]).code === 0) return ref;
  }
  return null;
}

/**
 * Fetch mainline có throttle (stamp trong stateDir — per clone/worktree).
 * Fetch fail ⇒ im lặng: check sẽ so với ref local từ lần fetch trước (fail-open
 * có kiểm soát — freshness là lớp advisory, KHÔNG được brick edit khi offline).
 * @param {string} repoRoot @param {CcLockConfig} cfg @param {NodeJS.ProcessEnv} [env]
 */
export function throttledFetch(repoRoot, cfg, env = process.env) {
  const stamp = path.join(stateDir(repoRoot), 'cc-lock-fetch-stamp');
  const now = nowSec(env);
  try {
    if (now - Number(fs.readFileSync(stamp, 'utf8').trim()) < cfg.fetchThrottleSec) return;
  } catch { /* chưa có stamp ⇒ fetch */ }
  const branch = (cfg.mainlineRef || '').replace(/^origin\//, '');
  // timeout 5s: freshness là lớp advisory — mạng chập chờn thì bỏ qua ngay, không
  // được treo Edit (execFileSync timeout ⇒ throw ⇒ code≠0 ⇒ fail-open dùng ref
  // local cũ). CHỈ áp cho nhánh fetch (đi mạng); lệnh local giữ nguyên không timeout.
  if (!branch || runGit(repoRoot, ['fetch', '-q', 'origin', branch], { timeout: 5000 }).code !== 0) {
    runGit(repoRoot, ['fetch', '-q', 'origin', 'master'], { timeout: 5000 }); // mainline không có ⇒ thử master
  }
  try { fs.writeFileSync(stamp, String(now)); } catch { /* stateDir lỗi ⇒ bỏ qua */ }
}

/**
 * Kiểm file có đổi trên mainline SAU điểm rẽ nhánh (merge-base) không.
 * skip = không đủ dữ kiện để phán (mode off / không mainline / unborn HEAD) —
 * caller cho qua, đúng tính chất advisory (spec 2026-07-21 §5.2).
 * @param {CcLockConfig} cfg @param {string} repoRoot @param {string} relpath
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{status:'fresh'|'skip'}|{status:'stale',mainline:string,sha:string,subject:string}}
 */
export function checkFreshness(cfg, repoRoot, relpath, env = process.env) {
  if (cfg.freshnessMode === 'off') return { status: 'skip' };
  throttledFetch(repoRoot, cfg, env);
  const mainline = resolveMainline(repoRoot, cfg);
  if (!mainline) return { status: 'skip' };
  const mb = runGit(repoRoot, ['merge-base', 'HEAD', mainline]);
  if (mb.code !== 0) return { status: 'skip' }; // unborn HEAD / không chung tổ tiên
  const changed = runGit(repoRoot, ['rev-list', '-1', `${mb.stdout.trim()}..${mainline}`, '--', relpath]);
  const sha = changed.stdout.trim();
  if (changed.code !== 0 || !sha) return { status: 'fresh' };
  const subject = runGit(repoRoot, ['log', '-1', '--format=%h %s', sha]).stdout.trim();
  return { status: 'stale', mainline, sha, subject };
}
