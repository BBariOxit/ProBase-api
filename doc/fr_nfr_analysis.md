# Phân tích Yêu cầu Chức năng (FR) và Phi Chức năng (NFR)

Tài liệu này định nghĩa chi tiết các yêu cầu để xây dựng Hệ thống Quản lý Đồ án Công nghệ Thông tin.

---

## 1. YÊU CẦU CHỨC NĂNG (Functional Requirements - FR)

Yêu cầu chức năng được phân tách rõ ràng theo từng nhóm đối tượng sử dụng (Actor).

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
- **FR_STU_03 - Đăng ký đề tài:**
  - Chọn đề tài và bấm **Đăng ký**. Hệ thống tự tạo nhóm trên chính đề tài đó và đặt người đăng ký làm trưởng nhóm — **đăng ký và tạo nhóm là một hành động**, giao diện không tách thành hai bước. Đăng ký một mình cũng là một nhóm (một người).
  - Mời thêm thành viên theo mã SV hoặc email, tối đa `max_students` của đề tài.
  - Hủy đăng ký (chỉ được phép khi nhóm chưa ở trạng thái APPROVED và còn trong thời hạn đăng ký).
  - **Mỗi học kỳ một sinh viên chỉ tham gia được một nhóm.** Được mời vào nhiều nhóm là bình thường, nhưng chấp nhận (ACCEPTED) lời mời thứ hai trong cùng học kỳ sẽ bị từ chối ở tầng database (partial unique index), không phụ thuộc vào kiểm tra ở tầng ứng dụng.
  - **Chỉ sinh viên thuộc khóa được mở loại đồ án đó mới đăng ký được** (xem FR_ADM_03). Kiểm ở API, không chỉ ở giao diện.

##### FR_STU_03a - Cơ chế phân bổ: ai nhanh hơn người đó được

Mô hình trước đây cho **nhiều nhóm cùng SUBMIT vào một đề tài rồi giảng viên chọn một**. Mô hình đó bị **loại bỏ**, vì cộng với quy tắc mỗi sinh viên chỉ một nhóm mỗi học kỳ, nó đẩy người bị loại vào thế kẹt: họ chỉ có đúng một lượt tại một thời điểm, và khi biết mình trượt thì những đề tài còn lại đã bị nhận hết. Rớt càng muộn càng thiệt, và khoa không nhìn thấy tình hình phân bổ cho tới khi mọi giảng viên đã chọn xong.

Thay bằng cơ chế **giành chỗ theo thứ tự đến**:

- **Nhóm đầu tiên chạm vào đề tài là chủ đề tài đó.** Nhóm thứ hai bị từ chối ngay ở tầng database bằng partial unique index trên `registration_groups(topic_id) WHERE status <> 'REJECTED'` — không cần đếm, không cần khoá, và đúng kể cả khi hàng nghìn sinh viên bấm cùng một giây lúc mở cổng.
- `max_students` là **sức chứa của nhóm**, không phải số nhóm. Đề tài hiển thị dạng `2/3`.
- **Số ghế đã chiếm = thành viên `ACCEPTED` + lời mời `INVITED` đang treo.** Lời mời chính là cơ chế giữ chỗ: nhóm 2 người mời bạn thứ ba thì đề tài thành `3/3` ngay, không có khe hở cho người lạ chen vào trong lúc chờ. Bạn đó từ chối hoặc lời mời hết hạn thì ghế nhả ra.
- Để giữ chỗ không biến thành công cụ khoá đề tài miễn phí: **lời mời hết hạn sau 48 giờ** (tự chuyển `DECLINED`), và mỗi sinh viên chỉ được có tối đa **3 lời mời đang treo**.
- **Nhóm tự khai còn nhận người hay không** (`open_for_join`, mặc định **không**). Nhóm chưa đầy nhưng đóng thì hiển thị "Đã có nhóm nhận" chứ không phải "còn 1 chỗ" — hiện còn chỗ trong khi ghế đã có chủ là nói dối người xem. Nhóm muốn tìm thêm thành viên thì tự bật.
- **Nhận ghế phải là thao tác nguyên khối.** Nhóm 2 người xin vào đề tài chỉ còn 1 ghế thì **trượt toàn bộ**, không nhận một người rồi bỏ người kia lơ lửng.
- **Trạng thái "đã đầy" được tính lúc đọc, tuyệt đối không lưu thành cột.** Nếu lưu, mọi đường huỷ — thành viên rời nhóm, lời mời hết hạn, lời mời bị từ chối, nhóm giải tán, GV từ chối, admin khoá tài khoản — đều phải nhớ lật ngược lại; quên một đường là đề tài kẹt vĩnh viễn ở trạng thái đầy. Tính `is_full = số_ghế_đã_chiếm >= max_students` khi đọc thì mọi kiểu huỷ đều tự mở lại đề tài mà không cần dòng code nào nhớ làm việc đó.
- Nhóm bị huỷ hoặc bị từ chối **không xoá cứng** — chuyển `REJECTED`. Trạng thái này nằm ngoài partial unique index nên đề tài tự động trở lại thị trường, đồng thời vẫn giữ được dấu vết ai từng rút và bị từ chối vì lý do gì.

