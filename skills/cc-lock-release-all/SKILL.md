---
name: cc-lock-release-all
description: cc-lock — trả TẤT CẢ khoá mà clone hiện tại đang giữ. Lệnh do người dùng chủ động gọi.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
Trả tất cả khoá của clone hiện tại:

!`node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock release-all`

Báo kết quả cho người dùng.
