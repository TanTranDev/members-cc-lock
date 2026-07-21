// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './paths.mjs';

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
 * Thứ tự merge: DEFAULTS ← config chung (.claude/, commit theo repo dự án)
 * ← override per-clone (<stateDir>/cc-lock-local.json — cùng file với cờ on/off,
 * KHÔNG commit). Override cho phép một clone/máy trỏ lock-repo/projectKey riêng
 * mà không sửa file tracked — vd bật lock thật trên repo bộ khung đang ship
 * config placeholder.
 * @param {string} repoRoot @returns {CcLockConfig}
 */
export function loadConfig(repoRoot) {
  const shared = readJson(path.join(repoRoot, '.claude', 'cc-lock.config.json'));
  const local = readJson(path.join(stateDir(repoRoot), 'cc-lock-local.json'));
  return /** @type {CcLockConfig} */ ({ ...DEFAULTS, ...shared, ...local });
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
