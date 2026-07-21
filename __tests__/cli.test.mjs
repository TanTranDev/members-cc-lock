// @ts-check
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBareLockRepo, makeWorkRepo } from './helpers.mjs';

const BIN = fileURLToPath(new URL('../bin/cc-lock', import.meta.url));

/**
 * Cô lập mirror cache vào tmp riêng (qua CC_LOCK_CACHE_DIR) để CLI con KHÔNG bẩn
 * ~/.cache/cc-lock thật. Dọn sạch sau toàn bộ suite.
 */
const CACHE_DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cli-cache-')));
after(() => fs.rmSync(CACHE_DIR, { recursive: true, force: true }));

/**
 * Spawn bin/cc-lock với cwd=repo. Trả { code, stdout, stderr }.
 * CC_LOCK_CACHE_DIR truyền xuống để mirror nằm trong tmp riêng của test.
 * @param {string} repo
 * @param {string[]} args
 * @param {{input?:string, env?:Record<string,string>}} [opts]
 */
function runCli(repo, args, opts = {}) {
  const env = { ...process.env, CC_LOCK_CACHE_DIR: CACHE_DIR, ...(opts.env || {}) };
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd: repo,
      input: opts.input ?? '',
      encoding: 'utf8',
      env,
    });
    return { code: 0, stdout: String(stdout), stderr: '' };
  } catch (/** @type {any} */ e) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

/** projectKey duy nhất ⇒ mirrorDir độc lập, tránh nhiễm chéo. */
let seq = 0;
function freshRepos() {
  const url = makeBareLockRepo();
  const projectKey = `cli-${process.pid}-${seq++}`;
  return { url, projectKey, repoA: makeWorkRepo(url, projectKey), repoB: makeWorkRepo(url, projectKey) };
}

test('status in trạng thái enabled', () => {
  const { repoA } = freshRepos();
  const r = runCli(repoA, ['status']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /enabled: true/);
});

test('status in dòng clone id (phục vụ chẩn đoán B0 của skill cc-lock-coordination)', () => {
  const { repoA } = freshRepos();
  const r = runCli(repoA, ['status']);
  assert.match(r.stdout, /clone: \S+-[0-9a-f]{8}/);
});

test('hook-guard lỗi bất ngờ ⇒ DENY (exit 2), không cho qua thầm lặng', () => {
  const { url, projectKey, repoA } = freshRepos();
  // guardedTools: null ⇒ cfg.guardedTools.includes() throw ⇒ catch của bin phải
  // biến crash thành fail-closed (exit 2) thay vì unhandled-rejection exit 1.
  fs.writeFileSync(
    path.join(repoA, '.claude', 'cc-lock.config.json'),
    JSON.stringify({ lockRepoUrl: url, projectKey, guardedTools: null }),
  );
  const event = {
    tool_name: 'Edit',
    cwd: repoA,
    tool_input: { file_path: path.join(repoA, 'src', 'a.ts') },
  };
  const r = runCli(repoA, ['hook-guard'], { input: JSON.stringify(event) });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /lỗi bất ngờ/);
});

test('acquire rồi mine liệt kê file', () => {
  const { repoA } = freshRepos();
  const a = runCli(repoA, ['acquire', 'src/a.ts']);
  assert.match(a.stdout, /"status":"acquired"/);
  const mine = runCli(repoA, ['mine']);
  assert.match(mine.stdout, /src\/a\.ts/);
});

test('on/off ghi .git/cc-lock-local.json và đổi status', () => {
  const { repoA } = freshRepos();
  runCli(repoA, ['off']);
  const local = JSON.parse(
    fs.readFileSync(path.join(repoA, '.git', 'cc-lock-local.json'), 'utf8'),
  );
  assert.equal(local.enabled, false);
  assert.match(runCli(repoA, ['status']).stdout, /enabled: false.*local/s);
  runCli(repoA, ['on']);
  assert.match(runCli(repoA, ['status']).stdout, /enabled: true/);
});

test('release-all trả về JSON released-all', () => {
  const { repoA } = freshRepos();
  runCli(repoA, ['acquire', 'src/a.ts']);
  const r = runCli(repoA, ['release-all']);
  assert.match(r.stdout, /"status":"released-all"/);
  // sau release-all, mine trống.
  assert.equal(runCli(repoA, ['mine']).stdout.trim(), '');
});

