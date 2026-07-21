// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Tạo 1 bare repo đóng vai lock-repo hosted.
 * @returns {string} đường dẫn tới bare repo
 */
export function makeBareLockRepo() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-lockrepo-')));
  const dir = path.join(base, 'locks.git');
  execFileSync('git', ['init', '--bare', '-q', dir]);
  return dir;
}

/**
 * Tạo 1 bare repo từ chối MỌI ghi server-side (pre-receive hook exit 1).
 * Dùng để mô phỏng họ lỗi `! [remote rejected] ... (pre-receive hook declined)`
 * — tức server từ chối push (vd thiếu quyền), KHÁC với thua CAS lease.
 * @returns {string} đường dẫn tới bare repo
 */
export function makeDenyingBareRepo() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-deny-')));
  const dir = path.join(base, 'locks.git');
  execFileSync('git', ['init', '--bare', '-q', dir]);
  installDenyHook(dir);
  return dir;
}

/**
 * Gắn pre-receive hook từ chối mọi push vào 1 bare repo đã tồn tại.
 * Tách riêng để test có thể seed ref TRƯỚC (qua push bình thường) rồi mới bật
 * hook — nhờ đó lease của pushCas/pushDelete khớp ref thật, git chạy tới hook
 * và in `[remote rejected] ... (pre-receive hook declined)` (thay vì thua lease
 * sớm với `[rejected] (stale info)` khi ref chưa tồn tại).
 * @param {string} repoDir bare repo dir
 */
export function installDenyHook(repoDir) {
  const hook = path.join(repoDir, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\necho "pre-receive hook declined" >&2\nexit 1\n');
  fs.chmodSync(hook, 0o755);
}

/**
 * Khởi tạo 1 bare repo tạm để dùng làm mirror cục bộ (GIT_DIR) trong test.
 * Khác `tmpMirror()` (chỉ trả path chưa tồn tại): hàm này tạo sẵn git dir
 * để `commitPayload`/`pushCreate` có chỗ ghi object mà không cần clone từ remote.
 * @returns {string} đường dẫn git dir đã init
 */
export function initBareMirror() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mirror-')));
  const dir = path.join(base, 'm.git');
  execFileSync('git', ['init', '--bare', '-q', dir]);
  return dir;
}

/**
 * Tạo 1 working repo (clone giả) trỏ config tới bare lock-repo.
 * @param {string} lockRepoUrl
 * @param {string} [projectKey]
 * @returns {string} đường dẫn working repo
 */
export function makeWorkRepo(lockRepoUrl, projectKey = 'proj') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-work-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude', 'cc-lock.config.json'),
    JSON.stringify({ lockRepoUrl, projectKey }),
  );
  return dir;
}

/**
 * Thư mục mirror riêng cho 1 test (tránh đụng ~/.cache thật).
 * @returns {string} đường dẫn mirror chưa tồn tại (để ensureMirror tự clone)
 */
export function tmpMirror() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mirror-')));
  return path.join(base, 'm.git');
}

/**
 * Thêm 1 linked worktree cho repo. Commit toàn bộ working tree trước để bản
 * checkout của worktree có cả `.claude/cc-lock.config.json` — giống dự án thật
 * (`.claude/` được commit theo repo).
 * @param {string} repo
 * @param {string} [name]
 * @returns {string} đường dẫn worktree
 */
export function addWorktree(repo, name = 'wt') {
  const git = (/** @type {string[]} */ args) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git(['add', '-A']);
  git([
    '-c', 'user.name=cc-lock-test',
    '-c', 'user.email=cc@test',
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '--allow-empty', '--no-verify', '-m', 'init',
  ]);
  const dir = `${repo}-${name}`;
  git(['worktree', 'add', '-q', '-b', `cc-${name}`, dir]);
  return fs.realpathSync(dir);
}

/**
 * Mở 1 Result trong test — throw nếu Err, trả về value khi Ok.
 * Đồng thời narrow kiểu cho tsc (checkJs) nên test dùng được `.value`.
 * @param {Result} r
 * @returns {any}
 */
export function unwrap(r) {
  if (!r.ok) throw new Error(`expected Ok, got Err: ${r.error}`);
  return r.value;
}
