import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lock from '../src/lock.mjs';
import * as git from '../src/git.mjs';
import { loadConfig } from '../src/config.mjs';
import { readHeld } from '../src/heldCache.mjs';
import { refName } from '../src/paths.mjs';
import { cloneId } from '../src/identity.mjs';
import { makeBareLockRepo, makeWorkRepo, unwrap } from './helpers.mjs';

const LOCK_MJS = fileURLToPath(new URL('../src/lock.mjs', import.meta.url));

/**
 * Cô lập mirror cache vào tmp riêng (qua CC_LOCK_CACHE_DIR) để test KHÔNG bẩn
 * ~/.cache/cc-lock thật của máy. Dọn sạch sau toàn bộ suite.
 */
const CACHE_DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cache-')));
process.env.CC_LOCK_CACHE_DIR = CACHE_DIR;
after(() => fs.rmSync(CACHE_DIR, { recursive: true, force: true }));

/**
 * Mirror dir độc lập cho mỗi ctx — tránh các test nhiễm chéo qua ~/.cache thật.
 * projectKey duy nhất ⇒ mirrorDir(cfg) duy nhất.
 */
let seq = 0;
function ctx() {
  const lockRepoUrl = makeBareLockRepo();
  const projectKey = `proj-${process.pid}-${seq++}`;
  const repoA = makeWorkRepo(lockRepoUrl, projectKey);
  const repoB = makeWorkRepo(lockRepoUrl, projectKey);
  const cfg = { ...loadConfig(repoA), lockRepoUrl, projectKey, skewSec: 0 };
  return { cfg, repoA, repoB };
}

