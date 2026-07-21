# cc-lock — Claude Code plugin: khoá file đa-session bằng git refs

Chống đụng độ khi **nhiều session Claude Code cùng làm trên nhiều clone/worktree** của
cùng một repo. Khoá **theo file**, dùng chung xuyên mọi clone/máy, lưu trên một
**lock-repo hosted** dưới dạng git refs. Một `PreToolUse` hook **chặn cứng (DENY)** việc
ghi một file đang bị session khác giữ.

> Đây là bản plugin đóng gói từ cơ chế cc-lock gốc. Cài một lần, dùng cho mọi dự án.
> Plugin **trơ** (mọi edit được phép) cho tới khi bạn chạy `/cc-lock-setup` cho một repo.

---

## 1. Vấn đề nó giải quyết

Dev thường mở **nhiều folder, mỗi folder là một clone/worktree riêng** của cùng một
repo, mỗi cái chạy **một session Claude Code độc lập** (mỗi cái một branch, cuối cùng
PR/merge về mainline). Hai session cùng sửa **cùng một file logic** → khi merge sẽ đụng
git conflict, hoặc công việc phân kỳ.

cc-lock biến quy ước "khai báo scope" thành **cơ chế thực thi tự động**: chặn cứng việc
ghi một file đang bị clone khác giữ. Khoá theo **đường dẫn tương đối trong repo**
(relpath) nên cùng một file logic ở mọi clone trỏ về cùng một khoá.

Mỗi **linked worktree** được coi là một "clone" độc lập (state per-clone nằm trong git-dir
thật của từng worktree) — hai worktree của cùng repo chặn được nhau. Ngược lại, hai
session mở **cùng một thư mục** vẫn là MỘT clone (không chặn nhau): muốn song song, mỗi
session một worktree.

---

## 2. Cài đặt

Plugin này vừa là **plugin** vừa là **marketplace** một-plugin (có sẵn
`.claude-plugin/marketplace.json`), nên cài trực tiếp từ folder cục bộ:

```text
/plugin marketplace add /đường-dẫn/tới/members-cc-lock
/plugin install cc-lock@members-cc-lock
```

Muốn chia sẻ cho team: push folder này lên một git repo rồi
`/plugin marketplace add <git-url>`.

Sau khi cài, hai hook tự nạp (không cần khai báo tay):
- **PreToolUse** (`Edit|Write|MultiEdit|NotebookEdit`) → `cc-lock hook-guard` (chặn ghi
  file đang bị giữ).
- **SessionEnd** → `cc-lock hook-release-all` (trả mọi khoá của clone khi phiên kết thúc).

Yêu cầu: **Node.js** (dùng `node` trên PATH — lõi cc-lock 0 dependency runtime) và **git**.

---

## 3. Thiết lập cho một dự án — `/cc-lock-setup`

Plugin trơ cho tới khi được cấu hình. Với **mỗi repo** muốn bật cc-lock:

1. **Tạo một lock-repo hosted (rỗng)** — một git repo riêng (nên private; chỉ chứa
   metadata khoá, KHÔNG chứa code/secret), ví dụ `git@github.com:acme/cc-locks.git`. Empty
   repo là đủ. Cấp quyền push cho mọi máy/dev sẽ dùng.
2. Trong repo dự án, chạy:
   ```text
   /cc-lock-setup
   ```
   Lệnh chỉ hỏi **`lockRepoUrl`** — **`projectKey`** mặc định `"auto"` (engine tự derive
   từ `git remote get-url origin`, không cần hỏi). Ghi `<repo>/.claude/cc-lock.config.json`,
   rồi `cc-lock init` + `cc-lock status`. Chỉ khi user chủ động muốn override tường minh
   (vd repo không có remote origin) mới hỏi thêm `projectKey`.
3. **Commit `.claude/cc-lock.config.json`** vào repo dự án — mọi clone của cùng repo tự
   chung `projectKey` (derive từ cùng origin) nên chia sẻ khoá được ngay, không cần đồng bộ
   tay.

> **Nhiều dự án dùng chung một lock-repo được** — ref tách theo
> `refs/locks/<projectKey>/…`. Điều kiện DUY NHẤT: mỗi dự án một `projectKey` riêng — với
> `"auto"`, điều kiện này tự đúng vì mỗi dự án có origin khác nhau.

Cấu hình đầy đủ (`/cc-lock-setup` chỉ hỏi `lockRepoUrl`; còn lại dùng default, sửa tay
trong file nếu cần):

