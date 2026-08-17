# Phân tích Yêu cầu Chức năng (FR) và Phi Chức năng (NFR)

Tài liệu này định nghĩa chi tiết các yêu cầu để xây dựng Hệ thống Quản lý Đồ án Công nghệ Thông tin.

---

## 1. YÊU CẦU CHỨC NĂNG (Functional Requirements - FR)

Yêu cầu chức năng được phân tách rõ ràng theo từng nhóm đối tượng sử dụng (Actor).

### 1.0. Vòng đời một đợt đăng ký (Registration Lifecycle)

Toàn bộ phần đăng ký đề tài vận hành theo **bốn pha của học kỳ**, và mọi quyền hành động ở các mục dưới đều được diễn giải theo pha hiện tại. Định nghĩa một lần ở đây để ba vai không mô tả lệch nhau.

| Pha           | Sinh viên                                   | Giảng viên                                          | Giáo vụ (Admin)                           | Chuyển pha                                |
| ------------- | ------------------------------------------- | --------------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| `PREP`        | xem đề tài, **chưa đăng ký được**           | ra đề, sửa đề, công bố                              | khai eligibility, mở cổng                 | giáo vụ mở, hoặc tới `registration_start` |
| `OPEN`        | tự đăng ký, rủ bạn, rời nhóm                | xem nhóm trên đề tài của mình                       | theo dõi tình hình lấp chỗ                | **tự động** khi quá `registration_end`    |
| `RECONCILING` | **chỉ đọc** — không đăng ký, không rời nhóm | được thông báo khi có SV bị xếp vào đề tài của mình | **xếp SV chưa có nhóm, rồi chốt toàn bộ** | giáo vụ bấm **Chốt toàn bộ**              |
| `FINALIZED`   | xem nhóm, đề tài, deadline                  | hướng dẫn, chấm điểm                                | mở khoá lại nếu cần (có ghi log)          | —                                         |

**Việc xếp sinh viên thuộc về giáo vụ, không thuộc về giảng viên.** Không phải vì giảng viên không đủ hiểu đề tài, mà vì **không thầy nào nên có quyền kéo sinh viên vào đề tài của thầy khác** — mà một em chưa có nhóm thì gần như luôn phải xếp vào đề tài của người khác. Đây cũng đúng loại việc ADMIN đã làm ở FR_ADM_04: phân bổ nhóm vào hội đồng và chỉ định phản biện đều cắt ngang toàn khoa. Giao hai việc cùng hình dạng cho hai vai khác nhau là chỗ hệ thống bắt đầu khó giải thích. Vai ADMIN trong tài liệu này **là giáo vụ khoa**, không phải sysadmin — xem mục 1.3.

Ba điểm thiết kế bắt buộc:

- **Pha là một cột trong `semesters`, không phải một phép so sánh ngày.** Nếu suy pha thuần từ `registration_end` thì pha `RECONCILING` không bao giờ kết thúc được: không có chỗ nào ghi nhận việc phân bổ đã xong. Ngày tháng là **mốc kích hoạt**, cột `phase` là **sự thật**.
- **`OPEN → RECONCILING` tự động và kiểm lúc đọc** (lazy), không cần scheduler: truy vấn nào chạm vào học kỳ thì đẩy pha nếu đã quá hạn. Cùng cơ chế với việc hết hạn giữ chỗ ở FR_STU_03a.
- **`RECONCILING → FINALIZED` là sự kiện có người bấm**, ghi lại ai bấm và lúc nào (`finalised_by_id`, `finalised_at`). Đây là thời điểm kết quả phân bổ trở thành chính thức.

### 1.1. Đối với Sinh viên (Student)

- **FR_STU_01 - Quản lý tài khoản:**
  - Đăng nhập, đăng xuất hệ thống.
  - Xem và cập nhật hồ sơ cá nhân: Số điện thoại (`phone`), Giới thiệu bản thân (`bio`).
  - **Quên mật khẩu**: Gửi yêu cầu đặt lại mật khẩu qua email (link reset có thời hạn 15 phút, dùng một lần).
  - **Mã số sinh viên và email là cùng một chuỗi.** Mã gồm **2 chữ số năm nhập học + 5 chữ số thứ tự** (ví dụ `2212345`), và email trường là mã đó cộng tên miền (`2212345@dlu.edu.vn`). Vì vậy khóa của sinh viên **được suy ra từ mã**, không lấy từ ô nhập tay: `khóa = năm nhập học − 1976` (2022 → K46). Lúc import, phần trước `@` của email phải trùng `studentCode`; lệch nhau thì dòng đó bị từ chối chứ không âm thầm chọn một bên. Trường `cohort` lưu **năm nhập học** dạng `"2022"`; số khóa chỉ là cách hiển thị.
- **FR_STU_02 - Xem danh sách đề tài:**
  - Tra cứu, lọc, tìm kiếm các đề tài đang được mở theo học kỳ, loại đồ án (Cơ sở, Chuyên ngành, Tốt nghiệp) và **giảng viên hướng dẫn**.
  - Danh sách **mặc định lọc theo loại đồ án dành cho khóa của sinh viên** trong học kỳ đó (xem FR_ADM_03). Bộ lọc mặc định được hiển thị rõ và gỡ được — lọc ngầm mà không nói khiến người dùng tưởng hệ thống thiếu dữ liệu.
  - Xem chi tiết đề tài (Mô tả, yêu cầu, GV hướng dẫn, số chỗ còn trống).
