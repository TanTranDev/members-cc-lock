---
name: cc-lock-off
description: cc-lock — TẮT cc-lock cho riêng clone/worktree này (ghi cc-lock-local.json). Các clone khác không ảnh hưởng. Lệnh do người dùng chủ động gọi.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
Tắt cc-lock cho riêng clone này (mọi edit ở clone này sẽ được phép, không kiểm khoá):

!`node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock off`

Báo kết quả cho người dùng. Bật lại bằng `/cc-lock-on`.