_(Các cơ chế phân bổ cạnh tranh — đăng ký nguyện vọng có thứ tự, đấu giá — là **tính năng riêng**, xem FR_ADM_03.)_

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

#### 1.1.1. Nhóm đăng ký (Group Registration)

Nhóm **luôn gắn với một đề tài kể từ lúc sinh ra** — `registration_groups.topic_id` là NOT NULL, nên không tồn tại trạng thái "nhóm đã lập, đang đi tìm đề tài". Thứ tự luôn là chọn đề tài trước, nhóm hình thành tại đó. Đây cũng là lý do giao diện không được bày ra bước "tạo nhóm" riêng: sinh viên chỉ thấy **Đăng ký đề tài**, còn từ "nhóm" xuất hiện sau đó như một hệ quả.

Nhóm là đơn vị mà toàn bộ phần sau của hệ thống bám vào: bài nộp (`submissions.group_id`), điểm hướng dẫn và nhận xét từng sinh viên (`registration_group_members`), lịch bảo vệ (`council_topics.group_id`), điểm phản biện và hội đồng (`council_topic_grades`).

- **FR_STU_GRP_01:** Đăng ký một đề tài, hệ thống tạo nhóm trên đề tài đó và đặt người đăng ký làm trưởng nhóm.
- **FR_STU_GRP_02:** Mời sinh viên khác vào nhóm theo mã SV hoặc email. Lời mời **chiếm ghế ngay** và hết hạn sau 48 giờ.
- **FR_STU_GRP_03:** Nhận thông báo khi được mời, chấp nhận (`ACCEPTED`) hoặc từ chối (`DECLINED`) lời mời. Tối đa 3 lời mời đang treo cùng lúc.
- **FR_STU_GRP_04:** Trưởng nhóm có thể xóa thành viên đã ACCEPTED trước khi Submit; ghế được nhả ra ngay.
- **FR_STU_GRP_05:** Trưởng nhóm Submit đăng ký khi tất cả thành viên đã accept (không còn ai đang `INVITED`).
- **FR_STU_GRP_06:** Xem trạng thái nhóm của bản thân (FORMING / SUBMITTED / APPROVED / REJECTED) và danh sách thành viên cùng nhóm.
- **FR_STU_GRP_07:** Trưởng nhóm bật/tắt `open_for_join` để tuyên bố nhóm còn nhận thêm người hay đã đủ.
- **FR_STU_GRP_08:** Trưởng nhóm giải tán nhóm khi chưa được duyệt; nhóm chuyển `REJECTED` và đề tài trở lại thị trường.

**Màn hình của sinh viên có ba trạng thái, không phải một.** Một sinh viên trong một học kỳ đi qua đúng ba trạng thái này và dừng lại ở trạng thái cuối:

