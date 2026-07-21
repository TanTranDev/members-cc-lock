---
name: cc-lock-status
description: cc-lock — báo trạng thái khoá cho repo hiện tại (active / enabled + nguồn / lock-repo / projectKey / clone-id). Dùng để chẩn đoán khi bị DENY hoặc kiểm tra cc-lock đã bật chưa.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
Trạng thái cc-lock của repo hiện tại:

!`node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock status`

Trình bày ngắn gọn cho người dùng: cc-lock đang active hay trơ, nguồn cấu hình enabled, lock-repo/projectKey, và `clone:` (clone-id của working tree này — dùng để so với owner khi bị DENY).
