# Công thức dùng thực tế

[English](recipes.md) · **Tiếng Việt**

[README](../README.vi.md) mô tả đầy đủ từng key và từng biến: chúng nhận gì và hoạt động ra sao. File này trả lời câu hỏi còn lại — *thật ra tôi cần cái nào, và cần lúc nào?*

Mỗi công thức gồm một tình huống bạn có thể thấy quen, cấu hình nhỏ nhất giải quyết được nó, và điều cần để ý sau đó. Không có phần nào ở đây là bắt buộc; một repository không cần đến cái nào vẫn chạy tốt mà chẳng phải cấu hình gì.

## Monorepo mà mỗi package có `.env` riêng

**Tình huống.** `apps/api`, `apps/web` và `packages/database` mỗi nơi giữ một `.env.local` mà bạn đã mất cả buổi chiều để điền. Worktree mới không có file nào trong số đó.

**Cấu hình.** Không cần gì cả. Cơ chế dò đi khắp repository, và mọi file kể trên đều vừa bị git bỏ qua vừa mang hình dạng của file cấu hình, nên tất cả đều được chép sang.

Xác nhận trước khi tin:

```bash
herdr plugin action invoke lamngockhuong.worktree-setup.dry-run
```

**Điều cần để ý.** Nếu bản xem trước liệt kê một file bạn muốn để lại — một `.env.ci` mà chỉ CI mới nên đọc — hãy loại riêng nó ra mà không đụng đến phần dò còn lại:

```toml
exclude = ["**/.env.ci"]
```

## Hai dev server chạy cùng lúc

**Tình huống.** Bạn để một worktree ở nhánh đang review và một worktree ở nhánh đang viết. Cả hai đều chạy `pnpm dev`, cả hai đều xin cổng 3000, và cái thứ hai chết với `EADDRINUSE`.

**Cấu hình.** Ghi cổng vào đúng nơi dev server đọc, rồi tự khởi động server:

```toml
post_create = ["pnpm install", "printf 'PORT=%s\\n' {{ branch | hash_port }} >> .env.local"]
```

**Điều cần để ý.** `post_create` không phải chỗ dành cho dev server. Mỗi lệnh phải chạy xong thì lệnh sau mới bắt đầu, nên một server để ở tiền cảnh sẽ giữ hook lại cho đến khi timeout giết nó và báo cả lượt chạy là thất bại. Hãy đưa cổng vào worktree như trên, rồi khởi động server khi bạn sẵn sàng — hoặc khởi động nó ở chế độ nền.

Để ý chỗ đứng của chỗ điền: nó đứng trần, không nằm trong dấu nháy của bạn. Plugin đã bọc nháy cho mọi giá trị thay vào, nên `'PORT={{ branch | hash_port }}'` sẽ đến tay shell thành `'PORT='13706''` và mang nghĩa hoàn toàn khác. `printf` nhận con số đó như một tham số riêng, và đó là lý do cách viết này an toàn.

Trên Windows không có `printf`, dòng này cần một câu lệnh PowerShell tương đương; xem công thức Windows bên dưới.

`hash_port` chỉ phụ thuộc vào tên nhánh, nên `feature/checkout` luôn nhận 13706 và `fix/login` luôn nhận 18690 ở mọi lần chạy. Cổng đi theo nhánh chứ không theo thứ tự bạn mở worktree, nhờ vậy mới yên tâm mà bookmark lại được.

Hai nhánh khác nhau vẫn có thể đụng nhau — 10000 cổng cộng với một hàm băm khiến chuyện đó khó xảy ra, chứ không phải không thể. Khi gặp, đổi tên một nhánh là nó dịch sang cổng khác.

## Mỗi nhánh một stack Docker Compose

**Tình huống.** Nhánh nào cũng cần Postgres riêng. Chạy `docker compose up` ở hai worktree thì cái thứ hai nhận luôn container của cái thứ nhất, vì Compose lấy tên project từ tên thư mục và cả hai đều mang tên cùng một repository.

**Cấu hình.**

```toml
post_create = ["docker compose -p {{ repo_name }}-{{ branch | sanitize }} up -d"]
post_remove = ["docker compose -p {{ repo_name }}-{{ branch | sanitize }} down -v"]
```

**Điều cần để ý.** Tên project khoanh vùng container, network và volume lại với nhau, nên mỗi nhánh có database riêng với dữ liệu riêng. `sanitize` ở đây không phải tùy chọn: `feature/checkout` là tên nhánh hợp lệ nhưng là tên Compose project không hợp lệ, và dấu `/` buộc phải thành `-`.

`post_remove` chính là thứ ngăn một tuần mở worktree biến thành một tuần bỏ lại database. Nó chạy trong repository chứ không phải trong worktree, vì Herdr bắn sự kiện xóa sau khi checkout đã biến mất — và đó đúng là lý do cả hai dòng đều gọi stack theo tên thay vì trỏ vào một file nằm bên trong nó.

## Dependency: cài riêng từng nhánh, hay dùng chung một cây?

**Tình huống.** `node_modules` mất hai phút để dựng, mà bạn thì mở worktree liên tục.

**Cấu hình** phụ thuộc vào đúng một câu hỏi — *các nhánh của bạn có đổi lockfile không?*

```toml
# Các nhánh có đổi dependency. Chịu khó cài; đây là câu trả lời đúng duy nhất.
post_create = ["pnpm install"]
```

```toml
# Các nhánh không bao giờ đụng lockfile. Dùng chung một cây và khởi động tức thì.
symlink = ["node_modules"]
```

