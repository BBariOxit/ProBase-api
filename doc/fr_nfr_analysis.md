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
- **FR_STU_02 - Xem danh sách đề tài:**
  - Tra cứu, lọc, tìm kiếm các đề tài đang được mở theo học kỳ và loại đồ án (Cơ sở, Chuyên ngành, Tốt nghiệp).
  - Xem chi tiết đề tài (Mô tả, yêu cầu, GV hướng dẫn, số lượng slot).
- **FR_STU_03 - Đăng ký đề tài:**
  - Chọn đề tài và đăng ký tham gia cá nhân (tự động tạo nhóm 1 người).
  - Tạo nhóm, mời thêm thành viên, đợi đồng ý rồi trưởng nhóm nộp đăng ký để GV duyệt.
  - Hủy đăng ký (chỉ được phép khi nhóm chưa ở trạng thái APPROVED và còn trong thời hạn đăng ký).
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
  - Xem nhận xét, đánh giá từ giảng viên.
  - Xem lịch trình, địa điểm và thời gian bảo vệ đồ án.

#### 1.1.1. Nhóm đăng ký (Group Registration)

- **FR_STU_GRP_01:** Tạo nhóm đăng ký cho một đề tài (tự động trở thành trưởng nhóm).
- **FR_STU_GRP_02:** Mời sinh viên khác vào nhóm theo mã SV hoặc email.
- **FR_STU_GRP_03:** Nhận thông báo khi được mời, chấp nhận (`ACCEPTED`) hoặc từ chối (`DECLINED`) lời mời.
- **FR_STU_GRP_04:** Trưởng nhóm có thể xóa thành viên đã ACCEPTED trước khi Submit.
- **FR_STU_GRP_05:** Trưởng nhóm Submit đăng ký khi tất cả thành viên đã accept (không còn ai đang `INVITED`).
- **FR_STU_GRP_06:** Xem trạng thái nhóm của bản thân (FORMING / SUBMITTED / APPROVED / REJECTED) và danh sách thành viên cùng nhóm.

### 1.2. Đối với Giảng viên (Lecturer)

- **FR_LEC_01 - Quản lý tài khoản:**
  - Đăng nhập, đăng xuất hệ thống.
  - Cập nhật hồ sơ cá nhân: Chức danh, Số điện thoại (`phone`), Giới thiệu bản thân (`bio`), Hướng nghiên cứu (`research_interests`).
- **FR_LEC_02 - Quản lý Đề tài do GV ra đề:**
  - Tạo đề tài mới, thiết lập số lượng sinh viên tối đa, yêu cầu đầu ra.
  - Chỉnh sửa hoặc xóa đề tài (chỉ xóa được khi chưa có SV nào đăng ký).
  - Đóng/Mở trạng thái nhận thêm sinh viên của đề tài.
- **FR_LEC_03 - Duyệt đăng ký & Đề xuất:**
  - **Duyệt nhóm đăng ký:** Xem danh sách các nhóm đã Submit vào đề tài của mình, xem hồ sơ từng thành viên, chấp nhận (APPROVE) hoặc từ chối (REJECT) cả nhóm kèm lý do.
  - **Duyệt SV đề xuất:** Xem danh sách ý tưởng SV gửi lên, Chấp nhận hướng dẫn (tự động tạo thành đề tài chính thức) hoặc Từ chối kèm lý do phản hồi.
- **FR_LEC_04 - Theo dõi tiến độ & Báo cáo:**
  - Xem danh sách **tất cả các phiên bản nộp** (theo trường `version`) của từng nhóm, tải về hoặc xem từng phiên bản riêng lẻ.
  - Viết phản hồi/nhận xét trực tiếp trên từng lần nộp (`lecturer_feedback` trong bảng `submissions`).
- **FR_LEC_05 - Đánh giá (Chấm điểm hướng dẫn):**
  - Viết nhận xét tổng kết quá trình làm việc của từng SV (`mentor_comment` trong bảng `registration_group_members`).
  - Nhập "Điểm hướng dẫn" riêng cho từng thành viên nhóm (`mentor_grade` trong bảng `registration_group_members`).
  - Điểm chỉ có thể nhập/sửa **trước deadline chốt điểm** (`grade_submission_deadline`) do Admin thiết lập cho từng học kỳ. Sau thời hạn này, điểm bị **khóa** và không thể chỉnh sửa.