test('acquire trống ⇒ acquired; clone khác ⇒ held', () => {
  const { cfg, repoA, repoB } = ctx();
  const a = lock.acquire(cfg, repoA, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1000' });
  assert.equal(a.status, 'acquired');
  const b = lock.acquire(cfg, repoB, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1001' });
  assert.equal(b.status, 'held');
  assert.equal(b.payload?.owner !== undefined, true);
});

test('acquire lại file của mình ⇒ already-mine (không cần mạng)', () => {
  const { cfg, repoA } = ctx();
  lock.acquire(cfg, repoA, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1000' });
  const again = lock.acquire(cfg, repoA, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1001' });
  assert.equal(again.status, 'already-mine');
});

test('release ⇒ clone khác acquire được', () => {
  const { cfg, repoA, repoB } = ctx();
  lock.acquire(cfg, repoA, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1000' });
  assert.equal(lock.release(cfg, repoA, 'src/a.ts').status, 'released');
  assert.equal(
    lock.acquire(cfg, repoB, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1002' }).status,
    'acquired',
  );
});

test('lock stale ⇒ clone khác reclaim', () => {
  const { cfg, repoA, repoB } = ctx();
  lock.acquire({ ...cfg, ttlSec: 100 }, repoA, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1000' }); // hết hạn @1100
  const r = lock.acquire({ ...cfg, ttlSec: 100 }, repoB, 'src/a.ts', { CC_LOCK_FAKE_NOW: '2000' });
  assert.equal(r.status, 'reclaimed');
});

test('disabled ⇒ status disabled, không chạm lock-repo', () => {
  const { cfg, repoA } = ctx();
  const r = lock.acquire(cfg, repoA, 'src/a.ts', { CC_LOCK: 'off', CC_LOCK_FAKE_NOW: '1000' });
  assert.equal(r.status, 'disabled');
});

test('offline (lockRepoUrl hỏng) + fail-closed ⇒ offline-deny', () => {
  const { repoA } = ctx();
  const badUrl = path.join(
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-nope-'))),
    'no-such-repo.git',
  );
  const cfg = /** @type {CcLockConfig} */ ({
    ...loadConfig(repoA),
    lockRepoUrl: badUrl,
    projectKey: `bad-${process.pid}-${seq++}`,
    offlinePolicy: 'fail-closed',
  });
  const r = lock.acquire(cfg, repoA, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1000' });
  assert.equal(r.status, 'offline-deny');
});

test('lockRepoUrl còn placeholder <...> ⇒ unconfigured (KHÔNG offline-deny, KHÔNG chạm mạng)', () => {
  const { repoA } = ctx();
  const projectKey = `unconf-${process.pid}-${seq++}`;
  const cfg = /** @type {CcLockConfig} */ ({
    ...loadConfig(repoA),
    lockRepoUrl: 'git@github.com:<org>/cc-locks.git', // placeholder chưa điền
    projectKey,
  });
  const r = lock.acquire(cfg, repoA, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1000' });
  assert.equal(r.status, 'unconfigured'); // KHÔNG offline-deny
  // Bằng chứng KHÔNG chạm mạng/git: mirror cache không được tạo (trả TRƯỚC ensureMirror).
  assert.equal(fs.existsSync(path.join(CACHE_DIR, `${projectKey}.git`)), false);
});

test('race: 2 tiến trình cùng acquire ⇒ đúng 1 thắng', () => {
  const { cfg, repoA, repoB } = ctx();
  const script = (/** @type {string} */ repo) =>
    `import * as lock from ${JSON.stringify(LOCK_MJS)};` +
    `const r = lock.acquire(${JSON.stringify(cfg)}, ${JSON.stringify(repo)}, 'race.ts', {CC_LOCK_FAKE_NOW:'1000'});` +
    `process.stdout.write(r.status);`;
  const outs = [repoA, repoB].map((/** @type {string} */ repo) =>
    execFileSync('node', ['--input-type=module', '-e', script(repo)], {
      encoding: 'utf8',
      env: { ...process.env, CC_LOCK_CACHE_DIR: CACHE_DIR },
    }),
  );
  const acquired = outs.filter((s) => s === 'acquired').length;
  const held = outs.filter((s) => s === 'held').length;
  assert.equal(acquired, 1); // đúng 1 thắng
  assert.equal(held, 1); // cái kia thấy held
});

test('mirror cache tôn trọng CC_LOCK_CACHE_DIR (không bẩn ~/.cache)', () => {
  const { cfg, repoA } = ctx();
  // Đảm bảo mirror chưa tồn tại dưới cache override trước khi acquire.
  const expected = path.join(CACHE_DIR, `${cfg.projectKey}.git`);
  assert.equal(fs.existsSync(expected), false);
  const r = lock.acquire(cfg, repoA, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1000' });
  assert.equal(r.status, 'acquired');
  // Mirror phải được tạo dưới CACHE_DIR override, KHÔNG dưới ~/.cache/cc-lock.
  assert.equal(fs.existsSync(path.join(expected, 'HEAD')), true);
});

test('renew không cướp lock: held-cache tưởng còn nhưng remote đã bị clone khác giành ⇒ KHÔNG already-mine, phải thấy held owner mới', () => {
  const { cfg, repoA } = ctx();
  // 1. A acquire @1000 (ttl 900 ⇒ held S_A, expires_at 1900).
  const a1 = lock.acquire(cfg, repoA, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1000' });
  assert.equal(a1.status, 'acquired');
  const shaA = readHeld(repoA).find((e) => e.relpath === 'src/a.ts')?.sha;
  assert.ok(shaA, 'A phải có held-cache entry sau acquire');

  // 2. Mô phỏng B chiếm remote: commit payload owner=cloneB còn hạn dài vào mirror
  //    của A rồi pushCas lease theo S_A (khớp remote hiện tại ⇒ updated). Remote
  //    giờ là B fresh; nhưng held-cache của A VẪN trỏ S_A (A "tưởng" còn giữ).
  const ref = refName(cfg, 'src/a.ts');
  const mirror = path.join(CACHE_DIR, `${cfg.projectKey}.git`);
  const payloadB = {
    relpath: 'src/a.ts',
    owner: 'cloneB',
    host: 'hostB',
    pid: 4242,
    session: 'sessB',
    acquired_at: 1500,
    expires_at: 9999,
    renewed_at: 1500,
  };
  const shaB = unwrap(git.commitPayload(mirror, payloadB));
  assert.equal(unwrap(git.pushCas(cfg, mirror, ref, /** @type {string} */ (shaA), shaB)), 'updated');

  // 3. A acquire @1700: 1900-1700=200 < heartbeat(300) ⇒ renew chạy; 1900 > 1700+skew
  //    ⇒ cache còn "tươi" nên vào nhánh renew của fast-path.
  const a2 = lock.acquire(cfg, repoA, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1700' });
  // RED (renew lease theo cur.value) ⇒ renew cướp lock B ⇒ a2 = already-mine.
  // GREEN (renew lease theo mine.sha = S_A) ⇒ CAS thua (remote là S_B) ⇒ lost ⇒
  // removeHeld + slow-path ⇒ thấy B đang giữ.
  assert.notEqual(a2.status, 'already-mine'); // renew KHÔNG được cướp lock của B
  assert.equal(a2.status, 'held'); // remote xác nhận B đang giữ
  assert.equal(a2.payload?.owner, 'cloneB'); // đúng owner B

  // held-cache của A phải đã được dọn entry sai (renew báo lost ⇒ removeHeld).
  assert.equal(readHeld(repoA).some((e) => e.relpath === 'src/a.ts'), false);
});

test('init với lockRepoUrl còn placeholder <...> ⇒ unconfigured (KHÔNG offline, KHÔNG cố clone)', () => {
  const { repoA } = ctx();
  const projectKey = `init-unconf-${process.pid}-${seq++}`;
  const cfg = /** @type {CcLockConfig} */ ({
    ...loadConfig(repoA),
    lockRepoUrl: 'git@github.com:<org>/cc-locks.git', // placeholder chưa điền
    projectKey,
  });
  const r = lock.init(cfg, repoA);
  assert.equal(r.status, 'unconfigured'); // KHÔNG offline
  // Bằng chứng KHÔNG cố clone: mirror cache không được tạo (trả TRƯỚC ensureMirror).
  assert.equal(fs.existsSync(path.join(CACHE_DIR, `${projectKey}.git`)), false);
});

test('wait thoát sớm khi unconfigured (placeholder) — không poll tới timeout', async () => {
  const { repoA } = ctx();
  const projectKey = `wait-unconf-${process.pid}-${seq++}`;
  const cfg = /** @type {CcLockConfig} */ ({
    ...loadConfig(repoA),
    lockRepoUrl: 'git@github.com:<org>/cc-locks.git', // placeholder chưa điền
    projectKey,
    waitPollSec: 1,
  });
  // timeout nhỏ (1s, dùng đồng hồ thật) làm lưới an toàn: nếu KHÔNG thoát sớm,
  // wait sẽ trả 'timeout' (không treo vĩnh viễn) ⇒ test vẫn fail rõ ràng.
  const started = Date.now();
  const r = await lock.wait(cfg, repoA, 'src/a.ts', 1);
  assert.equal(r.status, 'unconfigured'); // thoát ngay, KHÔNG poll/timeout
  assert.ok(Date.now() - started < 900, 'wait phải trả gần như tức thì'); // không chờ poll
});

test('check: clone khác đang giữ lock fresh ⇒ held với owner đúng (cơ chế re-read owner từ remote)', () => {
  const { cfg, repoA, repoB } = ctx();
  // B giành lock thật trên remote (còn hạn).
  const b = lock.acquire(cfg, repoB, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1000' });
  assert.equal(b.status, 'acquired');

  // A check ⇒ phải đọc owner hiện tại từ remote (= B), không bịa owner cũ.
  const r = lock.check(cfg, repoA, 'src/a.ts', { CC_LOCK_FAKE_NOW: '1001' });
  assert.equal(r.status, 'held');
  assert.equal(r.payload?.owner, cloneId(repoB));
});
