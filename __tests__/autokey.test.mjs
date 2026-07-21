import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, isConfigured, originPath, deriveProjectKey } from '../src/config.mjs';

/** Repo tạm, tuỳ chọn gắn remote origin. @param {string|null} originUrl */
function tmpRepo(originUrl) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-auto-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  if (originUrl) execFileSync('git', ['remote', 'add', 'origin', originUrl], { cwd: dir });
  return dir;
}

test('originPath: path-only — mọi dạng URL cùng path ⇒ cùng kết quả', () => {
  const want = 'msn/ai-chat-platform/nexa-mobile-app/chat_app';
  assert.equal(originPath('git@git.newera.inc:msn/ai-chat-platform/nexa-mobile-app/chat_app.git'), want);
  assert.equal(originPath('ssh://git@git.newera.inc:2222/msn/ai-chat-platform/nexa-mobile-app/chat_app.git'), want);
  assert.equal(originPath('https://git.newera.inc/MSN/AI-Chat-Platform/Nexa-Mobile-App/Chat_App.git'), want);
  // ssh alias per-máy — host bị bỏ nên không ảnh hưởng
  assert.equal(originPath('git@alias-rieng-cua-may:msn/ai-chat-platform/nexa-mobile-app/chat_app.git'), want);
});

test('originPath: không nhận dạng được ⇒ null', () => {
  assert.equal(originPath(''), null);
  assert.equal(originPath('not-a-url'), null);
});

test('deriveProjectKey: <slug segment cuối>-<sha1 8>; ổn định giữa các dạng URL', () => {
  const a = tmpRepo('git@git.newera.inc:msn/ai-chat-platform/nexa-mobile-app/chat_app.git');
  const b = tmpRepo('https://git.newera.inc/msn/ai-chat-platform/nexa-mobile-app/chat_app.git');
  const ka = deriveProjectKey(a);
  assert.equal(ka, 'chat_app-43d6561e'); // giá trị chốt trong spec §4
  assert.equal(deriveProjectKey(b), ka);
});

test('deriveProjectKey: không có origin ⇒ null', () => {
  assert.equal(deriveProjectKey(tmpRepo(null)), null);
});

test('loadConfig: "auto" ⇒ derive + source=auto + isConfigured true', () => {
  const r = tmpRepo('git@host:org/proj.git');
  fs.writeFileSync(path.join(r, '.claude', 'cc-lock.config.json'),
    JSON.stringify({ lockRepoUrl: 'git@host:org/locks.git', projectKey: 'auto' }));
  const cfg = loadConfig(r);
  assert.match(cfg.projectKey, /^proj-[0-9a-f]{8}$/);
  assert.equal(cfg.projectKeySource, 'auto');
  assert.equal(isConfigured(cfg), true);
});

test('loadConfig: "auto" nhưng không có origin ⇒ giữ auto, isConfigured false (trơ)', () => {
  const r = tmpRepo(null);
  fs.writeFileSync(path.join(r, '.claude', 'cc-lock.config.json'),
    JSON.stringify({ lockRepoUrl: 'git@host:org/locks.git', projectKey: 'auto' }));
  const cfg = loadConfig(r);
  assert.equal(cfg.projectKey, 'auto');
  assert.equal(isConfigured(cfg), false);
});

test('loadConfig: local override tường minh thắng "auto" của config chung', () => {
  const r = tmpRepo('git@host:org/proj.git');
  fs.writeFileSync(path.join(r, '.claude', 'cc-lock.config.json'),
    JSON.stringify({ lockRepoUrl: 'git@host:org/locks.git', projectKey: 'auto' }));
  fs.writeFileSync(path.join(r, '.git', 'cc-lock-local.json'),
    JSON.stringify({ projectKey: 'key-rieng' }));
  const cfg = loadConfig(r);
  assert.equal(cfg.projectKey, 'key-rieng');
  assert.equal(cfg.projectKeySource, 'local');
});

test('loadConfig: local override "auto" ép derive dù config chung có key tường minh', () => {
  const r = tmpRepo('git@host:org/proj.git');
  fs.writeFileSync(path.join(r, '.claude', 'cc-lock.config.json'),
    JSON.stringify({ lockRepoUrl: 'git@host:org/locks.git', projectKey: 'key-cu' }));
  fs.writeFileSync(path.join(r, '.git', 'cc-lock-local.json'),
    JSON.stringify({ projectKey: 'auto' }));
  const cfg = loadConfig(r);
  assert.match(cfg.projectKey, /^proj-[0-9a-f]{8}$/);
  assert.equal(cfg.projectKeySource, 'auto');
});

test('loadConfig: key tường minh giữ nguyên + DEFAULTS mới không đổi hành vi cũ (v1 compat)', () => {
  const r = tmpRepo('git@host:org/proj.git');
  fs.writeFileSync(path.join(r, '.claude', 'cc-lock.config.json'),
    JSON.stringify({ lockRepoUrl: 'git@host:org/locks.git', projectKey: 'p1' }));
  const cfg = loadConfig(r);
  assert.equal(cfg.projectKey, 'p1');
  assert.equal(cfg.projectKeySource, 'config');
  assert.equal(cfg.freshnessMode, 'off');            // engine default = off (spec D5)
  assert.equal(cfg.mainlineRef, 'origin/develop');
  assert.equal(cfg.fetchThrottleSec, 60);
});