```json
{
  "enabled": true,
  "lockRepoUrl": "git@github.com:acme/cc-locks.git",
  "projectKey": "auto",
  "refNamespace": "refs/locks",
  "ttlSec": 900,
  "heartbeatSec": 300,
  "skewSec": 60,
  "waitPollSec": 5,
  "offlinePolicy": "fail-closed",
  "guardedTools": ["Edit", "Write", "MultiEdit", "NotebookEdit"],
  "mainlineRef": "origin/develop",
  "freshnessMode": "deny",
  "fetchThrottleSec": 60
}
```

**cc-lock chỉ kích hoạt khi `lockRepoUrl` là giá trị thật** (không rỗng, không chứa ký tự
`<`); `projectKey` mặc định `"auto"` luôn coi là đủ (derive lúc load — xem mục 6). Chưa đủ
⇒ trơ (mọi edit được phép) — tránh footgun "clone mới không sửa được gì".

---

## 4. Slash command

| Command | Mục đích |
|---|---|
| `/cc-lock-setup` | Thiết lập `lockRepoUrl` cho repo hiện tại (`projectKey` mặc định `"auto"`), rồi init + status. |
| `/cc-lock-status` | Trạng thái active / enabled + nguồn / lock-repo / projectKey / clone-id. |
| `/cc-lock-list` | Liệt kê MỌI khoá của project trên lock-repo (clone nào giữ file nào). |
| `/cc-lock-mine` | Khoá clone hiện tại đang giữ (cache local, 0 mạng). |
| `/cc-lock-wait <relpath>` | Xếp hàng chờ tới khi file rảnh rồi tự giành (không huỷ task). |
| `/cc-lock-release <relpath>` | Trả khoá một file (gọi ngay khi xong file). |
| `/cc-lock-release-all` | Trả tất cả khoá clone này đang giữ. |
| `/cc-lock-check <relpath>` | Soi trạng thái khoá một file (không cố giành). |
| `/cc-lock-fresh <relpath>` | Soi file có stale so với mainline không (freshness probe, hoạt động kể cả khi `freshnessMode` đang `off`). |
| `/cc-lock-acquire <relpath>` | Chủ động giành khoá trước (thường hook tự làm). |
| `/cc-lock-renew <relpath>` | Gia hạn khoá đang giữ (heartbeat thủ công). |
| `/cc-lock-gc` | Dọn các khoá đã hết hạn dưới project. |
| `/cc-lock-on` · `/cc-lock-off` | Bật / tắt cc-lock cho **riêng clone này**. |
| `/cc-lock-init` | Kiểm tra kết nối lock-repo, sinh clone-id, dựng mirror. |

Skill **`cc-lock-coordination`** tự kích hoạt khi gặp DENY hoặc trước khi sửa file dễ va
chạm — hướng dẫn agent chẩn đoán, **chờ (~30s) và thử lại, không bao giờ huỷ task** vì bị
khoá.

`${status}` của `acquire`/hook: `acquired`/`already-mine`/`reclaimed`/`disabled`/
`unconfigured`/`bypass` ⇒ **ALLOW**; `held`/`offline-deny`/`error` ⇒ **DENY** (exit 2 +
stderr vào ngữ cảnh Claude).

---

## 5. Cơ chế — git-refs-CAS (compare-and-swap phân tán)

Mỗi file đang khoá ↔ một ref `refs/locks/<projectKey>/<sha1(relpath)>` trỏ tới một commit
rỗng-tree mà **message là payload JSON** (owner, host, pid, session, `acquired_at`,
`expires_at`…). Bốn thao tác acquire / reclaim / renew / release đều atomic nhờ
`git push --force-with-lease=<ref>:<sha_kỳ_vọng>` — push chỉ thắng nếu ref trên lock-repo
**vẫn đúng** sha kỳ vọng. Đây là CAS phân tán mà GitHub/GitLab đều hỗ trợ; mỗi file là
một ref riêng nên không có bottleneck một-branch.

- Giữ một **local mirror** bare của lock-repo (mặc định `~/.cache/cc-lock/`, override bằng
  env `CC_LOCK_CACHE_DIR`) + một **cache "held"** per-clone trong git-dir của clone.
- Sửa file mình đang giữ (đa số thao tác) đọc cache local ⇒ **0 round-trip mạng**. Mạng
  chỉ tốn ở: lần đầu chạm file mới, lúc tranh chấp, và renew định kỳ (`heartbeatSec`).
