# Herdr Worktree Setup

[English](README.md) · **Tiếng Việt**

Plugin cho [Herdr](https://herdr.dev) chuẩn bị sẵn mọi worktree mà Herdr tạo ra.

`git worktree add` cho bạn một bản checkout sạch của những file git đang theo dõi — và không gì khác. File `.env` bạn ngồi cả buổi chiều điền vẫn nằm lại ở checkout chính, nên việc đầu tiên một worktree mới làm được là khởi động thất bại. Plugin này lấp khoảng trống đó ở sự kiện `worktree.created`.

Không cần cấu hình gì vẫn chạy: plugin tìm những file cấu hình mà git đang bỏ qua rồi chép sang. Repository nào cần nhiều hơn thì khai báo trong `.herdr-worktree.toml`.

Chạy trên Linux, macOS và Windows. Ngoài Node và git thì không phụ thuộc gì thêm.

## Cài đặt

```bash
herdr plugin install lamngockhuong/herdr-worktree-setup
```

Yêu cầu: Herdr 0.7.0 trở lên, git, và Node 22.5 trở lên nằm trong `PATH` của tiến trình chạy Herdr server, chứ không chỉ trong `PATH` của shell bạn đang gõ. Server do systemd hay launchd khởi động lúc đăng nhập thường có `PATH` hẹp hơn hẳn; phần [Không có gì chạy cả](#không-có-gì-chạy-cả) nói về triệu chứng và cách sửa.

Xong, không phải làm gì thêm. Tạo một worktree và xem thông báo hiện lên:

```bash
herdr worktree create --branch feature/checkout
```

## Plugin tự tìm được những gì

Plugin chỉ chép một file khi git bỏ qua nó **và** tên file trông giống cấu hình riêng của từng checkout. Cặp điều kiện đó là toàn bộ phần an toàn: thư mục build hay cây thư viện phụ thuộc tuy bị bỏ qua nhưng không khớp pattern nào, còn file git đang theo dõi thì đã có sẵn trong worktree.

| Pattern | Thường đến từ |
| --- | --- |
| `**/.env`, `**/.env.*` | Node, Python, Rails, Docker Compose |
| `**/.envrc` | direnv |
| `**/.dev.vars`, `**/.dev.vars.*` | Cloudflare Workers |
| `**/.npmrc`, `**/.yarnrc.yml` | token của registry riêng |
| `**/local.properties` | đường dẫn Android SDK |
| `**/*.tfvars`, `**/*.tfvars.json` | Terraform |
| `config/master.key`, `config/credentials/*.key` | Rails credentials |

Mọi file kết thúc bằng `.example`, `.sample`, `.template`, `.dist` hay `.tpl` đều bị bỏ qua: đó là các file mẫu đã được commit, và worktree đã có sẵn chúng.

Hai quy tắc nữa đáng biết:

- **Không bao giờ ghi đè.** Đường dẫn nào đã tồn tại trong worktree mới thì được giữ nguyên.
- **Thư mục bị bỏ qua toàn bộ thì không được duyệt.** Khi `.gitignore` loại trừ `node_modules/`, git báo về chính thư mục đó chứ không báo từng file bên trong, nên plugin không đi sâu vào. Đúng vì lý do này mà mấy đường dẫn Rails ở trên được dò trực tiếp.

## Cấu hình

Hãy để plugin tự viết file đó, chạy từ workspace của repository bạn muốn cấu hình:

```bash
herdr plugin action invoke lamngockhuong.worktree-setup.init-config
```

Lệnh này đặt một file `.herdr-worktree.toml` chú thích đầy đủ ở thư mục gốc repository: mọi key đều có mô tả, và tất cả đều để ở dạng chú thích, nên file sinh ra cũng chưa thay đổi điều gì cho tới khi bạn sửa. Phần đầu file liệt kê những gì cơ chế dò tìm thấy trong repository *của bạn* ngay lúc này — thường là cách nhanh nhất để biết bạn có cần cấu hình gì hay không:

```toml
# Detected in this repository right now:
#   apps/api/.env.local
#   apps/web/.env.local
#   apps/worker/.env.local
#   packages/database/.env.local
```

File cấu hình đã có sẵn thì không bao giờ bị ghi đè. Ngoài Herdr, lệnh `node src/init.mjs /path/to/repo` cũng cho kết quả y như vậy.

Hoặc tự viết bằng tay. Mọi key đều không bắt buộc.

```toml
# Tắt cơ chế dò tự động, chỉ chép đúng những gì liệt kê bên dưới.
auto_detect = true

# Thay hẳn danh sách pattern mặc định.
patterns = ["**/.env.*", "**/secrets.yaml"]

# Luôn chép những file này, dù có dò ra hay không. Tính từ gốc repository.
copy = ["config/keystore.p12"]

# Trỏ link về checkout chính thay vì chép. Hợp với thư mục lớn.
symlink = ["node_modules"]

# Loại những mục này khỏi kết quả dò. Mục khai trong `copy` không bị ảnh hưởng.
exclude = ["**/.env.ci"]

# Tạo `.env` còn thiếu từ `.env.example` đã commit. Mặc định tắt.
seed_from_example = false

# Các lệnh chạy trong worktree mới. Cần được tin cậy — xem bên dưới.
post_create = ["pnpm install"]
post_create_timeout_ms = 600000

# Hiện thông báo Herdr khi chạy xong.
notify = true
```

| Key | Kiểu | Mặc định |
| --- | --- | --- |
| `auto_detect` | boolean | `true` |
| `patterns` | danh sách chuỗi | bảng ở trên |
| `copy` | danh sách chuỗi | `[]` |
| `symlink` | danh sách chuỗi | `[]` |
| `exclude` | danh sách chuỗi | `[]` |
| `seed_from_example` | boolean | `false` |
| `post_create` | danh sách chuỗi | `[]` |
| `post_create_timeout_ms` | số nguyên | `600000` |
| `notify` | boolean | `true` |

Gõ sai tên key là lỗi chứ không phải chuyện cho qua: plugin nêu đúng tên sai và liệt kê các key hợp lệ. Mục trong `copy` và `symlink` phải nằm bên trong repository — đường dẫn tuyệt đối và `..` đều bị từ chối.

File được đọc bằng một lát cắt rất nhỏ của TOML, hẹp như vậy là có chủ ý: dòng chú thích, `key = value`, và một cấp tiêu đề `[section]`, trong đó giá trị là boolean, số nguyên, chuỗi, hoặc danh sách những kiểu đó. Cú pháp khác sẽ báo lỗi rõ ràng thay vì âm thầm hiểu sai.

### `seed_from_example`

Mặc định tắt, và đây là một lựa chọn đáng giải thích. Một file `.env` toàn giá trị mẫu kiểu `replace-me` vẫn khởi động được ứng dụng rồi trục trặc ở đâu đó rất sâu; còn thiếu hẳn `.env` thì hỏng ngay và nói luôn cho bạn biết sai ở đâu. Bật nó lên với những repository mà file mẫu chứa giá trị mặc định dùng được cho máy cá nhân.

## Lệnh cài đặt và quyền tin cậy

`post_create` chạy những lệnh do *repository* chọn. Chỉ clone dự án của người khác rồi mở một worktree thì không bao giờ được phép đủ để các lệnh đó chạy, nên chủ máy phải tự cho phép từng repository, từ bên ngoài repository:

```bash
herdr plugin config-dir lamngockhuong.worktree-setup
# thêm đường dẫn tuyệt đối của repository vào trusted-repos.txt trong thư mục đó
```

Mỗi dòng một đường dẫn tuyệt đối; dấu `#` mở đầu phần chú thích. Chừng nào repository chưa có trong danh sách đó, khối `post_create` của nó bị bỏ qua và log in ra đúng dòng cần thêm.

`HERDR_WORKTREE_SETUP_TRUST_ALL=1` tắt hẳn lớp chặn này. Chỉ đặt biến đó nếu mọi repository bạn mở đều do chính bạn viết.

Các lệnh chạy qua shell của hệ điều hành, trong worktree mới, và dừng ngay ở lệnh đầu tiên thất bại.

## Chép hay tạo link?

Chép với bất cứ thứ gì có thể khác nhau giữa các nhánh — mọi file `.env` đều thuộc nhóm này.

Tạo link cho những thư mục lớn mà dựng lại thì tốn kém. Cẩn thận với cây thư viện phụ thuộc: `node_modules` được link nghĩa là worktree chạy đúng bộ thư viện của checkout *chính*, nên hai nhánh có lockfile khác nhau sẽ giành nhau một cây thư mục. Khi các nhánh có thay đổi thư viện phụ thuộc, hãy chọn `post_create = ["pnpm install"]`; khi không, `symlink` là lựa chọn tốt.

Trên Windows, link thư mục được tạo dưới dạng junction, không cần quyền đặc biệt. Link file thì cần Developer Mode hoặc shell chạy với quyền quản trị; khi Windows từ chối, plugin chép file thay thế và ghi rõ chuyện đó trong log.

## Khi thấy có gì đó không ổn

Mỗi lần chạy đều ghi lại báo cáo đầy đủ — mỗi file một dòng, kèm lý do cho từng file bị bỏ qua:

```bash
herdr plugin log list --plugin lamngockhuong.worktree-setup --limit 20
```

### Không có gì chạy cả

Một mục `failed` mà bản thân nó không in ra gì thêm thì không phải plugin đang báo lỗi — đó là plugin chưa từng khởi động được:

```json
{"command":["node","src/index.mjs"],"error":"No such file or directory (os error 2)",
 "event":"worktree.created","status":"failed"}
```

File không tìm thấy ở đây là `node`. Herdr chạy lệnh của plugin bằng môi trường của tiến trình *server*, mà server do systemd hay launchd khởi động lúc đăng nhập thì thừa hưởng một `PATH` tối thiểu chứ không phải `PATH` của shell bạn. Volta, nvm, fnm và asdf đều cài node ra ngoài `PATH` đó, nên hook chết trước khi chạy được một dòng nào. Giao diện không hiện gì cả: không thông báo, không báo lỗi, chỉ có một worktree thiếu file cấu hình. Log của plugin là nơi duy nhất thấy được chuyện này.

So sánh xem mỗi bên nhìn thấy gì:

```bash
which node                                                   # shell của bạn
systemctl --user show -p Environment homebrew.herdr.service  # server
```

Trên Linux, hãy đưa cho unit một `PATH` dùng được — thay bằng tên unit của bạn, bản cài qua Homebrew đặt tên là `homebrew.herdr.service`:

```bash
mkdir -p ~/.config/systemd/user/homebrew.herdr.service.d
cat > ~/.config/systemd/user/homebrew.herdr.service.d/path.conf <<EOF
[Service]
Environment=PATH=$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin
EOF
systemctl --user daemon-reload
systemctl --user restart homebrew.herdr.service
```

Trên macOS, đặt đúng biến đó cho launch agent — một mục `EnvironmentVariables` chứa `PATH` trong file plist, hoặc `launchctl setenv PATH ...` trước khi agent khởi động.

Bạn cũng có thể tự chạy hook trên bất kỳ checkout nào:

```bash
HERDR_PLUGIN_CONTEXT_JSON='{"worktree":{"checkout_path":"/path/to/worktree","repo_root":"/path/to/repo"}}' \
  node src/index.mjs
```

## Phát triển

```bash
git clone https://github.com/lamngockhuong/herdr-worktree-setup.git
cd herdr-worktree-setup
npm test          # node:test, dựng repository thật trong thư mục tạm
npm run lint
herdr plugin link .
```

## Giấy phép

MIT © Lam Ngoc Khuong
