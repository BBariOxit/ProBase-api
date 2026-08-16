# Phân tích Thiết kế Cơ sở dữ liệu: Hệ thống Quản lý Đồ án CNTT

Hệ thống quản lý đồ án cho sinh viên Công nghệ Thông tin (bao gồm Đồ án cơ sở, Đồ án chuyên ngành, Đồ án tốt nghiệp) là một hệ thống mang tính học thuật, yêu cầu quy trình chặt chẽ từ khâu ra đề, đăng ký, thực hiện, báo cáo đến chấm điểm.

---

## 1. Phân tích Các Tính Năng Cốt Lõi (Dựa trên Role)

### 🧑‍🎓 Sinh viên (Student)

- **Quản lý đồ án**: Xem danh sách các đề tài đang mở, xem chi tiết đề tài.
- **Đăng ký**: Đăng ký đề tài cá nhân hoặc lập nhóm, mời thành viên, trưởng nhóm submit đăng ký để GV duyệt.
- **Đề xuất đề tài**: Sinh viên tự đề xuất đề tài dựa trên ý tưởng cá nhân, gửi yêu cầu cho giảng viên mong muốn hướng dẫn.
- **Thực hiện**: Quản lý tiến độ, task list, nộp báo cáo định kỳ/cuối kỳ (hỗ trợ nộp nhiều lần), nộp source code.
- **Kết quả**: Xem nhận xét của giảng viên, xem điểm, lịch bảo vệ hội đồng.

### 👨‍🏫 Giảng viên (Lecturer)

- **Quản lý đề tài**: Đề xuất đề tài mới, duyệt/từ chối sinh viên đăng ký vào đề tài của mình.
- **Duyệt đề xuất của Sinh viên**: Xem xét các đề tài do sinh viên tự đề xuất, chấp nhận làm giảng viên hướng dẫn hoặc từ chối kèm lý do.
- **Hướng dẫn**: Giao task, theo dõi tiến độ của sinh viên, tải và xem báo cáo các phiên bản.
- **Đánh giá**: Chấm điểm quá trình, nhận xét, chấm điểm phản biện/hội đồng.

### 👨‍💻 Quản trị viên (Admin)

- **Quản lý hệ thống**: Quản lý tài khoản, cấp quyền.
- **Quản lý danh mục**: Quản lý đợt/học kỳ, loại đồ án (Cơ sở, Chuyên ngành, Tốt nghiệp), chuyên ngành.
- **Quản lý quy trình**: Mở/đóng đợt đăng ký, duyệt đề tài của giảng viên (nếu cần), phân công hội đồng bảo vệ.
- **Báo cáo & Thống kê**: Thống kê số lượng sinh viên làm đồ án, tỉ lệ qua/trượt, danh sách điểm.

---

## 2. Thiết kế Cấu trúc Database

### Nhóm 1: Quản lý Người dùng & Phân quyền (Authentication & Profiles)

- **`users`**: `id`, `email`, `password_hash`, `role` (ADMIN, LECTURER, STUDENT), `is_active`, `created_at`, `updated_at`.
- **`student_profiles`**: `id`, `user_id` (FK), `student_code`, `full_name`, `class`, `major_id` (FK → `majors`), `cohort`, `phone`, `bio`.
  > _(cập nhật: `student_code` gồm **2 chữ số năm nhập học + 5 chữ số thứ tự** (`2212345`) và trùng đúng phần trước `@` của email trường. `cohort` vì vậy **được suy ra từ mã**, lưu dạng năm nhập học `"2022"`, không lấy từ ô nhập tay trong file import — cột gõ tay sẽ có cả `"2021"`, `"K45"`, `"21"` lẫn ô trống, và mọi quy tắc dựa trên nó sẽ hỏng âm thầm. Import phải từ chối dòng có email và mã lệch nhau. Số khóa chỉ là cách hiển thị: `khóa = năm nhập học − 1976`.)_
  > _(cập nhật: thêm `phone`, `bio`, `major_id` FK thay cho string cứng; hỗ trợ FR_STU_01)_
- **`lecturer_profiles`**: `id`, `user_id` (FK), `lecturer_code`, `full_name`, `academic_title`, `phone`, `bio`, `research_interests`, `max_mentoring_quota` (Int - Số nhóm tối đa được hướng dẫn trong một học kỳ, Nullable — nếu Null thì không giới hạn).
  > _(cập nhật: thêm `phone`, `bio`, `research_interests`, `max_mentoring_quota`; hỗ trợ FR_LEC_01)_
  > _(cập nhật: **bỏ `department_id`** — xem ghi chú ở `majors` bên dưới. Giảng viên tìm theo `research_interests`, không theo đơn vị.)_

