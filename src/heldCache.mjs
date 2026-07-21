// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './paths.mjs';

/**
 * File cache lock đang giữ của clone hiện tại — đặt trong git-dir (qua stateDir,
 * hỗ trợ linked worktree) nên không lọt vào working tree / không bị commit.
 * Dùng cho fast-path acquire (0 round-trip).
 * @param {string} repoRoot
 * @returns {string}
 */
const file = (repoRoot) => path.join(stateDir(repoRoot), 'cc-locks-held.json');

/**
 * Đọc danh sách lock đang giữ. Trả [] nếu file chưa có hoặc JSON hỏng.
 * @param {string} repoRoot
 * @returns {HeldEntry[]}
 */
export function readHeld(repoRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(repoRoot), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Ghi đè toàn bộ danh sách lock đang giữ.
 * @param {string} repoRoot
 * @param {HeldEntry[]} entries
 */
export function writeHeld(repoRoot, entries) {
  fs.writeFileSync(file(repoRoot), JSON.stringify(entries, null, 2));
}

/**
 * Thêm/cập nhật entry theo relpath (ghi đè entry cũ cùng relpath).
 * @param {string} repoRoot
 * @param {HeldEntry} entry
 */
export function upsertHeld(repoRoot, entry) {
  writeHeld(repoRoot, [
    ...readHeld(repoRoot).filter((e) => e.relpath !== entry.relpath),
    entry,
  ]);
}

/**
 * Xoá entry theo relpath (idempotent).
 * @param {string} repoRoot
 * @param {string} relpath
 */
export function removeHeld(repoRoot, relpath) {
  writeHeld(repoRoot, readHeld(repoRoot).filter((e) => e.relpath !== relpath));
}
