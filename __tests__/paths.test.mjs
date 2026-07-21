import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha1, repoRoot, toRelpath, refName, stateDir } from '../src/paths.mjs';
import { addWorktree } from './helpers.mjs';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-paths-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return fs.realpathSync(dir);
}

test('sha1 ổn định', () => {
  assert.equal(sha1('a/b.ts'), sha1('a/b.ts'));
  assert.notEqual(sha1('a/b.ts'), sha1('a/c.ts'));
});

test('repoRoot trả về toplevel', () => {
  const r = tmpRepo();
  const res = repoRoot(r);
  assert.equal(res.ok, true);
  assert.equal(res.value, r);
});

test('toRelpath chuẩn hoá forward-slash, loại file ngoài repo', () => {
  const r = tmpRepo();
  assert.equal(toRelpath(r, path.join(r, 'src', 'a.ts')), 'src/a.ts');
  assert.equal(toRelpath(r, path.join(r, '..', 'outside.ts')), null);
});

test('stateDir: repo thường = <root>/.git', () => {
  const r = tmpRepo();
  assert.equal(stateDir(r), path.join(r, '.git'));
});

test('stateDir: linked worktree = thư mục thật riêng dưới worktrees/ (không phải file .git)', () => {
  const r = tmpRepo();
  const wt = addWorktree(r);
  const sd = stateDir(wt);
  assert.notEqual(sd, path.join(wt, '.git')); // .git ở worktree là FILE, không dùng được
  assert.equal(fs.statSync(sd).isDirectory(), true);
  assert.match(sd, /worktrees/);
});

test('refName = namespace/project/sha1(relpath)', () => {
  const cfg = { refNamespace: 'refs/locks', projectKey: 'proj' };
  assert.equal(refName(cfg, 'src/a.ts'), `refs/locks/proj/${sha1('src/a.ts')}`);
});
