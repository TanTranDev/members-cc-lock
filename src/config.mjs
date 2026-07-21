// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stateDir, sha1 } from './paths.mjs';

const DEFAULTS = {
  enabled: true,
  lockRepoUrl: '',
  projectKey: '',
  refNamespace: 'refs/locks',
  ttlSec: 900,
  heartbeatSec: 300,
  skewSec: 60,
  waitPollSec: 5,
  offlinePolicy: 'fail-closed',
  guardedTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  mainlineRef: 'origin/develop',
  freshnessMode: 'off',
  fetchThrottleSec: 60,
};

/** Đọc 1 file JSON, trả {} nếu thiếu/hỏng. @param {string} p @returns {object} */
function readJson(p) {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Rút PHẦN PATH (bỏ scheme/user/host) từ một remote URL — path-only vì cùng một
 * repo có thể được trỏ bằng host khác nhau giữa các máy (ssh alias, ssh vs https).
 * Trả null khi không nhận dạng được.
 * @param {string} url
 * @returns {string|null}
 */
export function originPath(url) {
  let u = (url || '').trim();
  if (!u) return null;
  const scheme = u.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?[^/]+\/(.+)$/i);
  const scp = u.match(/^(?:[^@/]+@)?[^:/]+:(.+)$/);
  if (scheme) u = scheme[1];
  else if (scp) u = scp[1];
  else if (!path.isAbsolute(u)) return null; // không phải URL hosted / path tuyệt đối
  return u.replace(/^\/+/, '').replace(/\.git$/i, '').toLowerCase() || null;
}

/**
 * Derive projectKey từ origin của repo: `<slug segment cuối>-<sha1(path) 8 hex>`.
 * Mọi clone cùng origin (mọi máy) ⇒ cùng key; dự án khác origin ⇒ khác key —
 * fix kịch bản symlink `.claude/` dùng chung config vật lý (spec 2026-07-21 §4).
 * Trả null khi repo không có remote origin / URL không nhận dạng được — caller
 * giữ nguyên 'auto' để isConfigured() trả false (cc-lock trơ, không đoán bừa).
 * @param {string} repoRoot
 * @returns {string|null}
 */
export function deriveProjectKey(repoRoot) {
  let url;
  try {
    url = execFileSync('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
  const p = originPath(url);
  if (!p) return null;
  const last = (p.split('/').pop() || '').replace(/[^a-z0-9._-]/g, '-');
  return `${last}-${sha1(p).slice(0, 8)}`;
}

/**
 * Thứ tự merge: DEFAULTS ← config chung (.claude/, commit theo repo dự án)
 * ← override per-clone (<stateDir>/cc-lock-local.json — cùng file với cờ on/off,
 * KHÔNG commit). Override cho phép một clone/máy trỏ lock-repo/projectKey riêng
 * mà không sửa file tracked — vd bật lock thật trên repo bộ khung đang ship
 * config placeholder.
 * Sentinel "auto": derive từ origin — xem deriveProjectKey.
 * @param {string} repoRoot @returns {CcLockConfig}
 */
export function loadConfig(repoRoot) {
  const shared = readJson(path.join(repoRoot, '.claude', 'cc-lock.config.json'));
  const local = readJson(path.join(stateDir(repoRoot), 'cc-lock-local.json'));
  const cfg = /** @type {CcLockConfig} */ ({ ...DEFAULTS, ...shared, ...local });
  cfg.projectKeySource =
    'projectKey' in local ? 'local' : 'projectKey' in shared ? 'config' : 'default';
  if (cfg.projectKey === 'auto') {
    const derived = deriveProjectKey(repoRoot);
    if (derived) {
      cfg.projectKey = derived;
      cfg.projectKeySource = 'auto';
    }
    // derive fail ⇒ giữ 'auto' ⇒ isConfigured() false ⇒ cc-lock trơ
  }
  return cfg;
}

/**
 * cc-lock chỉ "hoạt động" khi lock-repo VÀ projectKey đã được điền thật. Trả
 * `false` khi `lockRepoUrl` hoặc `projectKey` rỗng (chưa điền) HOẶC còn ký tự
 * placeholder `<` (vd `<org>`, `<project-slug>` trong template). Clone mới /
 * repo vừa port chưa điền ⇒ cc-lock TRƠ (mọi edit được phép) thay vì brick bằng
 * offline-deny — tránh footgun "fresh clone không sửa được gì". Bắt cả projectKey
 * để chặn kịch bản port dự án mới điền URL nhưng quên đổi projectKey ⇒ đụng
 * namespace khoá của dự án khác trên cùng lock-repo.
 * @param {{lockRepoUrl?:string, projectKey?:string}} cfg
 * @returns {boolean}
 */
export function isConfigured(cfg) {
  const url = cfg.lockRepoUrl;
  if (!url || url.includes('<')) return false;
  const key = cfg.projectKey;
  if (!key || key.includes('<')) return false;
  if (key === 'auto') return false; // sentinel chưa derive được (repo không có origin)
  return true;
}

/** @param {string} repoRoot @param {{enabled?:boolean}} cfg @param {NodeJS.ProcessEnv} [env]
 *  @returns {{enabled:boolean,source:'env'|'local'|'config'|'default'}} */
export function resolveEnabled(repoRoot, cfg, env = process.env) {
  const e = (env.CC_LOCK || '').toLowerCase();
  if (['off', '0', 'false'].includes(e)) return { enabled: false, source: 'env' };
  if (['on', '1', 'true'].includes(e)) return { enabled: true, source: 'env' };
  const local = readJson(path.join(stateDir(repoRoot), 'cc-lock-local.json'));
  if (typeof (/** @type {{enabled?:boolean}} */ (local).enabled) === 'boolean') {
    return { enabled: /** @type {{enabled:boolean}} */ (local).enabled, source: 'local' };
  }
  if (typeof cfg.enabled === 'boolean') return { enabled: cfg.enabled, source: 'config' };
  return { enabled: true, source: 'default' };
}