- **FR_STU_03 - Đăng ký đề tài** _(chỉ ở pha `OPEN`)_:
  - Chọn đề tài và bấm **Đăng ký**. Hệ thống tự tạo nhóm trên chính đề tài đó và đặt người đăng ký làm trưởng nhóm — **đăng ký và tạo nhóm là một hành động**, giao diện không tách thành hai bước. Đăng ký một mình cũng là một nhóm (một người).
  - Đề tài **đã có nhóm nhưng còn ghế mở** thì sinh viên khác bấm **Tham gia** để vào thẳng nhóm đang có — không có bước mời, không có bước chờ chấp nhận. Xem FR_STU_03a.
  - Khi đăng ký, trưởng nhóm **có thể** khai số lượng dự kiến (2 hoặc 3 người). Khai thì các ghế còn lại được **giữ 24 giờ** và chỉ mở cho ai có **link tham gia**; không khai thì ghế mở tự do ngay.
  - Rời nhóm, hoặc giải tán nhóm nếu là trưởng nhóm — chỉ trong pha `OPEN`.
  - **Mỗi học kỳ một sinh viên chỉ tham gia được một nhóm** — chặn ở tầng database bằng partial unique index, không phụ thuộc vào kiểm tra ở tầng ứng dụng.
  - **Chỉ sinh viên thuộc khóa được mở loại đồ án đó mới đăng ký được** (xem FR_ADM_03). Kiểm ở API, không chỉ ở giao diện.

##### FR_STU_03a - Cơ chế phân bổ: ai nhanh hơn người đó được

Hai mô hình đã bị **loại bỏ**. Ghi lại vì lý do loại bỏ vẫn còn giá trị, và để không bị đề xuất lại:

1. **Nhiều nhóm cùng SUBMIT vào một đề tài rồi giảng viên chọn một.** Cộng với quy tắc mỗi sinh viên chỉ một nhóm mỗi học kỳ, nó đẩy người bị loại vào thế kẹt: họ chỉ có đúng một lượt tại một thời điểm, và khi biết mình trượt thì những đề tài còn lại đã bị nhận hết. Rớt càng muộn càng thiệt, và khoa không nhìn thấy tình hình phân bổ cho tới khi mọi giảng viên đã chọn xong.
2. **Mời thành viên theo mã SV rồi chờ chấp nhận.** Đúng về mặt giữ chỗ nhưng quá nhiều bước cho một việc sinh viên đã thống nhất xong ngoài đời: một nhóm 3 người phải làm 6 thao tác qua 3 người và hai vòng chờ 48 giờ, chỉ để ghi nhận một sự thật đã có sẵn. Nó còn kéo theo cả một hệ đếm ghế treo, cap số lời mời và hạn lời mời — dồn phức tạp vào đúng chỗ đông người nhất.

Mô hình hiện tại — **giành chỗ theo thứ tự đến, ở mức từng ghế**:

- **Một đề tài có nhiều nhất một nhóm đang sống.** Người bấm đăng ký đầu tiên tạo nhóm và làm trưởng nhóm; người đến sau **tham gia chính nhóm đó**, không sinh ra nhóm thứ hai. Ràng buộc do database giữ: partial unique index trên `registration_groups(topic_id) WHERE status <> 'REJECTED'` — không cần đếm, không cần khoá, đúng kể cả khi hàng nghìn sinh viên bấm cùng một giây lúc mở cổng.
- `max_students` là **sức chứa của nhóm**, không phải số nhóm. Đề tài hiển thị dạng `2/3`.
- **Tham gia là một cú click.** Không mời theo mã SV, không có bước chấp nhận, không còn trạng thái `INVITED` nào đang dùng: một sinh viên hoặc ở trong nhóm, hoặc không.
- **Giữ chỗ bằng link, không bằng danh tính.** Trưởng nhóm khai "đi 3 người" thì hai ghế còn lại được giữ **24 giờ**, và trong thời gian đó chỉ ai có **link tham gia** mới vào được. Link được dán vào nhóm chat của các em — đúng nơi việc rủ nhau thật sự diễn ra.

  Đây là điểm khác biệt quan trọng so với mô hình mời: người vào nhóm chỉ bấm **một** lần thay vì nhận thông báo rồi mở app rồi chấp nhận, trưởng nhóm không phải gõ mã số của ai, và không cần cap số lời mời hay theo dõi lời mời treo của từng sinh viên — những thứ đó không còn tồn tại.

- **Cửa sổ giữ chỗ có hạn, vì giữ chỗ vô thời hạn là khoá đề tài miễn phí.** 24 giờ đủ cho một bạn đang ở quê chưa mở máy, và không đủ để giam một ghế qua cả đợt. Trưởng nhóm nhả ghế sớm được.
- **Nhóm tự khai còn nhận người hay không** (`open_for_join`, mặc định **có**). Trưởng nhóm tắt để tuyên bố "nhóm tôi đi 2/3, đủ rồi"; đề tài khi đó hiển thị "Đã có nhóm nhận" chứ không phải "còn 1 chỗ" — hiện còn chỗ trong khi nhóm không nhận là nói dối người xem.
- **"Đã đầy" và "còn mở" đều tính lúc đọc, tuyệt đối không lưu thành cột.** Nếu lưu, mọi đường huỷ — thành viên rời nhóm, hết hạn giữ chỗ, nhóm giải tán, admin khoá tài khoản — đều phải nhớ lật ngược lại; quên một đường là đề tài kẹt vĩnh viễn ở trạng thái đầy.

  ```
  ghế_đã_chiếm      = số thành viên hiện có của nhóm
  is_full           = ghế_đã_chiếm >= max_students
  người_lạ_vào_được = open_for_join
                      ∧ now() > hold_until
                      ∧ ghế_đã_chiếm < max_students
  ```

  `hold_until` là **thời hạn**, không phải trạng thái — nó tự hết, không cần ai lật. Nhờ vậy mọi kiểu huỷ đều tự mở lại đề tài mà không cần dòng code nào nhớ làm việc đó.

