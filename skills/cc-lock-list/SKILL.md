---
name: cc-lock-list
description: cc-lock — liệt kê MỌI khoá đang giữ của project trên lock-repo (clone nào đang giữ file nào, hết hạn khi nào). Hỏi lock-repo qua mạng.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
Danh sách mọi khoá đang giữ của project (mọi clone):

!`node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock list`

Trình bày cho người dùng: file nào đang bị khoá, bởi clone-id@host nào, hết hạn lúc nào.