- **Crash-safe**: mỗi khoá có `expires_at = now + ttlSec`. Chủ crash ⇒ khoá hết hạn ⇒
  clone khác reclaim sau `skewSec` (qua CAS). Không có "kẹt vĩnh viễn". `/cc-lock-gc` dọn
  thêm.
- SessionEnd hook trả mọi khoá khi kết thúc phiên. Chủ đích **KHÔNG** gắn vào `Stop` (bắn
  sau mỗi lượt): khoá phải giữ nguyên giữa các turn của cùng một task; idle quá `ttlSec`
  thì tự hết hạn.

### Bảo đảm & giới hạn — cc-lock KHÔNG phải công cụ merge (đọc kỹ)

cc-lock bảo đảm **đúng một thứ: loại trừ tương hỗ theo đường dẫn file** — tại một thời
điểm chỉ một clone/worktree được ghi một relpath. Mọi thao tác git của nó chạy trên
**mirror của lock-repo** (chỉ push/fetch *ref metadata*), **không bao giờ** đụng working
tree hay lịch sử của repo dự án.

Hệ quả cần nhớ:

- **Nhả khoá KHÔNG chuyển nội dung.** Khi A nhả và B giành được khoá, working tree của B
  vẫn là bản file trên branch của B — **B không tự "thấy" hay né được thay đổi của A**.
  cc-lock chuyển *quyền ghi*, không chuyển *nội dung*.
- **Không chống phân kỳ branch.** Hai branch cùng sửa vùng chồng nhau của một file (dù
  tuần tự về thời gian nhờ khoá) **vẫn conflict khi merge** — vì chúng phân kỳ ở tầng git,
  cc-lock không can thiệp tầng đó.
- cc-lock chống *đua ghi đồng-thời* và ép ra một **điểm điều phối** (cái DENY), **không**
  bảo đảm merge sạch.

**Merge trơn tru đến từ kỷ luật git BAO QUANH cc-lock**, không từ cc-lock:

1. **Serialize** trên file (khoá lo phần này).
2. Người giữ khoá **land nhanh về nhánh chung** (rebase fast-forward rồi push).
3. Người sửa tiếp chạy **`git fetch && git rebase <mainline>` TRƯỚC khi sửa** file vừa
   rảnh — đây mới là bước kéo thay đổi của người kia vào tree của mình.

Điều kiện then chốt của bước 3: rebase chỉ hữu ích nếu thay đổi kia **đã lên nhánh chung**.
Nếu mới nằm trên feature branch chưa merge, rebase mainline không thấy gì ⇒ conflict chỉ
bị **hoãn** tới lần merge cuối. Nguyên tắc rút ra: **thay đổi ngắn, land nhanh**. Skill
`cc-lock-coordination` hướng dẫn đúng quy trình này khi bạn gặp DENY.

Hai giới hạn nữa: (a) hai session mở **cùng thư mục** = một clone ⇒ cc-lock **không** chặn
nhau (muốn song song: mỗi session một worktree); (b) ghi file qua **Bash** (`echo >`,
`sed -i`…) không bị canh — escape hatch đã biết (xem §8).

---

## 6. v2 — auto projectKey · symlink-escape · fresh-base guard

**1. `projectKey: "auto"` (mặc định của `/cc-lock-setup`)** — engine tự derive key từ
`git remote get-url origin`: lấy PHẦN PATH của URL (bỏ scheme/user/host — ssh alias
khác nhau giữa máy không ảnh hưởng), bỏ `.git`, lowercase; key = `<slug segment
cuối>-<sha1(path) 8 hex>`. Mọi clone cùng origin ⇒ tự chung namespace khoá, không cần
cấu hình từng clone/máy. Ưu tiên: local override tường minh > config tường minh > auto.
Không có remote origin ⇒ cc-lock trơ + `status` nói rõ lý do.

**2. Symlink-escape DENY** — file lexically trong repo nhưng file VẬT LÝ nằm ngoài
(thư mục config/bộ khung symlink dùng chung) ⇒ hook DENY kèm hướng dẫn: sửa tại repo
chứa file thật, commit + push để nơi khác pull. Symlink nội bộ repo vẫn cho qua, lock
theo relpath thật (canonical).