- Nhóm bị huỷ hoặc giải tán **không xoá cứng** — chuyển `REJECTED`. Trạng thái này nằm ngoài partial unique index nên đề tài tự động trở lại thị trường, đồng thời vẫn giữ được dấu vết ai từng rút.
- **Không còn bước giảng viên duyệt từng nhóm.** Đủ người là xong. Việc rà soát diễn ra **một lần cho cả khoa** ở pha `RECONCILING` — xem FR_STU_03b và FR_LEC_03.

_(Các cơ chế phân bổ cạnh tranh — đăng ký nguyện vọng có thứ tự, đấu giá — là **tính năng riêng**, xem FR_ADM_03.)_

##### FR_STU_03b - Sau khi cổng đóng: sinh viên chưa có nhóm

Đăng ký tự do làm phần lớn sinh viên tự tìm được chỗ ngay trong pha `OPEN` — đây là lý do chính để chọn nó, vì mỗi em tự xử lý được là một em giảng viên không phải xếp tay. Nhưng không bao giờ hết sạch: có em quên đăng ký, có em bảo lưu, có em bị nhóm giải tán sát hạn. Khi sang pha `RECONCILING`:

- Sinh viên **không tự đăng ký được nữa**, và cũng **không rời nhóm được**. Nếu còn cho rời thì kết quả phân bổ mà giảng viên vừa dựng sẽ vỡ ngay sau lưng họ.
- Sinh viên chưa có nhóm **được giáo vụ xếp vào** một đề tài còn chỗ (FR_ADM_07). Vì em đó **không tự chọn** đề tài này, hệ thống bắt buộc gửi thông báo kèm lý do khi kết quả được chốt.
- Nhóm chưa đủ sức chứa **vẫn hợp lệ**. Lệnh chốt toàn bộ ở cuối pha chấp nhận cả nhóm `2/3` — `max_students` là mức tối đa, không phải mức bắt buộc.

- **FR_STU_04 - Tự đề xuất đề tài:**
  - Nhập thông tin đề xuất đề tài mới (Tên, Mô tả, Mục tiêu).
  - Chỉ định một Giảng viên mong muốn hướng dẫn hoặc gửi công khai (không chỉ định).
  - Theo dõi trạng thái duyệt đề xuất (Pending, Accepted, Rejected).
  - **Chỉnh sửa và gửi lại (re-submit)** đề xuất sau khi bị GV từ chối kèm nhận xét — trạng thái tự động về lại `PENDING` sau khi SV re-submit.
- **FR_STU_06 - Nộp báo cáo / Sản phẩm (Submissions):**
  - Upload file báo cáo (.docx, .pdf) cho các đợt Giữa kỳ và Cuối kỳ.
  - Nộp link GitHub/Drive (`submission_url`) thay cho file tải lên (phục vụ nộp source code).
  - Hỗ trợ nộp nhiều lần (versioning — theo dõi bằng trường `version`) trước khi hết hạn deadline.
- **FR_STU_07 - Tra cứu kết quả:**
  - Xem điểm số cá nhân: Điểm hướng dẫn (`mentor_grade`), Điểm phản biện (`reviewer_grade`), Điểm hội đồng (`council_grade`) — tất cả đều được chấm **riêng theo từng sinh viên**.
  - Điểm tổng kết (`final_grade`) tính theo trọng số của học kỳ (`mentor_weight`, `reviewer_weight`, `council_weight` trong bảng `semesters`) và được **chốt cứng** kèm `finalised_at` khi hết hạn chốt điểm. Bảng điểm đã công bố không thay đổi nếu kỳ sau khoa chỉnh lại trọng số.
  - Xem nhận xét, đánh giá từ giảng viên.
  - Xem lịch trình, địa điểm và thời gian bảo vệ đồ án.
- **FR_STU_08 - Trang cá nhân:**
  - Xem hồ sơ: họ tên, mã SV, lớp, chuyên ngành, khóa, `bio`, và **lịch sử đồ án theo từng học kỳ** (đề tài, nhóm, GV hướng dẫn). Gần như toàn bộ là **view đọc** trên dữ liệu đã có, không phát sinh nghiệp vụ mới.
  - **Điểm và nhận xét không bao giờ xuất hiện trên trang cá nhân của người khác.** Trang của mình và trang của người khác là hai tập trường khác nhau, và việc chọn tập nào diễn ra ở **server** — không phải ẩn bớt ở client.
  - Số điện thoại chỉ hiện cho người khác nếu chủ tài khoản tự bật.

#### 1.1.1. Nhóm đăng ký (Group Registration)

Nhóm **luôn gắn với một đề tài kể từ lúc sinh ra** — `registration_groups.topic_id` là NOT NULL, nên không tồn tại trạng thái "nhóm đã lập, đang đi tìm đề tài". Thứ tự luôn là chọn đề tài trước, nhóm hình thành tại đó. Đây cũng là lý do giao diện không được bày ra bước "tạo nhóm" riêng: sinh viên chỉ thấy **Đăng ký đề tài**, còn từ "nhóm" xuất hiện sau đó như một hệ quả.

Nhóm là đơn vị mà toàn bộ phần sau của hệ thống bám vào: bài nộp (`submissions.group_id`), điểm hướng dẫn và nhận xét từng sinh viên (`registration_group_members`), lịch bảo vệ (`council_topics.group_id`), điểm phản biện và hội đồng (`council_topic_grades`).