### Nhóm 2: Quản lý Danh mục (Master Data)

- **`semesters`**: `id`, `name`, `code`, `start_date`, `end_date`, `registration_start` (Thời điểm mở đăng ký), `registration_end` (Thời điểm đóng đăng ký), `grade_submission_deadline` (Deadline chốt điểm — sau mốc này điểm bị khóa), `is_active`, `mentor_weight`, `reviewer_weight`, `council_weight` (Float — trọng số tính điểm tổng kết, mặc định 0.4/0.3/0.3, tổng bằng 1).
  > _(cập nhật: thêm `registration_start`, `registration_end`; hỗ trợ FR_ADM_03)_
  > _(cập nhật: thêm 3 trọng số điểm — công thức tính điểm tổng kết là **dữ liệu theo học kỳ**, không hardcode trong code, để đổi trọng số kỳ sau không tính lại điểm các kỳ đã đóng)_
- **`project_types`**: `id`, `name`, `code`.
- **`majors`**: `id`, `name`, `code`. Danh sách chuyên ngành **phẳng**, không phân cấp. _(bảng mới: tách riêng Chuyên ngành; hỗ trợ FR_ADM_02)_
  > _(cập nhật: **đã bỏ hẳn bảng `departments`** (bộ môn). Nó từng gom giảng viên và chuyên ngành thành nhóm, nhưng không một quy tắc nghiệp vụ nào đọc tới: đăng ký đề tài, đề xuất và chấm điểm đều mở trong toàn khoa — chính tài liệu này ghi "GV nào trong khoa cũng có thể nhận". Người dùng duy nhất của nó là báo cáo "SV theo bộ môn", đã đưa ra khỏi phạm vi. Giữ lại chỉ tạo thêm một cấp phân cấp phải bảo trì mà không đổi lấy được luật ràng buộc nào.)_

### Nhóm 3: Đề xuất Đề tài (Tính năng Sinh viên tự đề xuất)

Để giữ cho bảng đề tài chính thức được "sạch", chúng ta tách riêng các ý tưởng/đề xuất của sinh viên sang một bảng độc lập. Quá trình này như một bước "thương lượng".

- **`topic_proposals`**: Sinh viên đề xuất đề tài.
  - `id` (PK)
  - `semester_id` (FK) — Đề xuất thuộc học kỳ nào.
  - `student_id` (FK) — Người đề xuất.
  - `title`, `description`, `expected_outcomes`
  - `project_type_id` (FK)
  - `requested_lecturer_id` (FK - Nullable) — GV mà sinh viên mong muốn hướng dẫn (nếu để trống, GV nào trong khoa cũng có thể nhận).
  - `accepted_by_lecturer_id` (FK - Nullable) — GV chính thức duyệt và nhận hướng dẫn.
  - `status` (PENDING, ACCEPTED, REJECTED)
  - `lecturer_feedback` — Nhận xét của GV khi từ chối.
  - _Luồng xử lý_: Khi GV duyệt (`ACCEPTED`), hệ thống sẽ **tự động copy** dữ liệu tạo thành 1 record trong `topics` và tự động tạo một `registration_groups` có trạng thái `APPROVED` với chỉ **một** thành viên là sinh viên đó (trưởng nhóm).

### Nhóm 4: Quản lý Đề tài & Đăng ký (Topics & Registration)

- **`topics`**: Danh sách đề tài chính thức (được GV đề xuất hoặc GV đã duyệt từ đề xuất của SV).
  - `id` (PK), `title`, `description`, `expected_outcomes`, `project_type_id` (FK), `semester_id` (FK), `lecturer_id` (FK - GV Hướng dẫn), `max_students`, `status` (PENDING, APPROVED, OPEN, IN_PROGRESS, COMPLETED), `source_proposal_id` (FK - Nullable, liên kết ngược lại đề xuất gốc nếu có).