**3. Fresh-base guard** — trước khi acquire lock cho file F: fetch throttled
(`fetchThrottleSec`, mặc định 60s, timeout 5s fail-fast) rồi kiểm F có đổi trên
mainline (`mainlineRef`, mặc định `origin/develop`, fallback `origin/master`) sau
merge-base không. Có ⇒ theo `freshnessMode`: `deny` (mặc định của `/cc-lock-setup` —
chặn + hướng dẫn rebase) / `warn` / `off` (default engine khi config không có khoá).
Lớp ADVISORY fail-open: offline so với ref local từ lần fetch trước, chưa từng fetch
⇒ bỏ qua; lock CAS vẫn fail-closed. Probe: `/cc-lock-fresh <relpath>`. Xử lý DENY:
skill `cc-lock-coordination` nhánh SB (tự rebase nhánh feature của chính session khi
áp sạch; conflict ⇒ hỏi user).

**Nâng cấp nhiều máy**: cập nhật plugin trên MỌI máy trong cùng đợt — máy chưa cập
nhật dùng key cũ, hai máy tạm không thấy lock của nhau (TTL ngắn, không để rác).

---

## 7. Bật / tắt

Phân giải theo **3 lớp**, ưu tiên cao → thấp, cộng quy tắc "chưa cấu hình ⇒ trơ":

1. **Env `CC_LOCK=off|on`** — tạm thời theo phiên shell (thắng tất cả).
2. **Per-clone `<git-dir>/cc-lock-local.json`** → `{ "enabled": false }` — chỉ clone này.
   Lật bằng `/cc-lock-off` · `/cc-lock-on`. File này còn nhận **override config per-clone**
   (`lockRepoUrl`, `projectKey`…) đè lên config chung — dùng khi một clone cần trỏ
   lock-repo riêng mà không sửa file tracked.
3. **Config chung `.claude/cc-lock.config.json`** → `enabled` — toàn bộ clone.
4. Mặc định: bật.

**Khẩn cấp — `CC_LOCK_BYPASS=1 <lệnh>`**: cho một lệnh ghi vượt rào dù đang bật (acquire
trả `bypass`, có log audit qua stderr). Dùng khi lock-repo chết mà vẫn phải sửa gấp. Đừng
dùng như thói quen.

---

## 8. Troubleshooting

- **Lock kẹt / chủ biến mất.** TTL + heartbeat: chủ crash ⇒ khoá hết hạn ⇒ clone khác
  reclaim tự động (sau `skewSec`). Dọn chủ động: `/cc-lock-gc`.
- **Lock-repo offline.** `offlinePolicy: "fail-closed"` (mặc định) ⇒ không reach được ⇒
  DENY. Lựa chọn: chờ lock-repo sống; `CC_LOCK_BYPASS=1` (khẩn, có log); `/cc-lock-off`
  cho clone này; hoặc đổi sang `"fail-open"` (đánh đổi mất bảo đảm chống đụng độ khi mất
  mạng).
- **Push bị reject (quyền).** cc-lock phân loại là offline ⇒ fail-closed DENY. Kiểm tra:
  `git ls-remote <lockRepoUrl>` chạy được không? Có quyền push chưa?
- **Clone mới bị chặn.** Thường do `lockRepoUrl`/`projectKey` còn rỗng/placeholder ⇒ thực
  ra sẽ được ALLOW (trơ). `/cc-lock-status` báo `active: false (... đang trơ ...)`. Muốn
  kích hoạt thật: `/cc-lock-setup`.
- **Clock skew.** Reclaim chỉ khi `expires_at + skewSec < now`. Giữ máy đồng bộ NTP; lệch
  lớn ⇒ tăng `skewSec`.

**Escape hatch đã biết**: cc-lock chỉ canh 4 tool ghi (Edit/Write/MultiEdit/NotebookEdit).
Ghi file qua Bash (`echo >`, `sed -i`…) **không bị chặn**. Hãy tuân workflow thay vì lách.

---

## 9. Cấu trúc plugin

```
members-cc-lock/
├── .claude-plugin/
│   ├── plugin.json           # manifest plugin (name: cc-lock)
│   └── marketplace.json      # marketplace một-plugin (name: members-cc-lock)
├── bin/cc-lock               # CLI entry (node)
├── src/*.mjs                 # lõi cc-lock (0 dep runtime)
├── __tests__/*.mjs           # test (node --test) — 94 test
├── hooks/hooks.json          # PreToolUse hook-guard + SessionEnd hook-release-all
├── scripts/cc-lock-setup.mjs # ghi/merge config vào repo đích (dùng bởi /cc-lock-setup)
├── skills/
│   ├── cc-lock-coordination/ # skill xử lý va chạm (generic)
│   └── cc-lock-<cmd>/         # 15 slash command bọc CLI
├── package.json · tsconfig.json
└── README.md
```

Chạy test: `node --test` (tại folder plugin). Typecheck: `npm i && npm run typecheck`.