- **FR_STU_GRP_01:** Đăng ký một đề tài chưa có nhóm → hệ thống tạo nhóm và đặt người đăng ký làm trưởng nhóm.
- **FR_STU_GRP_02:** Tham gia một nhóm đang còn ghế mở, bằng **một** thao tác. Không có bước chờ ai chấp nhận.
- **FR_STU_GRP_03:** Trưởng nhóm khai số lượng dự kiến khi đăng ký và nhận **link tham gia**; ghế được giữ 24 giờ cho ai có link, và trưởng nhóm nhả sớm được.
- **FR_STU_GRP_04:** Trưởng nhóm xoá thành viên khỏi nhóm trong pha `OPEN`; ghế nhả ra ngay. Mọi lần xoá đều ghi `audit_logs` — đây là quyền dễ bị lạm dụng nhất mà sinh viên có trong hệ thống.
- **FR_STU_GRP_05:** Thành viên tự rời nhóm trong pha `OPEN`. **Trưởng nhóm không rời được:** phải chuyển quyền trưởng nhóm cho người khác, hoặc giải tán nhóm — nếu không sẽ có nhóm không còn ai chịu trách nhiệm.
- **FR_STU_GRP_06:** Xem trạng thái nhóm của bản thân và danh sách thành viên cùng nhóm (tên, mã SV, lớp, chuyên ngành, email).
- **FR_STU_GRP_07:** Trưởng nhóm tắt/bật `open_for_join` để tuyên bố nhóm đã đủ hay còn nhận thêm.
- **FR_STU_GRP_08:** Trưởng nhóm giải tán nhóm trong pha `OPEN`; nhóm chuyển `REJECTED` và đề tài trở lại thị trường ngay.
- **FR_STU_GRP_09:** Từ pha `RECONCILING` trở đi, **toàn bộ** các thao tác trên bị khoá — chỉ giáo vụ còn thay đổi được thành phần nhóm (FR_ADM_07).

Bốn trạng thái nhóm **đổi ý nghĩa** theo mô hình mới, nhưng enum giữ nguyên nên không cần migration:

| Trạng thái  | Nghĩa mới                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `FORMING`   | còn ghế trống                                                                                        |
| `SUBMITTED` | **tự động** khi đủ sức chứa: đủ người, chờ chốt. Không còn nút Submit nào cho sinh viên bấm.         |
| `APPROVED`  | đã chốt ở cuối pha `RECONCILING` — kết quả của lệnh chốt toàn bộ, không phải của một lần duyệt riêng |
| `REJECTED`  | nhóm tự giải tán hoặc bị huỷ                                                                         |

**Màn hình của sinh viên đổi theo pha, không phải một màn hình cố định:**

1. **`OPEN`, chưa có nhóm** — danh sách đề tài là nội dung chính, lọc mặc định theo khóa của em.
2. **`OPEN`, đã có nhóm** — đề tài và nhóm của mình lên đầu, kèm link tham gia nếu còn ghế đang giữ; danh sách đề tài lùi xuống nhưng **vẫn xem được**, vì em còn quyền rời nhóm để đổi.
3. **`RECONCILING`** — chỉ đọc, và nói rõ tại sao: "Cổng đăng ký đã đóng, khoa đang rà soát phân bổ". Nếu em chưa có nhóm thì nói thẳng là đang chờ được xếp — im lặng ở đúng thời điểm này là lúc sinh viên hoảng nhất.
4. **`FINALIZED`** — không còn danh sách đề tài; chỉ còn đề tài của mình, nhóm, GV hướng dẫn và các deadline sắp tới.

### 1.2. Đối với Giảng viên (Lecturer)

- **FR_LEC_01 - Quản lý tài khoản:**
  - Đăng nhập, đăng xuất hệ thống.
  - Cập nhật hồ sơ cá nhân: Chức danh, Số điện thoại (`phone`), Giới thiệu bản thân (`bio`), Hướng nghiên cứu (`research_interests`).
- **FR_LEC_02 - Quản lý Đề tài do GV ra đề:**
  - Tạo đề tài mới, thiết lập số lượng sinh viên tối đa (`max_students` — sức chứa của nhóm sẽ làm đề tài), yêu cầu đầu ra.
  - Chỉnh sửa hoặc xóa đề tài (chỉ xóa được khi chưa có SV nào đăng ký).
  - Đóng/Mở cổng đăng ký của đề tài. Lưu ý phân biệt hai khái niệm: `TopicStatus.OPEN` nói về **cổng do giảng viên mở**, còn `is_full` nói về **ghế đã đủ người** — đề tài đang OPEN vẫn có thể đã đầy, và ngược lại.
- **FR_LEC_03 - Nhóm đăng ký & Duyệt đề xuất:**
  - **Không còn bước duyệt từng nhóm đăng ký.** Đề tài thuộc về nhóm nhận đầu tiên, đủ người là xong (FR_STU_03a). Với cơ chế giành chỗ theo thứ tự đến, giảng viên **không có lựa chọn nào để đưa ra** — chỉ có gật hoặc lắc — nên một con dấu trên từng nhóm chỉ để sinh viên nằm chờ, và tạo ra một trạng thái treo mà lỗi không thuộc về họ.
  - **Phân bổ cuối đợt là việc của giáo vụ, không phải của giảng viên** — xem FR_ADM_07. Giảng viên **được thông báo** khi có sinh viên bị xếp vào đề tài của mình, nhưng **không phải phê duyệt**: thêm một bước xin phép ở đây là dựng lại đúng cái nút duyệt vừa bỏ ở gạch đầu dòng trên. Thầy nào thấy không ổn thì nói với giáo vụ — lúc đó vẫn ở pha `RECONCILING`, sửa được thoải mái vì chưa chốt.
  - **Duyệt SV đề xuất:** Xem danh sách ý tưởng SV gửi lên, Chấp nhận hướng dẫn (tự động tạo thành đề tài chính thức) hoặc Từ chối kèm lý do phản hồi.
- **FR_LEC_04 - Theo dõi tiến độ & Báo cáo:**
  - Xem danh sách **tất cả các phiên bản nộp** (theo trường `version`) của từng nhóm, tải về hoặc xem từng phiên bản riêng lẻ.
  - Viết phản hồi/nhận xét trực tiếp trên từng lần nộp (`lecturer_feedback` trong bảng `submissions`).
