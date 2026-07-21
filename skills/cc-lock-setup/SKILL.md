---
name: cc-lock-setup
description: cc-lock — thiết lập cc-lock cho repo hiện tại: điền lockRepoUrl vào .claude/cc-lock.config.json (projectKey mặc định "auto" — tự derive từ origin), rồi init + kiểm tra trạng thái. Lệnh do người dùng chủ động gọi khi lần đầu bật cc-lock cho một dự án.
disable-model-invocation: true
argument-hint: "[lockRepoUrl] [projectKey]"
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../scripts/cc-lock-setup.mjs *), Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *), Bash(git rev-parse *), AskUserQuestion
---
# Thiết lập cc-lock cho repo hiện tại

Mục tiêu: điền **1 giá trị bắt buộc** (`lockRepoUrl`) vào `<repo>/.claude/cc-lock.config.json`
rồi kích hoạt. `projectKey` mặc định `"auto"` — engine tự derive từ `git remote get-url
origin` lúc chạy, KHÔNG cần hỏi user: mọi clone cùng origin (mọi máy/dev) tự động chung
namespace khoá. Chỉ hỏi `projectKey` tường minh khi user chủ động muốn override (vd repo
không có remote origin, hoặc muốn nhiều repo share chung namespace có chủ đích). Các tham
số tuning khác (ttl, heartbeat, offlinePolicy, mainlineRef, freshnessMode…) dùng default —
người dùng tự sửa file sau nếu cần.

Đối số truyền vào (nếu có): `$ARGUMENTS` — theo thứ tự `[lockRepoUrl] [projectKey]`.

## Các bước (thực hiện tuần tự)

1. **Xác định repo đích.** Chạy `git rev-parse --show-toplevel`. Không phải git repo ⇒
   báo người dùng cần `cd` vào repo muốn bật cc-lock rồi gọi lại.

2. **Thu thập giá trị bắt buộc** (nếu chưa có trong `$ARGUMENTS`):
   - **`lockRepoUrl`** — URL một git repo hosted RIÊNG để chứa metadata khoá (nên private;
     KHÔNG chứa code/secret). Ví dụ `git@github.com:acme/cc-locks.git`. Repo này chỉ cần
     tồn tại (rỗng là đủ) và mọi máy/dev phải có quyền push.
   - **`projectKey`** — KHÔNG hỏi mặc định (dùng `"auto"`). Chỉ hỏi/nhận nếu user chủ
     động muốn đặt tường minh (`AskUserQuestion` cho gọn) — vd repo không có remote
     origin (auto sẽ không derive được, cc-lock vẫn trơ tới khi điền tay) hoặc muốn
     nhiều repo cố ý share một namespace khoá.

3. **Ghi config** (script tự tìm repo đích qua git, merge giữ nguyên tuning cũ nếu có):
   ```
   node "${CLAUDE_SKILL_DIR}"/../../scripts/cc-lock-setup.mjs --url "<lockRepoUrl>"
   ```
   Chỉ thêm `--key "<projectKey>"` khi bước 2 xác định user muốn override tường minh.
   Kết quả JSON: `status: "ok"` ⇒ đã điền đủ; `status: "incomplete"` + `missing` ⇒ còn
   thiếu giá trị thật (cc-lock vẫn TRƠ tới khi đủ) — thường chỉ do thiếu `lockRepoUrl`.

4. **Khởi tạo + xác minh** (chỉ khi bước 3 `ok`):
   ```
   node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock init
   node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock status
   ```
   - `init` → `{"status":"ok",...}` ⇒ kết nối lock-repo được, sẵn sàng.
   - `init` → `{"status":"offline",...}` ⇒ URL sai / mất mạng / chưa có quyền push
     (kiểm tra `git ls-remote <lockRepoUrl>` chạy được không).
   - `status` → `active: true` ⇒ cc-lock đã hoạt động cho repo này; dòng `projectKey`
     hiển thị giá trị đã derive (hoặc override tường minh nếu có).

5. **Báo cáo** cho người dùng: file config đã ghi ở đâu, giá trị đã điền, `projectKey`
   thực tế đang dùng (auto-derived hay tường minh), trạng thái active, và nhắc: **commit
   `.claude/cc-lock.config.json` vào repo dự án** để mọi clone chia sẻ cùng cấu hình. Nếu
   cần trỏ lock-repo/projectKey RIÊNG cho một clone mà không sửa file tracked, ghi override
   vào `<git-dir>/cc-lock-local.json`.

## Lưu ý
- Nếu chỉ muốn đổi 1 giá trị, chạy lại script chỉ với `--url` hoặc chỉ `--key`; script
  merge, giữ nguyên phần còn lại.
- cc-lock chỉ kích hoạt khi `lockRepoUrl` là giá trị thật (không rỗng, không chứa ký tự
  `<`). `projectKey` mặc định `"auto"` luôn coi là đủ (engine tự derive lúc load) — chỉ
  bị coi là thiếu nếu bị sửa tay thành placeholder còn sót `<`. Repo không có remote
  origin ⇒ auto không derive được ⇒ cc-lock trơ tới khi user điền `projectKey` tường minh
  (không brick repo).
