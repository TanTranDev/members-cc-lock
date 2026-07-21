// @ts-check
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

/** @param {{refNamespace:string,projectKey:string}} cfg @param {string} relpath */
export const refName = (cfg, relpath) => `${cfg.refNamespace}/${cfg.projectKey}/${sha1(relpath)}`;