1. **Chưa đăng ký, cổng đang mở** — danh sách đề tài là nội dung chính.
2. **Đã nộp, chờ giảng viên xác nhận** — đề tài và nhóm của mình lên đầu; danh sách đề tài lùi xuống hoặc ẩn đi.
3. **Đã được duyệt** — không còn danh sách đề tài; chỉ còn đề tài của mình, nhóm, và các deadline sắp tới.

### 1.2. Đối với Giảng viên (Lecturer)

- **FR_LEC_01 - Quản lý tài khoản:**
  - Đăng nhập, đăng xuất hệ thống.
  - Cập nhật hồ sơ cá nhân: Chức danh, Số điện thoại (`phone`), Giới thiệu bản thân (`bio`), Hướng nghiên cứu (`research_interests`).
- **FR_LEC_02 - Quản lý Đề tài do GV ra đề:**
  - Tạo đề tài mới, thiết lập số lượng sinh viên tối đa (`max_students` — sức chứa của nhóm sẽ làm đề tài), yêu cầu đầu ra.
  - Chỉnh sửa hoặc xóa đề tài (chỉ xóa được khi chưa có SV nào đăng ký).
  - Đóng/Mở cổng đăng ký của đề tài. Lưu ý phân biệt hai khái niệm: `TopicStatus.OPEN` nói về **cổng do giảng viên mở**, còn `is_full` nói về **ghế đã đủ người** — đề tài đang OPEN vẫn có thể đã đầy, và ngược lại.
- **FR_LEC_03 - Xác nhận đăng ký & Duyệt đề xuất:**
  - **Xác nhận nhóm đăng ký:** Vì đề tài đã thuộc về nhóm nhận đầu tiên (FR_STU_03a), thao tác của giảng viên là **xác nhận**, không còn là lựa chọn giữa nhiều nhóm. Xem hồ sơ từng thành viên rồi chấp nhận (APPROVE) hoặc từ chối (REJECT) kèm lý do.
  - **Từ chối là hành động nặng:** nó nhả đề tài ra và đẩy nhóm về vạch xuất phát trong khi thời gian đăng ký đang trôi. Vì vậy bắt buộc kèm lý do (`lecturer_feedback`), và **quá hạn xác nhận thì hệ thống tự coi như đồng ý** — không để nhóm bị treo vô thời hạn vì một lỗi không thuộc về họ.
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

- **FR_LEC_GRP_01:** Xem nhóm đã nhận từng đề tài của mình (mỗi đề tài nhiều nhất một nhóm đang sống).
- **FR_LEC_GRP_02:** Xem hồ sơ (tên, mã SV, lớp, chuyên ngành) của từng thành viên trong nhóm trước khi xác nhận.
- **FR_LEC_GRP_03:** Xác nhận (APPROVE) hoặc từ chối (REJECT) cả nhóm với lý do bắt buộc. Từ chối sẽ nhả đề tài cho sinh viên khác đăng ký.
- **FR_LEC_GRP_04:** Chấm điểm hướng dẫn riêng cho từng thành viên trong nhóm (`mentor_grade` trong `registration_group_members`).

### 1.3. Đối với Quản trị viên (Admin / Giáo vụ Khoa)

- **FR_ADM_01 - Quản lý Người dùng:**
  - Thêm, sửa, khóa/mở khóa (deactivate) tài khoản của Giảng viên, Sinh viên. **Không xóa cứng**: `audit_logs` giữ lịch sử thao tác nhạy cảm bằng khóa ngoại RESTRICT, và sinh viên đã vào nhóm cũng bị RESTRICT giữ lại — xóa cứng vừa thất bại về mặt kỹ thuật, vừa xóa mất chính dấu vết cần lưu. `DELETE /users/:id` thực hiện khóa tài khoản và thu hồi toàn bộ refresh token.
  - Import danh sách tài khoản hàng loạt bằng file Excel (.csv, .xlsx).
  - **Reset mật khẩu** cho Giảng viên/Sinh viên: Admin đặt lại về mật khẩu tạm thời, người dùng buộc phải đổi mật khẩu khi đăng nhập lần đầu sau reset.
