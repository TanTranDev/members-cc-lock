import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readHeld, upsertHeld, removeHeld } from '../src/heldCache.mjs';
import { addWorktree } from './helpers.mjs';

function tmpRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-held-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

test('upsert/read/remove', () => {
  const r = tmpRepo();
  assert.deepEqual(readHeld(r), []);
  upsertHeld(r, { relpath: 'a.ts', ref: 'refs/locks/p/x', sha: 's1', expires_at: 10 });
  upsertHeld(r, { relpath: 'a.ts', ref: 'refs/locks/p/x', sha: 's2', expires_at: 20 }); // ghi đè
  assert.equal(readHeld(r).length, 1);
  assert.equal(readHeld(r)[0].sha, 's2');
  removeHeld(r, 'a.ts');
  assert.deepEqual(readHeld(r), []);
});

test('giữ song song nhiều relpath, remove chỉ xoá đúng 1', () => {
  const r = tmpRepo();
  upsertHeld(r, { relpath: 'a.ts', ref: 'refs/locks/p/a', sha: 'sa', expires_at: 10 });
  upsertHeld(r, { relpath: 'b.ts', ref: 'refs/locks/p/b', sha: 'sb', expires_at: 20 });
  assert.equal(readHeld(r).length, 2);
  removeHeld(r, 'a.ts');
  const left = readHeld(r);
  assert.equal(left.length, 1);
  assert.equal(left[0].relpath, 'b.ts');
});

test('linked worktree: upsert/read hoạt động, tách biệt với repo chính', () => {
  const r = tmpRepo();
  const wt = addWorktree(r);
  upsertHeld(wt, { relpath: 'a.ts', ref: 'refs/locks/p/a', sha: 'sa', expires_at: 10 });
  assert.equal(readHeld(wt).length, 1);
  assert.deepEqual(readHeld(r), []); // held-cache per-worktree, không lẫn sang repo chính
});

test('readHeld trả [] khi file hỏng/không tồn tại', () => {
  const r = tmpRepo();
  fs.writeFileSync(path.join(r, '.git', 'cc-locks-held.json'), '{not json');
  assert.deepEqual(readHeld(r), []);
});