- **FR_LEC_05 - Đánh giá (Chấm điểm hướng dẫn):**
  - Viết nhận xét tổng kết quá trình làm việc của từng SV (`mentor_comment` trong bảng `registration_group_members`).
  - Nhập "Điểm hướng dẫn" riêng cho từng thành viên nhóm (`mentor_grade` trong bảng `registration_group_members`).
  - Điểm chỉ có thể nhập/sửa **trước deadline chốt điểm** (`grade_submission_deadline`) do Admin thiết lập cho từng học kỳ. Sau thời hạn này, điểm bị **khóa** và không thể chỉnh sửa.
- **FR_LEC_06 - Đánh giá Phản biện / Hội đồng:**
  - Nếu được phân công làm **GV phản biện**: Xem báo cáo của nhóm được phân công, nhập **"Điểm phản biện" riêng cho từng thành viên** (`reviewer_grade` trong bảng `council_topic_grades`). Phản biện được phân theo **từng đề tài** qua `council_topics.reviewer_id` — đây là nơi duy nhất xác định vai trò này, `council_members.council_role` không còn giá trị REVIEWER.
  - Nếu nằm trong **hội đồng**: Xem danh sách nhóm bảo vệ trong phiên của mình, nhập **"Điểm hội đồng" riêng cho từng thành viên** (`council_grade` trong bảng `council_topic_grades`).

#### 1.2.1. Nhóm đăng ký (Group Registration)

- **FR_LEC_GRP_01:** Xem nhóm đã nhận từng đề tài của mình (mỗi đề tài nhiều nhất một nhóm đang sống), kèm hồ sơ từng thành viên: tên, mã SV, lớp, chuyên ngành.
- **FR_LEC_GRP_02:** Chấm điểm hướng dẫn riêng cho từng thành viên (`mentor_grade` trong `registration_group_members`).
- **FR_LEC_GRP_03:** Nhận thông báo khi giáo vụ xếp một sinh viên vào đề tài của mình ở pha `RECONCILING`, và thấy rõ trên màn hình nhóm rằng thành viên đó vào bằng đường xếp tay (`join_source = ASSIGNED`) chứ không tự đăng ký. Giảng viên **không phê duyệt** việc xếp này — xem FR_LEC_03.

_Bàn phân bổ và lệnh chốt toàn bộ thuộc về giáo vụ, xem **FR_ADM_07**._

### 1.3. Đối với Quản trị viên (Admin / Giáo vụ Khoa)

- **FR_ADM_01 - Quản lý Người dùng:**
  - Thêm, sửa, khóa/mở khóa (deactivate) tài khoản của Giảng viên, Sinh viên. **Không xóa cứng**: `audit_logs` giữ lịch sử thao tác nhạy cảm bằng khóa ngoại RESTRICT, và sinh viên đã vào nhóm cũng bị RESTRICT giữ lại — xóa cứng vừa thất bại về mặt kỹ thuật, vừa xóa mất chính dấu vết cần lưu. `DELETE /users/:id` thực hiện khóa tài khoản và thu hồi toàn bộ refresh token.
  - Import danh sách tài khoản hàng loạt bằng file Excel (.csv, .xlsx).
  - **Mã lớp phải được kiểm chéo, không nhận làm text tự do.** Mã lớp ở trường mang khuôn `CT` + `K{số khóa}` + `{mã ngành}` — `CTK46PM`, `CTK46MMT` — nghĩa là nó **mã hoá lại hai dữ kiện đã có nguồn khác**: khóa (suy từ mã SV) và chuyên ngành (cột `majorCode`). Ba nguồn cho hai dữ kiện, mà hiện chỉ một nguồn được kiểm.
    - Mã lớp **đúng khuôn nhưng mâu thuẫn** với khóa suy từ mã SV, hoặc với `majorCode` → **từ chối dòng đó**, đúng như cách một dòng có email lệch mã SV đang bị từ chối. Âm thầm chọn một bên nghĩa là sáu tháng sau không ai biết em đó học ngành nào, và mọi báo cáo theo chuyên ngành đều sai mà không có dấu hiệu gì.
    - Mã lớp **không khớp khuôn** (lớp chất lượng cao, lớp ghép, khuôn mới) → **nhận nhưng cảnh báo**, và báo lại trong kết quả import. Chặn cứng ở đây sẽ làm giáo vụ không import nổi một lớp hợp lệ chỉ vì hệ thống chưa biết khuôn của nó.
  - **Reset mật khẩu** cho Giảng viên/Sinh viên: Admin đặt lại về mật khẩu tạm thời, người dùng buộc phải đổi mật khẩu khi đăng nhập lần đầu sau reset.
- **FR_ADM_02 - Quản lý Danh mục (Master Data):**
  - Quản lý Học kỳ (Mở học kỳ mới, thiết lập ngày bắt đầu/kết thúc).
  - Quản lý Loại đồ án (`project_types`).
  - Quản lý Chuyên ngành (`majors`): Thêm, sửa, xóa các chuyên ngành. Danh sách phẳng, **không phân cấp theo bộ môn** — toàn hệ thống phục vụ đúng một khoa (vai trò Admin là Giáo vụ Khoa) và không có quy tắc nghiệp vụ nào phụ thuộc vào bộ môn: sinh viên đăng ký được đề tài của bất kỳ giảng viên nào, giảng viên nào cũng nhận hướng dẫn được.