test('check báo free khi chưa ai giữ, mine khi mình giữ', () => {
  const { repoA } = freshRepos();
  assert.match(runCli(repoA, ['check', 'src/c.ts']).stdout, /"status":"free"/);
  runCli(repoA, ['acquire', 'src/c.ts']);
  assert.match(runCli(repoA, ['check', 'src/c.ts']).stdout, /"status":"mine"/);
});

test('hook-guard ALLOW (exit 0) khi file trống', () => {
  const { repoA } = freshRepos();
  const event = {
    tool_name: 'Edit',
    cwd: repoA,
    tool_input: { file_path: path.join(repoA, 'src', 'a.ts') },
  };
  const r = runCli(repoA, ['hook-guard'], { input: JSON.stringify(event) });
  assert.equal(r.code, 0);
});

test('hook-guard DENY (exit 2) + message khi clone khác giữ', () => {
  const { repoA, repoB } = freshRepos();
  // A giữ src/a.ts.
  assert.match(runCli(repoA, ['acquire', 'src/a.ts']).stdout, /"status":"acquired"/);
  // B Edit cùng relpath ⇒ DENY.
  const event = {
    tool_name: 'Edit',
    cwd: repoB,
    tool_input: { file_path: path.join(repoB, 'src', 'a.ts') },
  };
  const r = runCli(repoB, ['hook-guard'], { input: JSON.stringify(event) });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /đang bị giữ bởi/);
  assert.match(r.stderr, /cc-lock-coordination/);
});

test('hook-guard offline-deny (exit 2) + message trỏ skill khi lock-repo unreachable', () => {
  // lockRepoUrl đã cấu hình (không placeholder) nhưng trỏ path không tồn tại ⇒
  // clone mirror fail ⇒ offline ⇒ fail-closed (mặc định) ⇒ offline-deny.
  const badUrl = path.join(os.tmpdir(), `cc-nonexistent-${process.pid}-${seq++}.git`);
  const repo = makeWorkRepo(badUrl, `cli-offline-${process.pid}-${seq++}`);
  const event = {
    tool_name: 'Edit',
    cwd: repo,
    tool_input: { file_path: path.join(repo, 'src', 'a.ts') },
  };
  const r = runCli(repo, ['hook-guard'], { input: JSON.stringify(event) });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /fail-closed/);
  assert.match(r.stderr, /cc-lock-coordination/);
});

test('hook-guard ALLOW khi tool ngoài guardedTools', () => {
  const { repoA, repoB } = freshRepos();
  runCli(repoA, ['acquire', 'src/a.ts']);
  const event = {
    tool_name: 'Read',
    cwd: repoB,
    tool_input: { file_path: path.join(repoB, 'src', 'a.ts') },
  };
  assert.equal(runCli(repoB, ['hook-guard'], { input: JSON.stringify(event) }).code, 0);
});

test('hook-release-all exit 0', () => {
  const { repoA } = freshRepos();
  runCli(repoA, ['acquire', 'src/a.ts']);
  assert.equal(runCli(repoA, ['hook-release-all']).code, 0);
  assert.equal(runCli(repoA, ['mine']).stdout.trim(), '');
});

test('init kiểm tra kết nối lock-repo ⇒ status ok', () => {
  const { repoA } = freshRepos();
  const r = runCli(repoA, ['init']);
  assert.match(r.stdout, /"status":"ok"/);
  assert.match(r.stdout, /"cloneId"/);
});

test('init thiếu lockRepoUrl (rỗng) ⇒ status unconfigured', () => {
  // working repo KHÔNG có .claude/cc-lock.config.json ⇒ lockRepoUrl rỗng (default).
  // lockRepoUrl rỗng cũng là chưa cấu hình (isConfigured=false) ⇒ unconfigured,
  // nhất quán với placeholder/acquire/hook-guard/status (không brick clone mới).
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-noconf-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const r = runCli(dir, ['init']);
  assert.match(r.stdout, /"status":"unconfigured"/);
});

test('list hiện lock của ≥2 clone', () => {
  const { repoA, repoB } = freshRepos();
  assert.match(runCli(repoA, ['acquire', 'a.ts']).stdout, /"status":"acquired"/);
  assert.match(runCli(repoB, ['acquire', 'b.ts']).stdout, /"status":"acquired"/);
  const out = runCli(repoA, ['list']).stdout;
  assert.match(out, /a\.ts/);
  assert.match(out, /b\.ts/);
  assert.match(out, /"status":"ok"/);
  assert.match(out, /"count":2/);
});
