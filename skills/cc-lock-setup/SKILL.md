---
name: cc-lock-setup
description: cc-lock — thiết lập cc-lock cho repo hiện tại: điền lockRepoUrl + projectKey vào .claude/cc-lock.config.json, rồi init + kiểm tra trạng thái. Lệnh do người dùng chủ động gọi khi lần đầu bật cc-lock cho một dự án.
disable-model-invocation: true
argument-hint: "[lockRepoUrl] [projectKey]"
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../scripts/cc-lock-setup.mjs *), Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *), Bash(git rev-parse *), AskUserQuestion
---
# Thiết lập cc-lock cho repo hiện tại

Mục tiêu: điền **2 giá trị cốt lõi** vào `<repo>/.claude/cc-lock.config.json` rồi kích hoạt.
Các tham số tuning khác (ttl, heartbeat, offlinePolicy…) dùng default — người dùng tự sửa
file sau nếu cần.

Đối số truyền vào (nếu có): `$ARGUMENTS` — theo thứ tự `[lockRepoUrl] [projectKey]`.

## Các bước (thực hiện tuần tự)

1. **Xác định repo đích.** Chạy `git rev-parse --show-toplevel`. Không phải git repo ⇒
   báo người dùng cần `cd` vào repo muốn bật cc-lock rồi gọi lại. Gợi ý `projectKey` mặc
   định = tên thư mục toplevel (slug hoá: chữ thường, ký tự lạ → `-`).

2. **Thu thập 2 giá trị** (nếu chưa có trong `$ARGUMENTS`):
   - **`lockRepoUrl`** — URL một git repo hosted RIÊNG để chứa metadata khoá (nên private;
     KHÔNG chứa code/secret). Ví dụ `git@github.com:acme/cc-locks.git`. Repo này chỉ cần
     tồn tại (rỗng là đủ) và mọi máy/dev phải có quyền push.
   - **`projectKey`** — slug định danh dự án, DUY NHẤT cho mỗi dự án (nhiều dự án share
     chung lock-repo được, nhưng phải khác projectKey). Mọi clone của CÙNG repo phải dùng
     CÙNG projectKey. Đề xuất giá trị gợi ý ở bước 1; hỏi người dùng xác nhận/sửa (dùng
     `AskUserQuestion` cho gọn).

3. **Ghi config** (script tự tìm repo đích qua git, merge giữ nguyên tuning cũ nếu có):
   ```
   node "${CLAUDE_SKILL_DIR}"/../../scripts/cc-lock-setup.mjs --url "<lockRepoUrl>" --key "<projectKey>"
   ```
   Kết quả JSON: `status: "ok"` ⇒ đã điền đủ; `status: "incomplete"` + `missing` ⇒ còn
   thiếu giá trị thật (cc-lock vẫn TRƠ tới khi đủ).

4. **Khởi tạo + xác minh** (chỉ khi bước 3 `ok`):
   ```
   node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock init
   node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock status
   ```
   - `init` → `{"status":"ok",...}` ⇒ kết nối lock-repo được, sẵn sàng.
   - `init` → `{"status":"offline",...}` ⇒ URL sai / mất mạng / chưa có quyền push
     (kiểm tra `git ls-remote <lockRepoUrl>` chạy được không).
   - `status` → `active: true` ⇒ cc-lock đã hoạt động cho repo này.

5. **Báo cáo** cho người dùng: file config đã ghi ở đâu, giá trị đã điền, trạng thái
   active, và nhắc: **commit `.claude/cc-lock.config.json` vào repo dự án** để mọi clone
   chia sẻ cùng projectKey. Nếu cần trỏ lock-repo/projectKey RIÊNG cho một clone mà không
   sửa file tracked, ghi override vào `<git-dir>/cc-lock-local.json`.

## Lưu ý
- Nếu chỉ muốn đổi 1 giá trị, chạy lại script chỉ với `--url` hoặc chỉ `--key`; script
  merge, giữ nguyên phần còn lại.
- cc-lock chỉ kích hoạt khi CẢ lockRepoUrl VÀ projectKey đều là giá trị thật (không rỗng,
  không chứa ký tự `<`). Chưa đủ ⇒ cc-lock trơ, mọi edit được phép (không brick repo).
