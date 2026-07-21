// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ok, err } from './result.mjs';

/** expected-old khi ref "phải chưa tồn tại" (CAS must-not-exist) */
export const ZERO_OID = '0000000000000000000000000000000000000000';
/** empty tree oid (repo sha1) — payload lưu trong commit message, tree rỗng */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Stderr báo "THUA CAS lease" thật (ref đã đổi/tồn tại do clone khác ghi trước).
 * KHÔNG gồm 'remote rejected' — đó là server từ chối ghi, không phải thua CAS.
 */
const REJECT = /stale info|non-fast-forward|fetch first|cannot lock ref|reference already exists|\[rejected\]/i;
/**
 * Lỗi server/hạ tầng (từ chối ghi, thiếu quyền, không reach được remote).
 * Phải coi là offline để engine fail-closed — check TRƯỚC REJECT vì
 * `[remote rejected]` cũng chứa chuỗi con khớp `\[rejected\]`.
 */
const SERVER_ERR = /remote rejected|unpacker error|hook declined|permission|denied|unable to access|could not read from/i;

/**
 * Chạy git, không throw — trả về { code, stdout, stderr }.
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileSyncOptions} [opts]
 * @returns {{code:number,stdout:string,stderr:string}}
 */
function run(args, opts = {}) {
  try {
    const stdout = execFileSync('git', args, { encoding: 'utf8', ...opts });
    return { code: 0, stdout: String(stdout), stderr: '' };
  } catch (/** @type {any} */ e) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e) };
  }
}

/** Env để chạy git plumbing trong mirror bare repo. @param {string} mirrorDir */
const inMirror = (mirrorDir) => ({ env: { ...process.env, GIT_DIR: mirrorDir } });

/**
 * Bảo đảm mirror bare tồn tại (clone lần đầu, idempotent).
 * @param {{lockRepoUrl:string}} cfg
 * @param {string} mirrorDir
 * @returns {Result} value=mirrorDir
 */
export function ensureMirror(cfg, mirrorDir) {
  if (fs.existsSync(path.join(mirrorDir, 'HEAD'))) return ok(mirrorDir);
  fs.mkdirSync(path.dirname(mirrorDir), { recursive: true });
  const r = run(['clone', '--bare', '-q', cfg.lockRepoUrl, mirrorDir]);
  return r.code === 0 ? ok(mirrorDir) : err('offline');
}

/**
 * Đọc sha hiện tại của 1 ref trên lock-repo (null nếu ref không tồn tại).
 * @param {{lockRepoUrl:string}} cfg
 * @param {string} ref
 * @returns {Result} value=string(sha)|null
 */
export function lsRemoteRef(cfg, ref) {
  const r = run(['ls-remote', cfg.lockRepoUrl, ref]);
  if (r.code !== 0) return err('offline');
  const line = r.stdout.trim().split('\n')[0];
  return ok(line ? line.split('\t')[0] : null);
}

/**
 * Tạo commit chứa payload JSON trong message (tree rỗng) — chưa push.
 * @param {string} mirrorDir
 * @param {LockPayload} payload
 * @returns {Result} value=string(sha)
 */
export function commitPayload(mirrorDir, payload) {
  const r = run(['commit-tree', EMPTY_TREE, '-m', JSON.stringify(payload)], inMirror(mirrorDir));
  return r.code === 0 ? ok(r.stdout.trim()) : err(r.stderr);
}

/**
 * CAS "must-not-exist": tạo ref khi đang trống.
 * @param {{lockRepoUrl:string}} cfg
 * @param {string} mirrorDir
 * @param {string} ref
 * @param {string} sha
 * @returns {Result} value='created'|'exists'
 */
export function pushCreate(cfg, mirrorDir, ref, sha) {
  const r = run(
    ['push', `--force-with-lease=${ref}:${ZERO_OID}`, cfg.lockRepoUrl, `${sha}:${ref}`],
    inMirror(mirrorDir),
  );
  if (r.code === 0) return ok('created');
  if (SERVER_ERR.test(r.stderr)) return err('offline');
  return REJECT.test(r.stderr) ? ok('exists') : err('offline');
}

/**
 * CAS update: chỉ thắng nếu ref vẫn đang là oldSha.
 * @param {{lockRepoUrl:string}} cfg
 * @param {string} mirrorDir
 * @param {string} ref
 * @param {string} oldSha
 * @param {string} newSha
 * @returns {Result} value='updated'|'lost'
 */
export function pushCas(cfg, mirrorDir, ref, oldSha, newSha) {
  const r = run(
    ['push', `--force-with-lease=${ref}:${oldSha}`, cfg.lockRepoUrl, `${newSha}:${ref}`],
    inMirror(mirrorDir),
  );
  if (r.code === 0) return ok('updated');
  if (SERVER_ERR.test(r.stderr)) return err('offline');
  return REJECT.test(r.stderr) ? ok('lost') : err('offline');
}

/**
 * CAS delete: chỉ xoá nếu ref vẫn đang là oldSha.
 * @param {{lockRepoUrl:string}} cfg
 * @param {string} mirrorDir
 * @param {string} ref
 * @param {string} oldSha
 * @returns {Result} value='deleted'|'lost'
 */
export function pushDelete(cfg, mirrorDir, ref, oldSha) {
  const r = run(
    ['push', `--force-with-lease=${ref}:${oldSha}`, cfg.lockRepoUrl, `:${ref}`],
    inMirror(mirrorDir),
  );
  if (r.code === 0) return ok('deleted');
  if (SERVER_ERR.test(r.stderr)) return err('offline');
  return REJECT.test(r.stderr) ? ok('lost') : err('offline');
}

/**
 * Đọc payload JSON từ commit message của 1 sha.
 * Fetch object về mirror trước (sha có thể do clone khác tạo).
 * @param {{lockRepoUrl:string}} cfg
 * @param {string} mirrorDir
 * @param {string} ref
 * @param {string} sha
 * @returns {Result} value=LockPayload
 */
export function readPayload(cfg, mirrorDir, ref, sha) {
  run(['fetch', '-q', cfg.lockRepoUrl, `+${ref}:${ref}`], inMirror(mirrorDir));
  const r = run(['cat-file', 'commit', sha], inMirror(mirrorDir));
  if (r.code !== 0) return err('unreadable');
  const msg = r.stdout.split('\n\n').slice(1).join('\n\n').trim();
  try { return ok(JSON.parse(msg)); } catch { return err('bad-payload'); }
}

/**
 * Liệt kê các ref dưới 1 prefix (namespace/project).
 * @param {{lockRepoUrl:string}} cfg
 * @param {string} prefix
 * @returns {Result} value=string[]
 */
export function listRefs(cfg, prefix) {
  const r = run(['ls-remote', cfg.lockRepoUrl, `${prefix}/*`]);
  if (r.code !== 0) return err('offline');
  const refs = r.stdout.trim().split('\n').filter(Boolean).map((l) => l.split('\t')[1]);
  return ok(refs);
}
