---
name: cc-lock-mine
description: cc-lock — liệt kê các khoá mà clone hiện tại đang giữ (đọc cache local, không chạm mạng). Dùng để kiểm tra mình còn giữ file nào trước khi kết thúc.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
Các khoá clone hiện tại đang giữ (cache local, 0 round-trip mạng):

!`node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock mine`

Nếu trống ⇒ clone này không giữ khoá nào. Còn khoá ⇒ cân nhắc `/cc-lock-release <relpath>` khi đã xong file.
