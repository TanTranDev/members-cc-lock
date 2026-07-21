// @ts-check
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBareLockRepo, makeWorkRepo, addWorktree } from './helpers.mjs';

const BIN = fileURLToPath(new URL('../bin/cc-lock', import.meta.url));

/**
 * Cô lập mirror cache vào tmp riêng (qua CC_LOCK_CACHE_DIR) để hook con KHÔNG bẩn
 * ~/.cache/cc-lock thật. Dọn sạch sau toàn bộ suite.
 */
const CACHE_DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hook-cache-')));
after(() => fs.rmSync(CACHE_DIR, { recursive: true, force: true }));

/**
 * Sự kiện PreToolUse như Claude Code gửi vào stdin của hook-guard.
 * @param {string} repo
 * @param {string} file relpath (POSIX) trong repo
 * @param {string} [tool]
 */
const ev = (repo, file, tool = 'Edit') => ({
  tool_name: tool,
  cwd: repo,
  tool_input: { file_path: path.join(repo, file) },
});

/**
 * Spawn `bin/cc-lock hook-guard` với stdin=JSON, cwd=repo.
 * CC_LOCK_CACHE_DIR truyền xuống để mirror nằm trong tmp riêng của test.
 * @param {string} repo
 * @param {object} payload sự kiện hook
 * @param {Record<string,string>} [extraEnv] env bổ sung (vd CC_LOCK=off)
 * @returns {{code:number, stderr:string}}
 */
function guard(repo, payload, extraEnv = {}) {
  const env = { ...process.env, CC_LOCK_CACHE_DIR: CACHE_DIR, ...extraEnv };
  // spawnSync (không execFileSync): bắt stderr KỂ CẢ khi exit 0 — cần cho audit
  // BYPASS (ghi stderr nhưng vẫn ALLOW). execFileSync chỉ trả stderr ở nhánh throw.
  const r = spawnSync('node', [BIN, 'hook-guard'], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  });
  return { code: r.status ?? 1, stderr: String(r.stderr ?? '') };
}

/**
 * Acquire 1 file qua bin (cùng cache-dir cô lập) để dựng tình huống "clone khác giữ".
 * @param {string} repo
 * @param {string} relpath
 */
function acquire(repo, relpath) {
  execFileSync('node', [BIN, 'acquire', relpath], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, CC_LOCK_CACHE_DIR: CACHE_DIR },
  });
}

/** projectKey duy nhất ⇒ mirrorDir độc lập, tránh nhiễm chéo giữa các ca. */
let seq = 0;
function freshRepos() {
  const url = makeBareLockRepo();
  const projectKey = `hook-${process.pid}-${seq++}`;
  return {
    url,
    projectKey,
    repoA: makeWorkRepo(url, projectKey),
    repoB: makeWorkRepo(url, projectKey),
  };
}

test('file trống ⇒ ALLOW (exit 0)', () => {
  const { repoA } = freshRepos();
  assert.equal(guard(repoA, ev(repoA, 'src/a.ts')).code, 0);
});

test('clone khác giữ cùng relpath ⇒ DENY (exit 2) + stderr', () => {
  const { repoA, repoB } = freshRepos();
  acquire(repoA, 'src/a.ts'); // A giữ
  // B cùng relpath 'src/a.ts' (path tuyệt đối khác nhưng relpath trùng) ⇒ bị chặn.
  const r = guard(repoB, ev(repoB, 'src/a.ts'));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /đang bị giữ bởi/);
});

test('tool ngoài guardedTools (Read) ⇒ ALLOW', () => {
  const { repoA, repoB } = freshRepos();
  acquire(repoA, 'src/a.ts'); // dù file bị giữ
  assert.equal(guard(repoB, ev(repoB, 'src/a.ts', 'Read')).code, 0);
});

test('lockRepoUrl còn placeholder <...> ⇒ ALLOW (exit 0) dù enabled + fail-closed', () => {
  // Clone mới chưa điền URL thật: config vẫn enabled (default), offlinePolicy fail-closed.
  // Guard PHẢI cho qua (cc-lock trơ) thay vì brick mọi edit.
  const projectKey = `hook-unconf-${process.pid}-${seq++}`;
  const repo = makeWorkRepo('git@github.com:<org>/cc-locks.git', projectKey);
  const r = guard(repo, ev(repo, 'src/a.ts'));
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
});

test('linked worktree: file trống ⇒ ALLOW (exit 0), không crash ENOTDIR', () => {
  const { repoA } = freshRepos();
  const wt = addWorktree(repoA);
  const r = guard(wt, ev(wt, 'src/a.ts'));
  assert.equal(r.code, 0);
  // stderr có thể chứa noise vô hại của git (clone empty repo, progress push);
  // điều PHẢI đảm bảo: không crash ghi state vào .git-file của worktree.
  assert.doesNotMatch(r.stderr, /ENOTDIR|lỗi bất ngờ/);
});

test('worktree vs repo chính = 2 clone độc lập: repo chính giữ ⇒ worktree DENY', () => {
  const { repoA } = freshRepos();
  acquire(repoA, 'src/a.ts'); // repo chính giữ
  const wt = addWorktree(repoA);
  const r = guard(wt, ev(wt, 'src/a.ts')); // cùng relpath từ worktree ⇒ bị chặn
  assert.equal(r.code, 2);
  assert.match(r.stderr, /đang bị giữ bởi/);
});

test('CC_LOCK=off ⇒ ALLOW dù file bị giữ', () => {
  const { repoA, repoB } = freshRepos();
  acquire(repoA, 'src/a.ts'); // A giữ
  const r = guard(repoB, ev(repoB, 'src/a.ts'), { CC_LOCK: 'off' });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
});

test('CC_LOCK_BYPASS=1 trên file clone khác giữ ⇒ ALLOW (exit 0) + audit BYPASS qua stderr', () => {
  const { repoA, repoB } = freshRepos();
  acquire(repoA, 'src/a.ts'); // A giữ
  // B bypass dù file đang bị A giữ ⇒ cho ghi NHƯNG để vết audit trong transcript.
  const r = guard(repoB, ev(repoB, 'src/a.ts'), { CC_LOCK_BYPASS: '1' });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /BYPASS/);
  assert.match(r.stderr, /src\/a\.ts/);
});