- **FR_ADM_03 - Quản lý Quy trình & Đợt đăng ký:**
  - Thiết lập cửa sổ thời gian đăng ký đề tài theo học kỳ: `registration_start` và `registration_end` trong bảng `semesters`.
  - Hệ thống tự động chuyển `OPEN → RECONCILING` khi quá `registration_end`, không cần Admin can thiệp thủ công. Bốn pha và ai được làm gì ở mỗi pha: xem mục **1.0**.
  - **Xếp sinh viên chưa có nhóm và chốt phân bổ** ở pha `RECONCILING` — xem FR_ADM_07.
  - **Mở khoá học kỳ đã chốt** (`FINALIZED → RECONCILING`), có ghi log.
  - (Tùy chọn) Xét duyệt lần cuối các đề tài của giảng viên trước khi public cho SV.
  - **Khai báo khóa nào làm loại đồ án nào trong học kỳ.** Cùng một kỳ, khoa thường mở Đồ án Cơ sở cho K47, Chuyên ngành cho K46, Tốt nghiệp cho K45. Quy tắc này là **dữ liệu do giáo vụ khai**, không suy ra từ năm học của sinh viên — suy ra sẽ sai ngay với sinh viên học chậm, học vượt, bảo lưu hoặc học lại, mà nhóm đó không hề hiếm. Mô hình hoá đúng như thông báo khoa vẫn ra:

    ```
    SemesterEligibility(semester_id, project_type_id, cohort)
      UNIQUE(semester_id, project_type_id, cohort)
    ```

    Bảng này chịu được cả trường hợp một khóa được mở hai loại đồ án trong cùng kỳ — chỉ là hai dòng. Nó phục vụ hai chiều: lọc mặc định danh sách đề tài cho sinh viên (FR_STU_02), và **chặn ở API** khi sinh viên nhận đề tài không thuộc diện của khóa mình (FR_STU_03).

  - **Cơ chế phân bổ của học kỳ** — `semesters.allocation_mode`:
    - `FIRST_COME` _(mặc định, phạm vi hiện tại)_: ai nhận trước người đó được, theo FR_STU_03a.
    - `PREFERENCE_ROUND` _(v2, chưa triển khai)_: sinh viên nộp tối đa 3 nguyện vọng có thứ tự trong một cửa sổ; hết cửa sổ chạy một lượt phân bổ tập trung (thuật toán chấp nhận trì hoãn, ưu tiên theo điểm tích luỹ hoặc thời điểm nộp). Enum được đặt sẵn ngay từ đầu để sau này thêm chế độ là **mở rộng chứ không phải viết lại** phần đăng ký.
- **FR_ADM_04 - Quản lý Hội đồng bảo vệ (Councils):**
  - Tạo Hội đồng bảo vệ (Tên, ngày giờ, địa điểm).
  - Phân công Giảng viên vào hội đồng (Chủ tịch, Thư ký, Ủy viên...).
  - Phân bổ danh sách các nhóm đề tài vào Hội đồng tương ứng.
  - Chỉ định **GV Phản biện** (`reviewer_id`) cho từng đề tài trong hội đồng.
- **FR_ADM_05 - Báo cáo & Thống kê:**
  - Xuất bảng điểm tổng kết (Excel/PDF).
  - Xem biểu đồ thống kê: Tỷ lệ hoàn thành đồ án, Phân bổ số lượng SV theo từng giảng viên hướng dẫn và theo chuyên ngành.
  - **Tỷ lệ tự đăng ký so với xếp tay** mỗi học kỳ (đếm theo `join_source`) — thước đo trực tiếp xem cơ chế đăng ký tự do có đang làm đúng việc của nó hay không.
- **FR_ADM_06 - Danh sách sinh viên toàn khoa:**
  - Một bảng duy nhất, có tìm kiếm / lọc / phân trang, các cột: **mã SV, họ tên, lớp, chuyên ngành, khóa, nhóm, đề tài, GV hướng dẫn, ghi chú**.
  - Lọc theo: học kỳ, khóa, chuyên ngành, lớp, **tình trạng nhóm** (đã có / chưa có), giảng viên hướng dẫn.
  - `note` là ô ghi tay tự do của giáo vụ ("bảo lưu HK1", "đã gọi điện chưa phản hồi"). Mọi hệ thống hành chính thật đều cần một ô như vậy, vì thực tế luôn có ca mà schema không lường được — không có nó thì thông tin ấy chạy sang một file Excel riêng và biến mất khỏi hệ thống.
  - Xuất Excel.
  - **Bàn phân bổ ở FR_ADM_07 dùng lại đúng bảng này**, chỉ khác bộ lọc mặc định (`nhóm = chưa có`) và tập hành động. Đây là **ràng buộc thiết kế, không phải gợi ý**: mỗi lần sinh thêm một "danh sách sinh viên" hơi khác là thêm một chỗ phải sửa khi đổi cột, và thêm một cơ hội để hai bảng báo hai con số khác nhau về cùng một việc.