- **`registration_groups`**: Nhóm đăng ký đề tài (thay thế hoàn toàn `topic_registrations`).
  - `id` (PK)
  - `topic_id` (FK) — Đề tài muốn đăng ký.
  - `semester_id` (FK) — Học kỳ đăng ký.
  - `leader_id` (FK → `student_profiles`) — Trưởng nhóm (người tạo nhóm).
  - `name` (Nullable) — Tên nhóm tự đặt.
  - `status` (FORMING → SUBMITTED → APPROVED / REJECTED).
  - `lecturer_feedback` (Nullable) — Lý do từ chối của GV.
  - `open_for_join` (Boolean, mặc định `false`) — Nhóm có nhận thêm thành viên lạ hay không. Nhóm chưa đầy nhưng đóng thì hiển thị "Đã có nhóm nhận" thay vì "còn chỗ", để không mời gọi một chỗ đã có chủ.
  - `topic_id` là **NOT NULL**: nhóm luôn sinh ra trên một đề tài, không tồn tại nhóm đi tìm đề tài.
  > _(cập nhật: `(topic_id, semester_id)` là **khóa ngoại tổ hợp** trỏ tới `topics(id, semester_id)`, nên học kỳ của nhóm luôn khớp học kỳ của đề tài.)_
  > _(cập nhật lần 2 — đổi theo cơ chế phân bổ ở FR_STU_03a: partial unique index nới từ `(topic_id) WHERE status = 'APPROVED'` thành **`(topic_id) WHERE status <> 'REJECTED'`**. Bản cũ chỉ chặn ở bước duyệt nên nhiều nhóm vẫn chen vào được trước đó; bản mới cho **nhóm đầu tiên nhận đề tài là chủ**, nhóm thứ hai bị database từ chối ngay — không cần đếm, không cần khoá, đúng kể cả khi hàng nghìn sinh viên bấm cùng lúc lúc mở cổng. `REJECTED` nằm ngoài index nên nhóm huỷ hoặc bị từ chối tự động nhả đề tài lại cho người khác, mà vẫn giữ được dấu vết.)_
- **`registration_group_members`**: Thành viên của nhóm đăng ký.
  - `id` (PK)
  - `group_id` (FK → `registration_groups`)
  - `semester_id` — Lấy xuống từ nhóm, ràng buộc bằng **khóa ngoại tổ hợp** `(group_id, semester_id)` → `registration_groups(id, semester_id)` nên không thể lệch với học kỳ của nhóm. Tồn tại chỉ để dựng được unique index bên dưới, vì unique index không thể trải qua hai bảng.
  - `student_id` (FK → `student_profiles`)
  - `status` (INVITED → ACCEPTED / DECLINED) — Trưởng nhóm tự động `ACCEPTED`.
  - `mentor_grade` (Float, Nullable) — Điểm hướng dẫn (chấm riêng từng người).
  - `mentor_comment` (Text, Nullable) — Nhận xét của GV hướng dẫn.
  - `joined_at` (DateTime, Nullable) — Thời điểm SV accept lời mời.
  > _(cập nhật: **partial unique index** `(student_id, semester_id) WHERE status = 'ACCEPTED'` — một SV được mời vào bao nhiêu nhóm cũng được, nhưng chỉ tham gia được **một** nhóm mỗi học kỳ. Khóa `(group_id, student_id)` cũ chỉ chặn vào trùng **cùng một** nhóm, vẫn cho phép SV được nhận vào 5 đề tài khác nhau cùng lúc.)_

### Nhóm 5: Quản lý Báo cáo (Submissions)

> _(Bảng `tasks` đã bị loại khỏi scope v1 — tính năng giao việc/task không cần thiết, SV/GV tự quản lý bằng công cụ ngoài.)_

- **`submissions`**: Lịch sử nộp file / báo cáo (nộp theo nhóm).
  - `id` (PK), `topic_id` (FK), `group_id` (FK → `registration_groups` - nhóm nộp bài), `submission_type` (MIDTERM, FINAL, SOURCE_CODE), `file_url` (Nullable - đường dẫn file upload), `submission_url` (Nullable - link GitHub/Drive...), `file_name`, `file_size`, `version` (Int - quản lý số lần nộp lại), `submitted_at`, `lecturer_feedback`.
  > _(cập nhật: đổi `student_id` → `group_id` — nộp bài theo nhóm, không phải cá nhân; hỗ trợ FR_STU_06, FR_LEC_04)_
  > _(cập nhật: giữ `topic_id` để truy vấn trực tiếp, nhưng ràng thêm **khóa ngoại tổ hợp** `(group_id, topic_id)` → `registration_groups(id, topic_id)`. Trước đó hai cột này độc lập nhau, ghi sai một lần là bài nộp trỏ vào đề tài khác với đề tài của chính nhóm mình, không gì phát hiện được.)_

