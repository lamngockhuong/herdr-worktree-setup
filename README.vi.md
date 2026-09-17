# Herdr Worktree Setup

[English](README.md) · **Tiếng Việt**

Plugin cho [Herdr](https://herdr.dev) chuẩn bị sẵn mọi worktree mà Herdr tạo ra.

`git worktree add` cho bạn một bản checkout sạch của những file git đang theo dõi — và không gì khác. File `.env` bạn ngồi cả buổi chiều điền vẫn nằm lại ở checkout chính, nên việc đầu tiên một worktree mới làm được là khởi động thất bại. Plugin này lấp khoảng trống đó ở sự kiện `worktree.created`.

Không cần cấu hình gì vẫn chạy: plugin tìm những file cấu hình mà git đang bỏ qua rồi chép sang. Repository nào cần nhiều hơn thì khai báo trong `.herdr-worktree.toml`, kể cả việc chạy gì khi worktree được tạo và dọn gì khi nó bị xóa.

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

# Các lệnh chạy sau khi worktree bị xóa, chạy trong repository.
post_remove = ["docker compose -p {{ repo_name }}-{{ branch | sanitize }} down -v"]
post_remove_timeout_ms = 600000

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
| `post_remove` | danh sách chuỗi | `[]` |
| `post_remove_timeout_ms` | số nguyên | `600000` |
| `notify` | boolean | `true` |

Gõ sai tên key là lỗi chứ không phải chuyện cho qua: plugin nêu đúng tên sai và liệt kê các key hợp lệ. Mục trong `copy` và `symlink` phải nằm bên trong repository — đường dẫn tuyệt đối và `..` đều bị từ chối.

File được đọc bằng một lát cắt rất nhỏ của TOML, hẹp như vậy là có chủ ý: dòng chú thích, `key = value`, và một cấp tiêu đề `[section]`, trong đó giá trị là boolean, số nguyên, chuỗi, hoặc danh sách những kiểu đó. Cú pháp khác sẽ báo lỗi rõ ràng thay vì âm thầm hiểu sai.

Còn chuyện một repository cụ thể thật ra cần key nào — monorepo, ứng dụng Rails, một workspace Terraform — thì xem [docs/recipes.vi.md](docs/recipes.vi.md).

### `seed_from_example`

Mặc định tắt, và đây là một lựa chọn đáng giải thích. Một file `.env` toàn giá trị mẫu kiểu `replace-me` vẫn khởi động được ứng dụng rồi trục trặc ở đâu đó rất sâu; còn thiếu hẳn `.env` thì hỏng ngay và nói luôn cho bạn biết sai ở đâu. Bật nó lên với những repository mà file mẫu chứa giá trị mặc định dùng được cho máy cá nhân.

## Lệnh cài đặt và quyền tin cậy

`post_create` và `post_remove` chạy những lệnh do *repository* chọn. Chỉ clone dự án của người khác rồi mở một worktree thì không bao giờ được phép đủ để các lệnh đó chạy, nên chủ máy phải tự cho phép từng repository, từ bên ngoài repository:

```bash
herdr plugin config-dir lamngockhuong.worktree-setup
# thêm đường dẫn tuyệt đối của repository vào trusted-repos.txt trong thư mục đó
```

Mỗi dòng một đường dẫn tuyệt đối; dấu `#` mở đầu phần chú thích. Chừng nào repository chưa có trong danh sách đó, cả hai khối lệnh của nó đều bị bỏ qua và log in ra đúng dòng cần thêm. Một danh sách dùng chung cho cả hai: repository đã được tin cậy để dựng worktree lên thì cũng được tin cậy để dọn nó đi.

`HERDR_WORKTREE_SETUP_TRUST_ALL=1` tắt hẳn lớp chặn này. Chỉ đặt biến đó nếu mọi repository bạn mở đều do chính bạn viết.

Mỗi lệnh phải chạy xong thì lệnh kế tiếp mới bắt đầu, và cả chuỗi dừng ngay ở lệnh đầu tiên thất bại. Không có gì được đưa xuống chạy nền giúp bạn, nên một lệnh không bao giờ kết thúc — chẳng hạn dev server chạy ở tiền cảnh — sẽ giữ hook lại cho đến khi hết `post_create_timeout_ms`, rồi bị giết và bị tính là thất bại. Hãy tự khởi động những tiến trình chạy dài, hoặc giao chúng cho thứ có trả về, ví dụ `docker compose up -d`.

Shell đứng sau các lệnh là `/bin/sh` trên Linux và macOS, còn trên Windows là **PowerShell** — `powershell.exe -NoProfile -NonInteractive`, không phải `cmd.exe`. Profile PowerShell của bạn cố tình không được nạp, nhờ vậy hook luôn thấy cùng một môi trường bất kể ai chạy nó.

Ai đang dùng Windows và nâng cấp từ 0.1.0 nên đọc lại khối `post_create` của mình, vì shell bên dưới đã đổi:

- `&&` và `||` là lỗi cú pháp trong Windows PowerShell 5.1. Hãy tách `"pnpm i && pnpm build"` thành hai mục; chuỗi lệnh vốn đã dừng ở lệnh đầu tiên thất bại rồi.
- Các lệnh nội trú của `cmd` như `set`, `copy`, `del` không còn. PowerShell có bộ lệnh riêng.
- Lệnh thất bại luôn được báo là `exit code 1`, bất kể nó thoát với số nào. PowerShell chỉ chuyển tiếp trạng thái của chính nó, trừ khi chuỗi lệnh kết thúc bằng `exit $LASTEXITCODE`, mà thêm câu đó vào lại báo *thành công* sai khi thứ chạy sau cùng là một cmdlet. Dù sao thất bại vẫn bị phát hiện; chỉ có con số là mất.

## Biến trong lệnh

Mỗi mục trong `post_create` đều có thể mang những chỗ điền dạng `{{ biến }}`. Đây chính là thứ cho phép hai worktree của cùng một repository chạy song song thay vì giành nhau một cổng hay một tên container.

Không có chúng, `post_create = ["docker compose up -d"]` vẫn chạy tốt cho đến ngày bạn mở worktree thứ hai. Compose đặt tên project theo thư mục nó chạy trong đó, mà hai worktree lại cùng mang tên một repository, nên cái thứ hai lặng lẽ nhận luôn container của cái thứ nhất thay vì dựng bộ riêng. Đặt tên project là `{{ repo_name }}-{{ branch | sanitize }}` thì mỗi nhánh có một stack của riêng mình, kèm database riêng.

Cổng cũng đụng nhau theo đúng kiểu đó và được xử lý theo đúng cách đó. `{{ branch | hash_port }}` giao cho `feature/checkout` số 13706 ở mọi lần chạy và cho `fix/login` số 18690 ở mọi lần chạy, nên hai nhánh không bao giờ cùng xin một cổng — dù bạn truyền số đó cho một container hay tự gõ nó cho dev server mà bạn tự khởi động:

```toml
post_create = [
  "pnpm install",
  "docker compose -p {{ repo_name }}-{{ branch | sanitize }} up -d",
]
```

| Biến | Giá trị |
| --- | --- |
| `branch` | nhánh đang được checkout trong worktree mới |
| `worktree_path` | đường dẫn tuyệt đối của checkout mới |
| `worktree_name` | đoạn cuối của đường dẫn đó |
| `repo_path` | đường dẫn tuyệt đối của checkout chính |
| `repo_name` | đoạn cuối của đường dẫn đó |

Mỗi chỗ điền nhận tối đa một bộ lọc, viết sau dấu `|`:

| Bộ lọc | Tác dụng | `feature/checkout` thành |
| --- | --- | --- |
| `sanitize` | đổi `/` và `\` thành `-` | `feature-checkout` |
| `hash` | ba ký tự base36 lấy từ một digest | `l22` |
| `hash_port` | một cổng trong khoảng 10000–19999 | `13706` |

`hash` và `hash_port` chỉ phụ thuộc vào tên nhánh, nên một nhánh luôn nhận đúng cổng đó ở mọi lần chạy, còn hai nhánh khác nhau thì nhận hai cổng khác nhau. Cách tính hai giá trị này không được đổi tùy tiện: đổi thì cổng của mọi worktree đang có cũng dịch theo, nên đó là thay đổi phá vỡ tương thích chứ không phải một bản sửa lỗi.

Năm điều đáng nhớ:

- **Giá trị thay vào luôn được bọc nháy cho shell.** `--port {{ branch | hash_port }}` đến tay shell dưới dạng `--port '13706'`. Lệnh chỉ đọc argv thì không thấy khác gì, nhưng lệnh nào tự cắt chuỗi nhận được sẽ thấy cả dấu nháy. Chính lớp bọc này khiến một nhánh tên `a;rm -rf ~` không còn là một câu lệnh: git chấp nhận cái tên đó, và plugin đưa nó sang lệnh như một tham số nguyên vẹn trên mọi nền tảng. Phần chữ còn lại của câu lệnh là của bạn và được giữ nguyên.
- **Không chỗ nào hiện ra rỗng.** Một tên biến lạ, một bộ lọc viết sai, hay một `{{` thiếu `}}` đều làm lệnh đó thất bại kèm lời giải thích. `{{ branch }}` trong một worktree đang ở detached HEAD cũng vậy, vì ở đó không có nhánh nào: một câu lệnh dựng quanh cái cổng đã biến mất còn tệ hơn một câu lệnh từ chối chạy.
- **Đừng tự bọc nháy quanh một chỗ điền.** `--name "{{ branch | sanitize }}"` đưa cho lệnh chuỗi `"'feature-a'"`, kèm luôn dấu nháy. Plugin đã bọc nháy sẵn rồi.
- **Dấu ngoặc của công cụ khác được giữ nguyên.** Plugin chỉ nhận những biểu thức trông giống một tên biến, chẳng hạn `{{ branch }}` hay `{{ branch | hash_port }}`. `docker ps --format '{{.Names}}'` cùng các mẫu Go hay Helm đi qua đúng như đã viết.
- **Chỉ các lệnh mới nhận biến.** `copy`, `symlink`, `patterns` và `exclude` giữ nguyên chữ, nhờ vậy một đường dẫn sai bị bắt ngay lúc đọc cấu hình chứ không phải giữa chừng.

Các ví dụ hoàn chỉnh — mỗi nhánh một stack Compose, hai dev server cùng lúc, và cái giá của từng lựa chọn — nằm ở [docs/recipes.vi.md](docs/recipes.vi.md).

## Dọn dẹp khi worktree bị xóa

Xóa một worktree là xóa file. Những gì `post_create` đã tạo ra bên ngoài checkout — một project Compose, một container, một volume — vẫn sống tiếp, và sau một tuần mở worktree thì máy đầy những database không ai dùng. `post_remove` chạy ở sự kiện `worktree.removed` của Herdr, và đây là chỗ để một repository tự dọn sau lưng mình:

```toml
post_create = ["docker compose -p {{ repo_name }}-{{ branch | sanitize }} up -d"]
post_remove = ["docker compose -p {{ repo_name }}-{{ branch | sanitize }} down -v"]
```

Hai dòng đó gọi đúng cùng một stack vì chúng được dựng từ cùng một bộ biến, và đó chính là lý do những cái tên này được suy ra chứ không phải tự đặt.

Có bốn điểm khác `post_create` đáng nhớ:

- **Lệnh chạy trong repository, không phải trong worktree.** Lúc sự kiện bắn ra thì checkout đã bị xóa, nên không còn thư mục nào để chạy trong đó và cũng chẳng còn gì ở đó để đọc. Thứ gì mà lệnh dọn cần tìm thì nó tìm theo tên.
- **`{{ branch }}` vẫn dùng được.** Giá trị đó đến từ sự kiện Herdr gửi sang, chứ không phải từ một lệnh git chạy trong thư mục đã biến mất. `{{ worktree_path }}` và `{{ worktree_name }}` vẫn gọi đúng tên thư mục đó, hữu ích khi một tài nguyên được đặt tên theo nó, và vô dụng nếu bạn định đọc một file bên trong.
- **Chỉ thất bại mới hiện thông báo.** Bạn vừa xóa worktree và đã chuyển sang việc khác; một thông báo báo dọn xong sẽ làm phiền mà chẳng để làm gì, còn một thông báo báo dọn hỏng lại đúng là cách bạn biết vẫn còn container đang chạy. Dù thế nào thì log cũng giữ đủ báo cáo.
- **Vẫn đúng một lớp tin cậy đó.** Repository có tên trong `trusted-repos.txt` thì được cả hai khối; không có tên thì không được khối nào.

`post_remove_timeout_ms` khống chế cả khối y như `post_create_timeout_ms`, và mặc định cũng là mười phút.

## Xem trước những gì sẽ xảy ra

```bash
herdr plugin action invoke lamngockhuong.worktree-setup.dry-run
```

Action này mở một pane đè lên workspace và in cả lượt chạy ở đó mà không làm gì cả: không tạo link, không chép, không dựng file từ mẫu, không chạy lệnh nào.

```
worktree /đường/dẫn/worktree
repository /đường/dẫn/repo (feature/checkout)
config .herdr-worktree.toml
dry run: nothing is linked, copied, seeded or executed
would link shared
would copy apps/api/.env.local
would run  docker compose -p 'demo'-'feature-checkout' up -d

press any key to close
```

Cái pane mới là điểm mấu chốt. Herdr gom stdout của một plugin action vào log lệnh và không hiển thị nó ở đâu cả, nên một bản xem trước do chính action in ra là bản xem trước không ai đọc. Pane đóng lại ngay khi bạn bấm phím tiếp theo. Khi Herdr từ chối mở pane — vì đang có một modal khác — action sẽ nói rõ lý do rồi quay về in bản xem trước vào log, nơi `herdr plugin log list` đọc được.

Các lệnh hiện ra đã thay biến và bọc nháy đúng như khi đến tay shell, và đó là cách nhanh nhất để thấy một chỗ điền cho ra giá trị gì. Những dòng link, chép và dựng từ mẫu là danh sách đích đã được xác định, không phải lời hứa rằng từng cái sẽ thành công. Một chỗ điền không thay được sẽ được báo ra và lượt chạy kết thúc với mã khác 0.

Ngoài Herdr, `node src/index.mjs --dry-run /đường/dẫn/worktree` cho kết quả tương tự; nếu không đưa đường dẫn, plugin dùng workspace mà Herdr đang mở, hoặc thư mục hiện tại.

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
pnpm test         # node:test, dựng repository thật trong thư mục tạm
pnpm lint
herdr plugin link .
```

Bộ test phủ mọi thứ plugin tự làm được, nhưng nó không nói chuyện với Herdr
server. Thứ nó không với tới là chính việc chuyển sự kiện: payload mà một bản
Herdr phát hành gửi sang có còn đúng hình dạng `src/context.mjs` đọc hay không.
Điều đó đáng chạy tay một lượt sau mỗi lần nâng cấp Herdr, trên một repository
bỏ đi được:

```bash
herdr worktree create --cwd /path/to/throwaway-repo --branch feature/live-test
herdr plugin log list --plugin lamngockhuong.worktree-setup --limit 1
herdr worktree remove --workspace <id>   # id mà lệnh create in ra, để chạy post_remove
```

Bản ghi log mang theo toàn bộ báo cáo. Hãy thêm repository vào danh sách tin cậy
trước nếu muốn lần chạy chạm tới `post_create`, và xoá dòng đó sau khi xong.

## Giấy phép

MIT © Lam Ngoc Khuong
