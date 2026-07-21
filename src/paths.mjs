// @ts-check
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ok, err } from './result.mjs';

/** @param {string} s */
export const sha1 = (s) => createHash('sha1').update(s).digest('hex');

/** @param {string} cwd @returns {Result} */
export function repoRoot(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
    return ok(out.trim());
  } catch {
    return err('not-a-git-repo');
  }
}

/**
 * Thư mục chứa state per-clone (clone-id, held-cache, local override).
 * Repo thường: `<root>/.git`. Linked worktree: `.git` là FILE (`gitdir: ...`)
 * nên phải hỏi git — `rev-parse --absolute-git-dir` trả
 * `<main>/.git/worktrees/<name>`: thư mục thật, RIÊNG từng worktree ⇒ mỗi
 * worktree là một "clone" độc lập (identity + khoá + on/off riêng), đúng ý đồ
 * nhiều implementer song song mỗi người một worktree chặn được nhau.
 * Fallback `<root>/.git` khi git call fail — khi đó ghi state sẽ throw ở
 * worktree và bin fail-closed (exit 2) thay vì cho qua thầm lặng.
 * @param {string} repoRoot
 * @returns {string}
 */
export function stateDir(repoRoot) {
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--absolute-git-dir'], {
      encoding: 'utf8',
    });
    return out.trim();
  } catch {
    return path.join(repoRoot, '.git');
  }
}

/** @param {string} root @param {string} absPath @returns {string|null} */
export function toRelpath(root, absPath) {
  const rel = path.relative(root, path.resolve(absPath));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * realpath chịu được đường dẫn CHƯA tồn tại: resolve tổ tiên gần nhất đang tồn
 * tại rồi nối phần đuôi còn lại (file sắp được Write dưới folder symlink vẫn
 * phải phân loại đúng).
 * @param {string} p
 * @returns {string}
 */
function realpathUp(p) {
  /** @type {string[]} */
  const tail = [];
  let cur = p;
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p; // chạm root FS mà vẫn không tồn tại
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * Phân loại đường dẫn cho hook-guard — KHÁC toRelpath (lexical): resolve symlink
 * để bắt kịch bản `.claude/` symlink về repo bộ khung (spec 2026-07-21 §5.1).
 *  - inside : realpath trong repo ⇒ lock theo relpath THẬT (canonical) — mọi
 *             alias của cùng một file khoá cùng một ref.
 *  - escape : lexically trong repo NHƯNG realpath thoát ra ngoài ⇒ file vật lý
 *             thuộc repo khác — hook DENY.
 *  - outside: lexically đã ngoài repo (không quản — hành vi v1).
 * @param {string} root
 * @param {string} absPath
 * @returns {{kind:'inside',relpath:string}|{kind:'escape',realpath:string}|{kind:'outside'}}
 */
export function classifyPath(root, absPath) {
  if (toRelpath(root, absPath) == null) return { kind: 'outside' };
  const realRoot = realpathUp(root);
  const realFile = realpathUp(path.resolve(absPath));
  const rel = path.relative(realRoot, realFile);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { kind: 'escape', realpath: realFile };
  return { kind: 'inside', relpath: rel.split(path.sep).join('/') };
}

/** @param {{refNamespace:string,projectKey:string}} cfg @param {string} relpath */
export const refName = (cfg, relpath) => `${cfg.refNamespace}/${cfg.projectKey}/${sha1(relpath)}`;
