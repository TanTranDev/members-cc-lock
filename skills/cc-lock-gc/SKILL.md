---
name: cc-lock-gc
description: cc-lock — dọn các khoá đã hết hạn (stale) dưới project trên lock-repo. Chỉ xoá ref đã stale qua CAS, không đụng khoá còn sống. Lệnh do người dùng chủ động gọi.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
Dọn các khoá hết hạn của project trên lock-repo:

!`node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock gc`

Báo số ref đã dọn (`removed`) cho người dùng.
