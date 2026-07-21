---
name: cc-lock-on
description: cc-lock — BẬT cc-lock cho riêng clone/worktree này (ghi cc-lock-local.json). Không ảnh hưởng clone khác. Lệnh do người dùng chủ động gọi.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
Bật cc-lock cho riêng clone này:

!`node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock on`

Báo kết quả cho người dùng.
