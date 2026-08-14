import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoClient } from '@getbrevo/brevo';

export type MailableRole = 'ADMIN' | 'LECTURER' | 'STUDENT';

export interface CredentialsEmailPayload {
  to: string;
  fullName?: string; // Absent only for ADMIN accounts, which have no profile
  tempPassword: string;
  role: MailableRole;
}

const ROLE_LABELS: Record<MailableRole, string> = {
  ADMIN: 'Quản trị viên',
  LECTURER: 'Giảng viên',
  STUDENT: 'Sinh viên',
};

/**
 * Names and addresses reach us from admin-uploaded spreadsheets, so they are
 * untrusted text landing in an HTML document. Escaping keeps a name like
 * `Trần <Anh> & Co` rendering as written rather than collapsing the layout —
 * or injecting markup into mail we send out under the system's name.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client: BrevoClient;
  private readonly senderEmail: string;
  private readonly senderName: string;
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    this.client = new BrevoClient({
      apiKey: this.config.getOrThrow<string>('BREVO_API_KEY'),
    });
    this.senderEmail = this.config.getOrThrow<string>('BREVO_SENDER_EMAIL');
    this.senderName = this.config.get<string>('BREVO_SENDER_NAME', 'ProBase');
    this.frontendUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
  }

  /** Resolves false when delivery failed; never throws. */
  async sendAccountCreated(payload: CredentialsEmailPayload): Promise<boolean> {
    return this.sendCredentialsEmail({
      payload,
      subject: '[ProBase] Tài khoản của bạn đã được tạo',
      introText: `Tài khoản <strong>${ROLE_LABELS[payload.role]}</strong> của bạn trên hệ thống ProBase đã được tạo.`,
      logLabel: 'Account-created',
    });
  }

  /** Resolves false when delivery failed; never throws. */
  async sendPasswordReset(payload: CredentialsEmailPayload): Promise<boolean> {
    return this.sendCredentialsEmail({
      payload,
      subject: '[ProBase] Mật khẩu của bạn đã được đặt lại',
      introText:
        'Mật khẩu tài khoản của bạn trên hệ thống ProBase vừa được quản trị viên đặt lại.',
      logLabel: 'Password-reset',
    });
  }

  private async sendCredentialsEmail(args: {
    payload: CredentialsEmailPayload;
    subject: string;
    introText: string;
    logLabel: string;
  }): Promise<boolean> {
    const { payload, subject, introText, logLabel } = args;
    const { to, fullName, tempPassword } = payload;

    try {
      await this.client.transactionalEmails.sendTransacEmail({
        sender: { email: this.senderEmail, name: this.senderName },
        to: [{ email: to, name: fullName ?? to }],
        subject,
        htmlContent: this.buildTemplate({
          fullName,
          email: to,
          tempPassword,
          introText,
        }),
      });
      this.logger.log(`${logLabel} email sent to ${to}`);
      return true;
    } catch (err) {
      // Do NOT throw — email failure must not break the calling flow. The
      // boolean is what lets a caller report the failure instead of assuming
      // the credentials arrived.
      this.logger.error(
        `Failed to send ${logLabel.toLowerCase()} email to ${to}`,
        err,
      );
      return false;
    }
  }

  private buildTemplate(data: {
    fullName?: string;
    email: string;
    tempPassword: string;
    /** Built in this service from fixed copy — intentionally carries markup. */
    introText: string;
  }): string {
    // Only ADMIN accounts have no profile name — greet them without one
    // rather than echoing their raw email address back at them.
    const greeting = data.fullName
      ? `Xin chào <strong>${escapeHtml(data.fullName)}</strong>,`
      : 'Xin chào,';

    return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"/><title>Tài khoản ProBase</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f,#2e6da4);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:26px;">ProBase</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="font-size:16px;color:#1a2b3c;">${greeting}</p>
            <p style="font-size:14px;color:#4a5568;line-height:1.7;">${data.introText}</p>
            <table width="100%" style="background:#f0f7ff;border:1px solid #c2dcf5;border-radius:8px;margin:20px 0;">
              <tr><td style="padding:24px;">
                <p style="margin:0 0 8px;font-size:13px;"><strong>Email:</strong> ${escapeHtml(data.email)}</p>
                <p style="margin:0;font-size:13px;"><strong>Mật khẩu tạm:</strong> <span style="font-family:monospace;color:#c0392b;font-size:15px;font-weight:700;">${escapeHtml(data.tempPassword)}</span></p>
              </td></tr>
            </table>
            <table width="100%" style="background:#fff8e1;border-left:4px solid #f59e0b;border-radius:4px;margin-bottom:28px;">
              <tr><td style="padding:14px 18px;font-size:13px;color:#78610a;">
                ⚠️ Bạn sẽ được yêu cầu <strong>đổi mật khẩu ngay</strong> sau khi đăng nhập lần đầu.
              </td></tr>
            </table>
            <table width="100%"><tr><td align="center">
              <a href="${this.frontendUrl}/login" style="display:inline-block;background:linear-gradient(135deg,#1e3a5f,#2e6da4);color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;">
                Đăng nhập ngay
              </a>
            </td></tr></table>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;font-size:12px;color:#a0aec0;">Email tự động từ ProBase. Vui lòng không trả lời.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }
}