### Nhóm 6: Hội đồng bảo vệ (Councils)

- **`councils`**: `id`, `name`, `semester_id` (FK), `location`, `defense_date`.
- **`council_members`**: `id`, `council_id` (FK), `lecturer_id` (FK), `council_role` (PRESIDENT, SECRETARY, MEMBER).
  > _(cập nhật: **bỏ giá trị `REVIEWER`**. Phản biện được phân theo **từng đề tài** qua `council_topics.reviewer_id`, đó là nguồn sự thật duy nhất — để cả hai chỗ cùng biểu diễn "phản biện" thì sẽ có lúc chúng mâu thuẫn nhau.)_
- **`council_topics`**: Phân công nhóm vào hội đồng bảo vệ.
  - `id` (PK), `council_id` (FK), `topic_id` (FK), `group_id` (FK → `registration_groups`), `reviewer_id` (FK → `lecturer_profiles` — GV Phản biện phụ trách đề tài này), `time_slot`.
  > _(cập nhật: thêm `group_id`, `reviewer_id`; tách điểm ra bảng riêng để chấm cá nhân)_
  > _(cập nhật: **khóa ngoại tổ hợp** `(group_id, topic_id)` → `registration_groups(id, topic_id)` — nhóm ra bảo vệ và đề tài được bảo vệ bắt buộc phải khớp nhau.)_
- **`council_topic_grades`**: Điểm bảo vệ riêng cho từng sinh viên trong nhóm. _(bảng mới)_
  - `id` (PK), `council_topic_id` (FK → `council_topics`), `student_id` (FK → `student_profiles`), `council_grade` (Float, Nullable — Điểm Hội đồng), `reviewer_grade` (Float, Nullable — Điểm Phản biện), `final_grade` (Float, Nullable), `finalised_at` (DateTime, Nullable).
  > _(cập nhật: thêm `final_grade` + `finalised_at` — điểm tổng kết được **chốt cứng** tại thời điểm hết hạn chốt điểm, tính theo trọng số của chính học kỳ đó. Lưu lại thay vì tính động, để bảng điểm đã công bố không đổi khi khoa chỉnh trọng số ở kỳ sau.)_

### Nhóm 7: Thông báo hệ thống (Notifications)

- **`notifications`**: Thông báo trạng thái (GV duyệt nhóm, được mời vào nhóm, báo cáo có nhận xét mới, deadline sắp tới...).
  - `id` (PK), `user_id` (FK), `type` (Enum), `title`, `content`, `target_id` (Int, Nullable), `is_read`, `created_at`.
  - `type`: `PROPOSAL_ACCEPTED`, `PROPOSAL_REJECTED`, `GROUP_INVITATION`, `GROUP_APPROVED`, `GROUP_REJECTED`, `SUBMISSION_FEEDBACK`, `GRADE_PUBLISHED`, `DEADLINE_REMINDER` — đúng các trường hợp FR_SYS_01 liệt kê.
  > _(cập nhật: thêm `type` + `target_id`. Chỉ có `title`/`content` dạng chuỗi thì client không lọc được theo loại, và bấm vào thông báo cũng không biết điều hướng đi đâu — `type` cho biết thuộc bảng nào, `target_id` cho biết bản ghi nào.)_

### Nhóm 8: Audit Log (Lịch sử thao tác nhạy cảm)

_(bảng mới: hỗ trợ NFR - Maintainability, yêu cầu ghi log các hành động nhạy cảm)_

- **`audit_logs`**: Ghi lại mọi hành động quan trọng của Admin và GV.
  - `id` (PK), `user_id` (FK - Ai thực hiện), `action` (Tên hành động: UPDATE_GRADE, DELETE_TOPIC...), `target_table` (Bảng bị tác động), `target_id` (ID của bản ghi bị tác động), `old_value` (JSON - Giá trị cũ), `new_value` (JSON - Giá trị mới), `created_at`.

---

## 3. Sơ đồ Thực thể Liên kết (ER Diagram)

