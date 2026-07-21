import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkFreshness, resolveMainline } from '../src/freshness.mjs';

const GITC = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', [...GITC, ...a], { cwd, encoding: 'utf8' }).trim();
const tmp = (/** @type {string} */ p) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

const CFG = /** @type {CcLockConfig} */ ({
  mainlineRef: 'origin/develop',
  freshnessMode: 'deny',
  fetchThrottleSec: 0,
});

/**
 * Dựng: origin bare (nhánh develop, có f.txt=v1) + clone `other` (nơi đẩy thay
 * đổi mới) + clone `mine` đứng trên nhánh feature `task` rẽ từ base v1.
 */
function fixture() {
  const origin = path.join(tmp('cc-fr-o-'), 'o.git');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'develop', origin]);
  const otherBase = tmp('cc-fr-a-');
  git(otherBase, 'clone', '-q', origin, 'w');
  const other = path.join(otherBase, 'w');
  fs.writeFileSync(path.join(other, 'f.txt'), 'v1');
  git(other, 'checkout', '-q', '-b', 'develop');
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', 'v1');
  git(other, 'push', '-q', 'origin', 'develop');
  const mineBase = tmp('cc-fr-b-');
  git(mineBase, 'clone', '-q', origin, 'w');
  const mine = path.join(mineBase, 'w');
  git(mine, 'checkout', '-q', '-b', 'task', 'origin/develop');
  return { origin, other, mine };
}

/**
 * Đẩy commit "v2" đổi f.txt lên origin/develop từ clone other.
 * @param {string} other
 */
function pushV2(other) {
  fs.writeFileSync(path.join(other, 'f.txt'), 'v2');
  git(other, 'commit', '-aqm', 'v2');
  git(other, 'push', '-q', 'origin', 'develop');
}

test('fresh khi mainline không đổi file sau merge-base', () => {
  const { mine } = fixture();
  assert.equal(checkFreshness(CFG, mine, 'f.txt').status, 'fresh');
});

test('stale khi file đã đổi trên mainline sau điểm rẽ nhánh; file khác không dính oan', () => {
  const { other, mine } = fixture();
  pushV2(other);
  const r = /** @type {{status:string,mainline:string,sha:string,subject:string}} */ (
    checkFreshness(CFG, mine, 'f.txt')
  );
  assert.equal(r.status, 'stale');
  assert.equal(r.mainline, 'origin/develop');
  assert.match(r.subject, /v2/);
  assert.equal(checkFreshness(CFG, mine, 'khac.txt').status, 'fresh');
});

test('đứng thẳng trên develop mà tụt sau origin ⇒ stale (phải pull trước khi sửa)', () => {
  const { other, mine } = fixture();
  git(mine, 'checkout', '-q', 'develop');
  pushV2(other);
  assert.equal(checkFreshness(CFG, mine, 'f.txt').status, 'stale');
});

test('sau khi rebase lên mainline mới ⇒ hết stale (không kẹt lặp)', () => {
  const { other, mine } = fixture();
  pushV2(other);
  assert.equal(checkFreshness(CFG, mine, 'f.txt').status, 'stale');
  git(mine, 'fetch', '-q', 'origin');
  git(mine, 'rebase', '-q', 'origin/develop');
  assert.equal(checkFreshness(CFG, mine, 'f.txt').status, 'fresh');
});

test('fallback origin/master khi mainlineRef không tồn tại', () => {
  const origin = path.join(tmp('cc-fr-m-'), 'o.git');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'master', origin]);
  const base = tmp('cc-fr-mw-');
  git(base, 'clone', '-q', origin, 'w');
  const mine = path.join(base, 'w');
  fs.writeFileSync(path.join(mine, 'f.txt'), 'v1');
  git(mine, 'checkout', '-q', '-b', 'master');
  git(mine, 'add', '-A');
  git(mine, 'commit', '-qm', 'v1');
  git(mine, 'push', '-q', 'origin', 'master');
  assert.equal(resolveMainline(mine, CFG), 'origin/master');
  assert.equal(checkFreshness(CFG, mine, 'f.txt').status, 'fresh');
});

test('repo không có origin/mainline nào ⇒ skip (advisory, không chặn)', () => {
  const dir = tmp('cc-fr-n-');
  execFileSync('git', ['init', '-q', dir]);
  assert.equal(checkFreshness(CFG, dir, 'f.txt').status, 'skip');
});

test('freshnessMode off ⇒ skip', () => {
  const { mine } = fixture();
  assert.equal(checkFreshness({ ...CFG, freshnessMode: 'off' }, mine, 'f.txt').status, 'skip');
});

test('throttle: trong ngưỡng KHÔNG fetch lại; quá ngưỡng fetch ⇒ thấy stale', () => {
  const { other, mine } = fixture();
  const cfg = { ...CFG, fetchThrottleSec: 3600 };
  assert.equal(checkFreshness(cfg, mine, 'f.txt', { CC_LOCK_FAKE_NOW: '1000' }).status, 'fresh');
  pushV2(other);
  // lần 2 trong ngưỡng ⇒ không fetch ⇒ vẫn fresh theo hiểu biết cũ (fail-open có kiểm soát)
  assert.equal(checkFreshness(cfg, mine, 'f.txt', { CC_LOCK_FAKE_NOW: '1010' }).status, 'fresh');
  // quá ngưỡng ⇒ fetch lại ⇒ stale
  assert.equal(checkFreshness(cfg, mine, 'f.txt', { CC_LOCK_FAKE_NOW: '9999' }).status, 'stale');
});
