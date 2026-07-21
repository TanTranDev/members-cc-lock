import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cloneId, session } from '../src/identity.mjs';
import { addWorktree } from './helpers.mjs';

function tmpRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-id-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

test('cloneId sinh 1 lần rồi giữ nguyên', () => {
  const r = tmpRepo();
  const a = cloneId(r);
  const b = cloneId(r);
  assert.equal(a, b);
  assert.match(a, /.+-[0-9a-f]{8}$/);
});

test('2 repo khác nhau ⇒ clone-id khác', () => {
  assert.notEqual(cloneId(tmpRepo()), cloneId(tmpRepo()));
});

test('linked worktree: cloneId không throw, ổn định, KHÁC repo chính (mỗi worktree = 1 clone)', () => {
  const r = tmpRepo();
  const wt = addWorktree(r);
  const a = cloneId(wt);
  assert.equal(a, cloneId(wt));
  assert.match(a, /.+-[0-9a-f]{8}$/);
  assert.notEqual(a, cloneId(r));
});

test('session ưu tiên CLAUDE_SESSION_ID', () => {
  assert.equal(session({ CLAUDE_SESSION_ID: 'sess-1' }), 'sess-1');
  assert.match(session({}), /^pid\d+$/);
});
