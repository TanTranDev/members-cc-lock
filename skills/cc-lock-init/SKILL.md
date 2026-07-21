---
name: cc-lock-init
description: cc-lock — kiểm tra kết nối lock-repo, sinh clone-id, dựng local mirror cho clone hiện tại. Chạy sau khi điền cấu hình (thường /cc-lock-setup đã tự chạy). Lệnh do người dùng chủ động gọi.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
Khởi tạo cc-lock cho clone hiện tại:

!`node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock init`

Diễn giải kết quả cho người dùng:
- `{"status":"ok",...}` ⇒ kết nối được, sẵn sàng.
- `{"status":"unconfigured",...}` ⇒ chưa điền lockRepoUrl/projectKey thật ⇒ chạy `/cc-lock-setup`.
- `{"status":"offline",...}` ⇒ đã điền URL nhưng chưa reach được lock-repo (URL sai / mất mạng / thiếu quyền push).