```mermaid
erDiagram
    %% Auth & Profiles
    USER ||--o| STUDENT_PROFILE : "has"
    USER ||--o| LECTURER_PROFILE : "has"
    USER ||--o{ NOTIFICATION : "receives"
    USER ||--o{ AUDIT_LOG : "performs"

    %% Master Data (Majors)
    MAJOR ||--o{ STUDENT_PROFILE : "belongs to"

    %% Categories
    SEMESTER ||--o{ TOPIC : "contains"
    SEMESTER ||--o{ TOPIC_PROPOSAL : "contains"
    SEMESTER ||--o{ COUNCIL : "has"
    PROJECT_TYPE ||--o{ TOPIC : "categorizes"
    PROJECT_TYPE ||--o{ TOPIC_PROPOSAL : "categorizes"

    %% Proposals (Student proposes topic)
    STUDENT_PROFILE ||--o{ TOPIC_PROPOSAL : "proposes"
    LECTURER_PROFILE ||--o{ TOPIC_PROPOSAL : "requests/accepts"
    TOPIC_PROPOSAL ||--o| TOPIC : "converted to (when accepted)"

    %% Core Project Flow (Group Registration)
    LECTURER_PROFILE ||--o{ TOPIC : "proposes/mentors"
    TOPIC ||--o{ REGISTRATION_GROUP : "receives registration"
    SEMESTER ||--o{ REGISTRATION_GROUP : "contains"
    STUDENT_PROFILE ||--o{ REGISTRATION_GROUP : "leads"
    REGISTRATION_GROUP ||--o{ REGISTRATION_GROUP_MEMBER : "has members"
    STUDENT_PROFILE ||--o{ REGISTRATION_GROUP_MEMBER : "joins as"

    %% Submissions
    TOPIC ||--o{ SUBMISSION : "receives"
    REGISTRATION_GROUP ||--o{ SUBMISSION : "submits"

    %% Council Defense
    COUNCIL ||--o{ COUNCIL_MEMBER : "consists of"
    LECTURER_PROFILE ||--o{ COUNCIL_MEMBER : "acts as"
    COUNCIL ||--o{ COUNCIL_TOPIC : "evaluates"
    TOPIC ||--o| COUNCIL_TOPIC : "is evaluated by"
    REGISTRATION_GROUP ||--o| COUNCIL_TOPIC : "presents at"
    LECTURER_PROFILE ||--o{ COUNCIL_TOPIC : "reviews"
    COUNCIL_TOPIC ||--o{ COUNCIL_TOPIC_GRADE : "grades per student"
    STUDENT_PROFILE ||--o{ COUNCIL_TOPIC_GRADE : "receives grade"

    %% Snapshot of Entity Attributes
    MAJOR {
        int id PK
        string name
        string code
    }
    STUDENT_PROFILE {
        int id PK
        int user_id FK
        int major_id FK
        string student_code
        string phone
        string bio
    }
    LECTURER_PROFILE {
        int id PK
        int user_id FK
        string phone
        string bio
        string research_interests
        int max_mentoring_quota
    }
    SEMESTER {
        int id PK
        string name
        date registration_start
        date registration_end
        date grade_submission_deadline
        date start_date
        date end_date
        float mentor_weight
        float reviewer_weight
        float council_weight
    }
    TOPIC_PROPOSAL {
        int id PK
        int semester_id FK
        int student_id FK
        int requested_lecturer_id FK
        int accepted_by_lecturer_id FK
        string status "PENDING, ACCEPTED, REJECTED"
    }
    TOPIC {
        int id PK
        int source_proposal_id FK
        int lecturer_id FK
        string status
    }
    REGISTRATION_GROUP {
        int id PK
        int topic_id FK
        int semester_id FK
        int leader_id FK
        string status "FORMING, SUBMITTED, APPROVED, REJECTED"
        string lecturer_feedback
    }
    REGISTRATION_GROUP_MEMBER {
        int id PK
        int group_id FK
        int semester_id FK "unique with student_id where ACCEPTED"
        int student_id FK
        string status "INVITED, ACCEPTED, DECLINED"
        float mentor_grade
        string mentor_comment
    }
    SUBMISSION {
        int id PK
        int group_id FK
        string file_url
        string submission_url
        string file_name
        int file_size
        int version
        string submission_type
    }
    COUNCIL_TOPIC {
        int id PK
        int council_id FK
        int topic_id FK
        int group_id FK
        int reviewer_id FK
        string time_slot
    }
    COUNCIL_TOPIC_GRADE {
        int id PK
        int council_topic_id FK
        int student_id FK
        float council_grade
        float reviewer_grade
        float final_grade
        date finalised_at
    }
    NOTIFICATION {
        int id PK
        int user_id FK
        string type
        string title
        string content
        int target_id
        boolean is_read
    }
    AUDIT_LOG {
        int id PK
        int user_id FK
        string action
        string target_table
        int target_id
        json old_value
        json new_value
    }
```