- **FR_ADM_02 - Quản lý Danh mục (Master Data):**
  - Quản lý Học kỳ (Mở học kỳ mới, thiết lập ngày bắt đầu/kết thúc).
  - Quản lý Loại đồ án (`project_types`).
  - Quản lý Chuyên ngành (`majors`): Thêm, sửa, xóa các chuyên ngành. Danh sách phẳng, **không phân cấp theo bộ môn** — toàn hệ thống phục vụ đúng một khoa (vai trò Admin là Giáo vụ Khoa) và không có quy tắc nghiệp vụ nào phụ thuộc vào bộ môn: sinh viên đăng ký được đề tài của bất kỳ giảng viên nào, giảng viên nào cũng nhận hướng dẫn được.
- **FR_ADM_03 - Quản lý Quy trình & Đợt đăng ký:**
  - Thiết lập cửa sổ thời gian đăng ký đề tài theo học kỳ: `registration_start` và `registration_end` trong bảng `semesters`.
  - Hệ thống tự động khóa/mở chức năng đăng ký dựa trên mốc thời gian trên, không cần Admin can thiệp thủ công.
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

### 1.4. Yêu cầu Hệ thống (System Requirements)

- **FR_SYS_01 - Thông báo (Notifications):**
  - Mỗi thông báo mang một `type` (enum) và `target_id` trỏ tới bản ghi liên quan, để client lọc được theo loại và điều hướng được khi người dùng bấm vào.
  - Hệ thống tự động đẩy thông báo in-app (lưu vào bảng `notifications`) trong các trường hợp:
    - Đề xuất đề tài được duyệt / từ chối.
    - Được mời vào nhóm đăng ký / Nhóm đã được duyệt / Nhóm bị từ chối.
    - Báo cáo nộp có nhận xét mới từ GV.
    - Có điểm mới được nhập.
    - Sắp tới deadline nộp báo cáo hoặc deadline chốt điểm.
- **FR_SYS_02 - Gửi Email** _(v2 / Nice-to-have — ngoài phạm vi v1):_
  - Gửi email nhắc nhở deadline nộp bài, thông báo thay đổi lịch bảo vệ đến SV và GV.
  - Yêu cầu tích hợp dịch vụ SMTP hoặc bên thứ ba (SendGrid, Resend) — **không triển khai trong v1**.
- **FR_SYS_03 - Audit Log (Ghi lịch sử thao tác):**
  - Mọi hành động nhạy cảm (Nhập/Sửa điểm, Xóa đề tài, Khóa tài khoản) của Admin và Giảng viên phải được ghi lại tự động vào bảng `audit_logs`.
  - Mỗi log ghi lại: Người thực hiện, Hành động, Bảng bị tác động, ID bản ghi, Giá trị cũ (JSON), Giá trị mới (JSON), Thời điểm.

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

### 2.5. Tính Khả dụng (Availability)

- **Uptime mục tiêu:** Hệ thống phải đảm bảo hoạt động **≥ 99%** thời gian trong suốt mỗi học kỳ.
- **Không downtime vào thời điểm nhạy cảm:** Không được có sự cố hoặc bảo trì ngoài kế hoạch vào các ngày mở cổng đăng ký đề tài, deadline nộp báo cáo, hoặc ngày công bố điểm.
- **Graceful Degradation:** Nếu dịch vụ Cloud Storage gặp sự cố, hệ thống vẫn phải cho phép SV xem thông tin đề tài và điểm số — chỉ tạm thời vô hiệu hoá tính năng upload file.

### 2.6. Khả năng Bảo trì & Nâng cấp (Maintainability)

- **Kiến trúc mã nguồn:** Codebase phải được phân tách rõ ràng (Layered Architecture, MVC, hoặc Modular). Đảm bảo tuân thủ nguyên tắc SOLID.
- **API Chuẩn hóa:** Hệ thống giao tiếp bằng chuẩn RESTful API, giúp cho việc kết nối thêm Mobile App (nếu có sau này) một cách dễ dàng, không cần sửa đổi backend.
- **Audit Log:** Đã được định nghĩa trong FR_SYS_03 — xem bảng `audit_logs` trong tài liệu thiết kế database.