**Điều cần để ý.** `node_modules` được link nghĩa là worktree chạy dependency của checkout *chính*. Đó là đường tắt, không phải cache dùng chung: ngay khi một nhánh nâng phiên bản, cả hai nhánh cùng chạy thứ mà checkout chính cài sau cùng, và lỗi hiện ra sau đó trông như bug trong code của bạn chứ không như một vấn đề của môi trường. Còn phân vân thì cứ cài.

Một package manager có kho nội dung thật sự — pnpm, hay Yarn với PnP — vốn đã khiến lần cài thứ hai rất rẻ, và đó thường là lựa chọn tốt hơn việc tạo link.

## Thư mục lớn, dựng lại thì tốn

**Tình huống.** Một thư mục `fixtures/` chứa media mẫu, một model checkpoint, một dataset đã tải về. Git bỏ qua nó, nó không bao giờ khác nhau giữa các nhánh, và chép sang mỗi worktree là mỗi lần phí một gigabyte.

**Cấu hình.**

```toml
symlink = ["fixtures", ".cache/models"]
```

**Điều cần để ý.** `symlink` sinh ra cho đúng loại này: chủ yếu để đọc, không phụ thuộc nhánh, và tốn kém. Một worktree ghi vào thư mục đã link là ghi thẳng vào checkout chính, nên thứ gì mà test có thể sửa đổi thì thuộc về `copy` chứ không phải `symlink`.

Trên Windows, link thư mục là junction và không cần quyền đặc biệt. Link *file* thì cần Developer Mode; khi Windows từ chối, plugin chép file đó thay thế và ghi rõ trong log.

## Ứng dụng Rails

**Tình huống.** Worktree mới có `config/credentials.yml.enc` từ git nhưng không có `config/master.key`, nên lần khởi động đầu tiên không giải mã được gì.

**Cấu hình.** Không cần gì cả. `config/master.key` và `config/credentials/*.key` được dò trực tiếp, chính vì `.gitignore` thường loại cả thư mục `config/credentials/`, và khi đó git chỉ báo về thư mục chứ không báo các key bên trong.

**Điều cần để ý.** Nếu key của bạn nằm ở chỗ khác, cứ khai tên ra — phần dò tự động và danh sách khai tay cộng dồn với nhau chứ không thay thế nhau:

```toml
copy = ["config/credentials/staging.key"]
```

## Terraform, khi một file `.tfvars` không giống những file còn lại

**Tình huống.** `dev.tfvars` thì worktree nào cũng cần. `prod.tfvars` chứa thông tin đăng nhập mà bạn không muốn rải ra cả chục checkout.

**Cấu hình.**

```toml
exclude = ["**/prod.tfvars"]
```

**Điều cần để ý.** `exclude` cắt bớt kết quả dò được; nó không phủ quyết một mục đã khai trong `copy`. Nếu bạn muốn một danh sách cho phép chặt chẽ thay vì một danh sách chặn có lọc, hãy tắt hẳn phần dò và nói đúng ý mình:

```toml
auto_detect = false
copy = ["envs/dev.tfvars"]
```

## Khi `.env.example` chứa giá trị mặc định chạy được

**Tình huống.** `.env.example` của bạn không phải một tờ khai chờ điền — nó trỏ vào Postgres cục bộ ở cổng mặc định và dùng được ngay.

**Cấu hình.**

```toml
seed_from_example = true
```

**Điều cần để ý.** Mặc định nó tắt, và có lý do. Một `.env` đầy `replace-me` khiến ứng dụng khởi động được rồi hỏng ở đâu đó rất sâu, còn một `.env` thiếu hẳn thì hỏng ngay lập tức và nói rõ vấn đề. Chỉ bật khi file mẫu thật sự chạy được.

Việc tạo từ file mẫu không bao giờ ghi đè: đến lúc đó, `.env` thật chép từ checkout chính đã nằm sẵn ở đó rồi, và file mẫu bị bỏ qua.

## Lệnh cài đặt trên Windows

**Tình huống.** Khối `post_create` của bạn viết trên macOS, và trên máy Windows của đồng nghiệp thì nó chỉ có mỗi việc là thất bại.

**Cấu hình.**

```toml
post_create = ["pnpm install", "pnpm build"]
```

**Điều cần để ý.** Lệnh chạy qua PowerShell chứ không phải `cmd.exe`. `&&` là lỗi cú pháp trong Windows PowerShell 5.1, nên `"pnpm install && pnpm build"` phải tách thành hai mục — điều này chẳng mất gì, vì lượt chạy vốn đã dừng ở lệnh thất bại đầu tiên. `set`, `copy` và `del` là lệnh dựng sẵn của `cmd` và không còn nữa; PowerShell có bộ lệnh riêng.

## Kiểm lại việc mình vừa làm

Mọi công thức ở trên đều đáng xem trước một lượt rồi hẵng tin:

```bash
herdr plugin action invoke lamngockhuong.worktree-setup.dry-run
```

Bản xem trước hiện từng câu lệnh đúng như shell sẽ nhận, kể cả dấu nháy, và đó là cách nhanh nhất để thấy một chỗ điền cuối cùng thành cái gì. Sau một lượt chạy thật, log có một dòng cho mỗi file kèm lý do của từng lần bỏ qua:

```bash
herdr plugin log list --plugin lamngockhuong.worktree-setup --limit 20
```

Nếu cả khối `post_create` bị bỏ qua, nghĩa là repository chưa được tin cậy; log in ra đúng dòng cần thêm. Xem [Lệnh cài đặt và quyền tin cậy](../README.vi.md#lệnh-cài-đặt-và-quyền-tin-cậy).