- **FR_ADM_07 - Bàn phân bổ & Chốt đợt đăng ký** _(pha `RECONCILING`)_:
  - Một màn hình hai cột: **sinh viên chưa có nhóm** bên trái, **nhóm còn chỗ** bên phải. Bốn yêu cầu bắt buộc:
    - **Hiện phép trừ ngay đầu màn hình, trước khi bắt đầu xếp:** `N sinh viên chưa có nhóm · M ghế trống · thiếu/thừa K`. Để giáo vụ kéo tay 90 lần rồi mới phát hiện cả khoa không đủ chỗ là thiết kế sai — thông tin quyết định phải đến **trước** công sức, không phải sau. Thiếu ghế thì đây là lúc mở thêm đề tài hoặc nâng `max_students`, không phải lúc xếp.
    - **Phân loại lý do chưa có nhóm**, vì hai loại này xử lý khác nhau: _chưa từng đăng ký_ (có thể đã bảo lưu, có thể phải gọi điện) và _nhóm bị giải tán / bạn rút_ (đã cố gắng, nên được ưu tiên xếp trước). Gộp thành một danh sách phẳng là mất đúng thông tin quan trọng nhất.
    - **Gợi ý theo chuyên ngành khớp**, để giáo vụ không phải tự dò từng đề tài.
    - **Tôn trọng eligibility khi xếp:** kéo một sinh viên vào loại đồ án không mở cho khóa của em thì bị chặn tại chỗ kèm lý do — không để lỗi này lọt tới lúc chốt mới phát hiện.
  - **Xếp sinh viên vào nhóm.** Thành viên được xếp tay mang dấu `join_source = ASSIGNED` cùng người xếp và thời điểm. Không có dấu này thì kỳ sau không trả lời được câu "vừa rồi phải xếp tay bao nhiêu em" — con số mà khoa sẽ hỏi mỗi năm, và cũng là thước đo xem cơ chế tự đăng ký có hiệu quả hay không (FR_ADM_05). Giảng viên chủ đề tài được thông báo (FR_LEC_GRP_03).
  - **Nâng `max_students` của một đề tài** khi cả khoa thiếu ghế. Giảng viên chủ đề tài được thông báo — sức chứa là cam kết hướng dẫn của thầy, nên đổi mà không nói là đổi khối lượng công việc của người khác sau lưng họ.
  - **Chốt toàn bộ** — hành động khối lớn và khó đảo, nên bắt buộc:
    - **Xem trước rồi mới chốt:** hiện đúng những gì sẽ xảy ra — số nhóm, số sinh viên, số nhóm dưới sức chứa, số sinh viên còn chưa có nhóm.
    - **Chặn cứng khi còn sinh viên chưa xếp**, trừ khi bấm "bỏ qua các em này" kèm **lý do bắt buộc**. Lý do đó được lưu, vì nó chính là câu trả lời cho khiếu nại sau này.
    - **Chạy trong một transaction và idempotent:** bấm hai lần không tạo ra hai kết quả.
    - **Ghi `audit_logs`** cho cả lệnh chốt và từng lần xếp tay. Mỗi lần xếp là **ghi đè lựa chọn cá nhân của một sinh viên**; không lưu vết thì khoa không có gì để trả lời khi em đó hỏi "sao em lại vào đề tài này".
    - **Thông báo cho sinh viên bị xếp tay** (FR_SYS_01): em ấy không chọn đề tài này, nên phải được nói rõ đề tài nào, giảng viên nào và vì sao.
  - **Mở khoá lại sau khi chốt** (`FINALIZED → RECONCILING`), có ghi log. Hệ thống nghiệp vụ thật không làm "không thể hoàn tác" — nó làm "hoàn tác được nhưng để lại dấu", vì chắc chắn sẽ có ca chốt xong mới phát hiện nhập sai.

### 1.4. Yêu cầu Hệ thống (System Requirements)

- **FR_SYS_01 - Thông báo (Notifications):**
  - Mỗi thông báo mang một `type` (enum) và `target_id` trỏ tới bản ghi liên quan, để client lọc được theo loại và điều hướng được khi người dùng bấm vào.
  - Hệ thống tự động đẩy thông báo in-app (lưu vào bảng `notifications`) trong các trường hợp:
    - Đề xuất đề tài được duyệt / từ chối.
    - Có người tham gia nhóm của mình / bị xoá khỏi nhóm / nhóm bị giải tán.
    - **Cổng đăng ký sắp đóng mà mình chưa có nhóm.** Đây là thông báo có giá trị nhất trong cả hệ thống, vì nó là thông báo duy nhất còn kịp để sinh viên tự xử lý.
    - **Được giáo vụ xếp vào nhóm** (pha `RECONCILING`) — bắt buộc, kèm đề tài, GV hướng dẫn và lý do. Sinh viên không tự chọn đề tài này nên không thể để em ấy tự phát hiện ra.
    - **Gửi cho giảng viên: có sinh viên được xếp vào đề tài của mình, hoặc `max_students` của đề tài mình bị nâng.** Cả hai đều là thay đổi trên đề tài của thầy do người khác quyết, nên phải được nói — dù thầy không có quyền phủ quyết (FR_LEC_03).
    - **Kết quả phân bổ của học kỳ đã được chốt.**
    - Báo cáo nộp có nhận xét mới từ GV.
    - Có điểm mới được nhập.
    - Sắp tới deadline nộp báo cáo hoặc deadline chốt điểm.
- **FR_SYS_02 - Gửi Email** _(v2 / Nice-to-have — ngoài phạm vi v1):_
  - Gửi email nhắc nhở deadline nộp bài, thông báo thay đổi lịch bảo vệ đến SV và GV.
  - Yêu cầu tích hợp dịch vụ SMTP hoặc bên thứ ba (SendGrid, Resend) — **không triển khai trong v1**.
- **FR_SYS_03 - Audit Log (Ghi lịch sử thao tác):**
  - Mọi hành động nhạy cảm (Nhập/Sửa điểm, Xóa đề tài, Khóa tài khoản) của Admin và Giảng viên phải được ghi lại tự động vào bảng `audit_logs`.
  - Mỗi log ghi lại: Người thực hiện, Hành động, Bảng bị tác động, ID bản ghi, Giá trị cũ (JSON), Giá trị mới (JSON), Thời điểm.
  - Phạm vi bắt buộc ghi log ở phần đăng ký: **xếp sinh viên vào nhóm**, **chốt toàn bộ**, **mở khoá học kỳ đã chốt**, và **trưởng nhóm xoá thành viên**.

### 1.5. Ngoài phạm vi (đã cân nhắc và loại)

Ghi lại để không phải cân nhắc lại mỗi vài tháng, và để lý do loại còn kiểm chứng được về sau:

- **Chat / tin nhắn trong app.** Chat không phải một tính năng, nó là **một sản phẩm**: realtime, trạng thái đã đọc, thông báo đẩy, gửi ảnh và file, lịch sử, chặn/báo cáo, và bản mobile — chi phí xấp xỉ cả module chấm điểm và hội đồng cộng lại. Trong khi đó sinh viên đã dùng Messenger/Zalo mười hai tiếng mỗi ngày, còn một app học vụ mỗi kỳ mở vài lần thì tin nhắn gửi vào sẽ không ai đọc: **tệ hơn là không có, vì nó hứa một kênh liên lạc rồi không giữ lời.** Phần liên lạc thật sự cần lưu vết chính thức thì đã có chỗ — `submissions.lecturer_feedback` và `registration_group_members.mentor_comment`.
  - Thay thế: hiện email thành viên cùng nhóm và GV hướng dẫn, kèm nút mở mail. Cộng với module `notifications` — đó mới là kênh mà **hệ thống bắt buộc phải nói** (bị xếp nhóm, sắp hết hạn, có lịch bảo vệ).
- **Bảng `tasks` / giao việc trong nhóm.** Đã loại từ v1: sinh viên và giảng viên tự quản lý bằng công cụ ngoài.
- **Gửi email tự động** — xem FR_SYS_02, để v2.
- **`PREFERENCE_ROUND`** (đăng ký nguyện vọng có thứ tự) — enum đã đặt sẵn, chưa triển khai. Xem FR_ADM_03.

---

## 2. YÊU CẦU PHI CHỨC NĂNG (Non-Functional Requirements - NFR)

### 2.1. Hiệu năng (Performance)

- **Thời gian phản hồi (Response Time):**
  - Các thao tác thông thường (xem danh sách, chuyển trang, đăng nhập): Phản hồi dưới **2 giây**.
  - Các thao tác nặng (xuất báo cáo Excel/PDF, upload file báo cáo): Phản hồi dưới **5 giây**.
- **Khả năng chịu tải (Concurrency / Scalability):**
  - Hệ thống phải duy trì ổn định trong các **"đợt cao điểm"** (ngày mở cổng đăng ký đề tài), có thể chịu tải đồng thời từ **500 - 1000** sinh viên thao tác cùng lúc mà không bị crash.

### 2.2. Bảo mật (Security)

- **Xác thực & Ủy quyền (Auth):**
  - Sử dụng JWT (JSON Web Token) và chia Role rõ ràng ở cả Frontend & Backend (Role-based Access Control - RBAC).
  - Sinh viên **tuyệt đối không** có quyền chỉnh sửa điểm hoặc xem điểm/báo cáo của nhóm khác (nếu không được phép).
- **Mã hóa:**
  - Mật khẩu phải được băm (hash) bằng các thuật toán bảo mật (Bcrypt hoặc Argon2) trước khi lưu vào DB.
  - Toàn bộ giao tiếp mạng phải qua giao thức HTTPS.

### 2.3. Khả năng Lưu trữ & Dữ liệu (Storage & Data)

- **Lưu trữ File:** Các tệp tin báo cáo (.docx, .pdf), source code (.zip) không được lưu trực tiếp trong server ứng dụng. Phải dùng dịch vụ Cloud Storage (**AWS S3, Google Cloud Storage**) hoặc File Server riêng biệt.
- **Giới hạn file upload:** Mỗi lần upload tối đa **50MB/file**. Chỉ chấp nhận định dạng `.pdf`, `.docx`, `.zip`. Validation bắt buộc ở cả **Frontend** (trước khi gửi) và **Backend** (sau khi nhận).
- **Sao lưu (Backup):** Database cần được backup định kỳ (tối thiểu 1 lần/ngày) để tránh mất mát điểm số, thông tin đồ án quan trọng.

### 2.4. Tính Khả dụng & Giao diện (Usability / UI-UX)

- **Responsive Design:** Giao diện bắt buộc phải hoạt động tốt, không vỡ layout trên đa thiết bị (Desktop, Laptop, Tablet, Mobile) – đặc biệt là Mobile vì sinh viên thường xuyên xem điểm, thông báo bằng điện thoại.
- **Trải nghiệm người dùng:**
  - Các bảng danh sách (Đề tài, Điểm số, Người dùng) phải hỗ trợ **Tìm kiếm (Search), Phân trang (Pagination) và Lọc (Filter)**.
  - Cần có cơ chế cảnh báo (Warning Dialog) khi thực hiện các hành động nguy hiểm: Xóa đề tài, Hủy đăng ký, Chốt điểm.
  - Riêng các hành động **khối lớn và khó đảo** — chốt phân bổ toàn học kỳ, chốt điểm — thì một dialog "bạn có chắc không" là **không đủ**: phải hiện **con số cụ thể sẽ bị tác động** trước khi cho bấm (xem FR_ADM_07). Người dùng bấm qua dialog theo phản xạ; họ dừng lại khi thấy một con số bất thường.

### 2.5. Tính Khả dụng (Availability)

- **Uptime mục tiêu:** Hệ thống phải đảm bảo hoạt động **≥ 99%** thời gian trong suốt mỗi học kỳ.
- **Không downtime vào thời điểm nhạy cảm:** Không được có sự cố hoặc bảo trì ngoài kế hoạch vào các ngày mở cổng đăng ký đề tài, deadline nộp báo cáo, hoặc ngày công bố điểm.
- **Graceful Degradation:** Nếu dịch vụ Cloud Storage gặp sự cố, hệ thống vẫn phải cho phép SV xem thông tin đề tài và điểm số — chỉ tạm thời vô hiệu hoá tính năng upload file.

### 2.6. Khả năng Bảo trì & Nâng cấp (Maintainability)

- **Kiến trúc mã nguồn:** Codebase phải được phân tách rõ ràng (Layered Architecture, MVC, hoặc Modular). Đảm bảo tuân thủ nguyên tắc SOLID.
- **API Chuẩn hóa:** Hệ thống giao tiếp bằng chuẩn RESTful API, giúp cho việc kết nối thêm Mobile App (nếu có sau này) một cách dễ dàng, không cần sửa đổi backend.
- **Audit Log:** Đã được định nghĩa trong FR_SYS_03 — xem bảng `audit_logs` trong tài liệu thiết kế database.
