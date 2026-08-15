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

  /**
   * The self-service reset link. Carries no password — only a one-time URL, so
   * an intercepted message is useless once the link is spent or expires.
   */
  async sendPasswordResetLink(payload: {
    to: string;
    fullName?: string;
    resetUrl: string;
    expiresInMinutes: number;
  }): Promise<boolean> {
    return this.send({
      to: payload.to,
      fullName: payload.fullName,
      subject: '[ProBase] Đặt lại mật khẩu',
      logLabel: 'Password-reset-link',
      html: this.renderShell({
        fullName: payload.fullName,
        introText:
          'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.',
        bodyHtml: `
            <table width="100%" style="background:#fff8e1;border-left:4px solid #f59e0b;border-radius:4px;margin:20px 0 28px;">
              <tr><td style="padding:14px 18px;font-size:13px;color:#78610a;">
                Liên kết chỉ dùng được <strong>một lần</strong> và hết hạn sau <strong>${payload.expiresInMinutes} phút</strong>.
                Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên.
              </td></tr>
            </table>
            ${this.renderButton(payload.resetUrl, 'Đặt lại mật khẩu')}`,
      }),
    });
  }

  /**
   * Sent after a password actually changes.
   *
   * Every other control tries to prevent an account takeover; this one makes
   * sure the owner finds out about one. It is the only signal reaching someone
   * whose account was reset by another person.
   */
  async sendPasswordChangedNotice(payload: {
    to: string;
    fullName?: string;
    changedAt: Date;
  }): Promise<boolean> {
    const when = payload.changedAt.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    return this.send({
      to: payload.to,
      fullName: payload.fullName,
      subject: '[ProBase] Mật khẩu của bạn vừa được thay đổi',
      logLabel: 'Password-changed-notice',
      html: this.renderShell({
        fullName: payload.fullName,
        introText: `Mật khẩu tài khoản ProBase của bạn vừa được thay đổi lúc <strong>${escapeHtml(when)}</strong>.`,
        bodyHtml: `
            <table width="100%" style="background:#fdecea;border-left:4px solid #c0392b;border-radius:4px;margin:20px 0 28px;">
              <tr><td style="padding:14px 18px;font-size:13px;color:#7b241c;">
                Nếu <strong>không phải bạn</strong> thực hiện, hãy liên hệ giáo vụ khoa ngay để được khoá tài khoản.
              </td></tr>
            </table>
            ${this.renderButton(`${this.frontendUrl}/login`, 'Đăng nhập')}`,
      }),
    });
  }

  /** Single delivery path: log the outcome, never throw. */
  private async send(args: {
    to: string;
    fullName?: string;
    subject: string;
    logLabel: string;
    html: string;
  }): Promise<boolean> {
    try {
      await this.client.transactionalEmails.sendTransacEmail({
        sender: { email: this.senderEmail, name: this.senderName },
        to: [{ email: args.to, name: args.fullName ?? args.to }],
        subject: args.subject,
        htmlContent: args.html,
      });
      this.logger.log(`${args.logLabel} email sent to ${args.to}`);
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to send ${args.logLabel.toLowerCase()} email to ${args.to}`,
        err,
      );
      return false;
    }
  }

  private async sendCredentialsEmail(args: {
    payload: CredentialsEmailPayload;
    subject: string;
    introText: string;
    logLabel: string;
  }): Promise<boolean> {
    const { payload, subject, introText, logLabel } = args;
    const { to, fullName, tempPassword } = payload;

    // Delivery never throws; the boolean is what lets a caller report a failure
    // instead of assuming the credentials arrived.
    return this.send({
      to,
      fullName,
      subject,
      logLabel,
      html: this.buildTemplate({
        fullName,
        email: to,
        tempPassword,
        introText,
      }),
    });
  }

  private buildTemplate(data: {
    fullName?: string;
    email: string;
    tempPassword: string;
    /** Built in this service from fixed copy — intentionally carries markup. */
    introText: string;
  }): string {
    return this.renderShell({
      fullName: data.fullName,
      introText: data.introText,
      bodyHtml: `
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
            ${this.renderButton(`${this.frontendUrl}/login`, 'Đăng nhập ngay')}`,
    });
  }

  private renderButton(href: string, label: string): string {
    return `<table width="100%"><tr><td align="center">
              <a href="${href}" style="display:inline-block;background:linear-gradient(135deg,#1e3a5f,#2e6da4);color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;">
                ${label}
              </a>
            </td></tr></table>`;
  }

  /**
   * The chrome every message shares. `bodyHtml` is markup this service builds
   * itself; anything originating from a user must already have been escaped by
   * the caller before it gets here.
   */
  private renderShell(data: {
    fullName?: string;
    introText: string;
    bodyHtml: string;
  }): string {
    // Only ADMIN accounts have no profile name — greet them without one
    // rather than echoing their raw email address back at them.
    const greeting = data.fullName
      ? `Xin chào <strong>${escapeHtml(data.fullName)}</strong>,`
      : 'Xin chào,';

    return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"/><title>ProBase</title></head>
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
            ${data.bodyHtml}
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
