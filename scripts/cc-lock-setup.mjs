#!/usr/bin/env node
// @ts-check
// Ghi/merge cấu hình cc-lock vào repo ĐÍCH (nơi bạn muốn bật khoá) —
// KHÔNG đụng file nào của plugin. Chỉ điền 2 giá trị cốt lõi (lockRepoUrl,
// projectKey); phần còn lại giữ default (hoặc giữ nguyên giá trị cũ nếu đã có).
//
// Dùng bởi slash command /cc-lock-setup. Có thể chạy tay:
//   node scripts/cc-lock-setup.mjs --url <lockRepoUrl> --key <projectKey>
//
// Config phải nằm trong repo đích (<repo>/.claude/cc-lock.config.json) và commit
// theo repo đó: mọi clone của cùng repo phải chia sẻ CÙNG projectKey mới khoá
// chung được — đây là ràng buộc của cơ chế, không phải lựa chọn.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Các field đầy đủ (khớp DEFAULTS của src/config.mjs) để file config tự tài-liệu-hoá. */
const TEMPLATE = {
  enabled: true,
  lockRepoUrl: '',
  projectKey: '',
  refNamespace: 'refs/locks',
  ttlSec: 900,
  heartbeatSec: 300,
  skewSec: 60,
  waitPollSec: 5,
  offlinePolicy: 'fail-closed',
  guardedTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
};

/** @param {string[]} argv @returns {{url?:string, key?:string}} */
function parseArgs(argv) {
  /** @type {{url?:string, key?:string}} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--key') out.key = argv[++i];
    else if (a.startsWith('--url=')) out.url = a.slice(6);
    else if (a.startsWith('--key=')) out.key = a.slice(6);
  }
  return out;
}

/** Repo đích = git toplevel tính từ cwd. @returns {string} */
function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    console.error(
      JSON.stringify({
        status: 'error',
        message:
          'Thư mục hiện tại không phải git repo. Hãy cd vào repo bạn muốn bật cc-lock rồi chạy lại.',
      }),
    );
    process.exit(1);
  }
  return ''; // không tới được
}

/** Gợi ý projectKey từ tên repo (slug hoá tên thư mục toplevel). @param {string} root */
function suggestKey(root) {
  return path
    .basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function main() {
  const { url, key } = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const claudeDir = path.join(root, '.claude');
  const cfgPath = path.join(claudeDir, 'cc-lock.config.json');

  // Merge: TEMPLATE ← config cũ (giữ tuning đã chỉnh) ← giá trị mới truyền vào.
  /** @type {Record<string, unknown>} */
  let existing = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (parsed && typeof parsed === 'object') existing = parsed;
  } catch {
    /* chưa có config — dùng template */
  }

  const merged = { ...TEMPLATE, ...existing };
  merged.enabled = true;
  if (url !== undefined) merged.lockRepoUrl = url;
  if (key !== undefined) merged.projectKey = key;

  const missing = [];
  if (!merged.lockRepoUrl || String(merged.lockRepoUrl).includes('<')) missing.push('lockRepoUrl');
  if (!merged.projectKey || String(merged.projectKey).includes('<')) missing.push('projectKey');

  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2) + '\n');

  console.log(
    JSON.stringify(
      {
        status: missing.length ? 'incomplete' : 'ok',
        configPath: cfgPath,
        lockRepoUrl: merged.lockRepoUrl,
        projectKey: merged.projectKey,
        suggestedKey: suggestKey(root),
        missing,
        note: missing.length
          ? 'Còn thiếu giá trị thật — cc-lock vẫn TRƠ (mọi edit được phép) tới khi điền đủ.'
          : 'Đã điền đủ. Chạy `cc-lock init` rồi `cc-lock status` để kích hoạt.',
      },
      null,
      2,
    ),
  );
}

main();