- **FR_LEC_06 - Đánh giá Phản biện / Hội đồng:**
  - Nếu được phân công làm **GV phản biện** (`reviewer_id` trong `council_topics`): Xem báo cáo của nhóm được phân công, nhập **"Điểm phản biện" riêng cho từng thành viên** (`reviewer_grade` trong bảng `council_topic_grades`).
  - Nếu nằm trong **hội đồng**: Xem danh sách nhóm bảo vệ trong phiên của mình, nhập **"Điểm hội đồng" riêng cho từng thành viên** (`council_grade` trong bảng `council_topic_grades`).

#### 1.2.1. Nhóm đăng ký (Group Registration)

- **FR_LEC_GRP_01:** Xem danh sách các nhóm đã Submit đăng ký vào đề tài của mình.
- **FR_LEC_GRP_02:** Xem hồ sơ (tên, mã SV, lớp, chuyên ngành) của từng thành viên trong nhóm trước khi duyệt.
- **FR_LEC_GRP_03:** Duyệt (APPROVE) hoặc từ chối (REJECT) cả nhóm với lý do.
- **FR_LEC_GRP_04:** Chấm điểm hướng dẫn riêng cho từng thành viên trong nhóm (`mentor_grade` trong `registration_group_members`).

### 1.3. Đối với Quản trị viên (Admin / Giáo vụ Khoa)

- **FR_ADM_01 - Quản lý Người dùng:**
  - Thêm, sửa, xóa, khóa (deactivate) tài khoản của Giảng viên, Sinh viên.
  - Import danh sách tài khoản hàng loạt bằng file Excel (.csv, .xlsx).
  - **Reset mật khẩu** cho Giảng viên/Sinh viên: Admin đặt lại về mật khẩu tạm thời, người dùng buộc phải đổi mật khẩu khi đăng nhập lần đầu sau reset.
- **FR_ADM_02 - Quản lý Danh mục (Master Data):**
  - Quản lý Học kỳ (Mở học kỳ mới, thiết lập ngày bắt đầu/kết thúc).
  - Quản lý Loại đồ án (`project_types`).
  - Quản lý Khoa/Bộ môn (`departments`): Thêm, sửa, xóa các khoa trong trường.
  - Quản lý Chuyên ngành (`majors`): Thêm, sửa, xóa các chuyên ngành, mỗi chuyên ngành thuộc một Khoa/Bộ môn.
- **FR_ADM_03 - Quản lý Quy trình & Đợt đăng ký:**
  - Thiết lập cửa sổ thời gian đăng ký đề tài theo học kỳ: `registration_start` và `registration_end` trong bảng `semesters`.
  - Hệ thống tự động khóa/mở chức năng đăng ký dựa trên mốc thời gian trên, không cần Admin can thiệp thủ công.
  - (Tùy chọn) Xét duyệt lần cuối các đề tài của giảng viên trước khi public cho SV.
- **FR_ADM_04 - Quản lý Hội đồng bảo vệ (Councils):**
  - Tạo Hội đồng bảo vệ (Tên, ngày giờ, địa điểm).
  - Phân công Giảng viên vào hội đồng (Chủ tịch, Thư ký, Ủy viên...).
  - Phân bổ danh sách các nhóm đề tài vào Hội đồng tương ứng.
  - Chỉ định **GV Phản biện** (`reviewer_id`) cho từng đề tài trong hội đồng.
- **FR_ADM_05 - Báo cáo & Thống kê:**
  - Xuất bảng điểm tổng kết (Excel/PDF).
  - Xem biểu đồ thống kê: Tỷ lệ hoàn thành đồ án, Phân bổ số lượng SV theo từng bộ môn/giảng viên.

### 1.4. Yêu cầu Hệ thống (System Requirements)

- **FR_SYS_01 - Thông báo (Notifications):**
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
