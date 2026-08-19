import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

/** Where avatars land in the account, so nothing else in it is ever touched. */
const AVATAR_FOLDER = 'probase/avatars';

/** And where report files land, kept apart for the same reason. */
const DOCUMENT_FOLDER = 'probase/submissions';

/**
 * A report is at most this big. Generous next to the roster import's 5MB,
 * because a final-year report with figures in it genuinely is twenty megabytes,
 * and refusing one at the deadline is the wrong place to save disk.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * What a submitted document is allowed to be, by its first bytes.
 *
 * The same reasoning as the image signatures below: `file.mimetype` is what the
 * browser chose to write, so it describes an intention rather than a file.
 *
 * DOCX and ZIP share a signature because a DOCX *is* a zip, and nothing here
 * tries to tell them apart — both are accepted, so there is nothing to decide.
 * Everything else is refused, which in particular means no HTML and no SVG:
 * those are served back as themselves from the storage provider's domain, and a
 * file that runs when opened is not a report.
 */
const DOCUMENT_SIGNATURES: {
  name: string;
  matches: (buf: Buffer) => boolean;
}[] = [
  {
    name: 'pdf',
    matches: (buf) => buf.subarray(0, 5).toString('ascii') === '%PDF-',
  },
  {
    name: 'zip or docx',
    matches: (buf) =>
      buf[0] === 0x50 &&
      buf[1] === 0x4b &&
      (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07),
  },
  {
    // The pre-2007 Word format, still what some faculties circulate templates
    // in. Same compound-file header as .xls, which is harmless here.
    name: 'doc',
    matches: (buf) =>
      buf
        .subarray(0, 8)
        .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  },
];

/**
 * The first bytes of the three formats we accept.
 *
 * `file.mimetype` is whatever the browser chose to write in the multipart
 * headers, so it identifies the sender's intention and not the file. Checking
 * the signature costs four bytes of reading and is the difference between
 * "claims to be a PNG" and "is one".
 */
const IMAGE_SIGNATURES: { name: string; matches: (buf: Buffer) => boolean }[] =
  [
    {
      name: 'png',
      matches: (buf) =>
        buf
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          ),
    },
    {
      name: 'jpeg',
      matches: (buf) => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
    },
    {
      name: 'webp',
      matches: (buf) =>
        buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buf.subarray(8, 12).toString('ascii') === 'WEBP',
    },
  ];

export interface StoredImage {
  url: string;
  publicId: string;
}

export interface StoredDocument {
  url: string;
  publicId: string;
  /** The uploader's own filename, for display. Never used to build a path. */
  fileName: string;
  bytes: number;
}

/**
 * Image hosting, kept behind one class so the rest of the API never learns
 * which provider it is.
 *
 * Cloudinary rather than S3 for now, by decision: it does the storing, the
 * resizing and the CDN in one credential, where the S3 equivalent is a bucket,
 * a policy, a signer and something to resize with. The seam is this service —
 * everything else stores a URL and a handle, which any other provider can also
 * produce.
 *
 * Credentials are read once at construction but never required at boot. A
 * missing key must not stop the API from starting: avatars are the least
 * important thing it does, and a developer without a Cloudinary account should
 * still be able to run every other screen. The refusal happens on use instead,
 * where it can say which variables are missing.
 */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    const cloudName = config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = config.get<string>('CLOUDINARY_API_SECRET');

    this.configured = Boolean(cloudName && apiKey && apiSecret);

    if (this.configured) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    } else {
      this.logger.warn(
        'CLOUDINARY_* not set — avatar upload will be refused until it is',
      );
    }
  }

  /**
   * Store one avatar and return what the database keeps about it.
   *
   * The image is re-encoded rather than stored as it arrived: a square 512px
   * WebP, cropped around whatever the detector thinks is the subject. That is
   * partly for the layout — every avatar in the product is a circle of the same
   * size — and partly because re-encoding is what disarms an upload. A file that
   * is both a valid PNG and a valid script does not survive being decoded and
   * written out again.
   */
  async uploadAvatar(file: Express.Multer.File): Promise<StoredImage> {
    // The file is judged before the account is: a request carrying a PDF is
    // malformed whether or not this deployment has credentials, and answering
    // "service unavailable" to it would send someone hunting a configuration
    // problem that is not there.
    assertIsImage(file);
    this.assertConfigured('ảnh');

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: AVATAR_FOLDER,
          // Never let a caller's filename decide the id: it is attacker-chosen
          // text that would end up in a public URL and in a path.
          use_filename: false,
          unique_filename: true,
          overwrite: false,
          resource_type: 'image',
          format: 'webp',
          transformation: [
            { width: 512, height: 512, crop: 'fill', gravity: 'auto' },
          ],
        },
        (error, uploaded) => {
          if (error || !uploaded) {
            return reject(
              error instanceof Error
                ? error
                : new Error('Cloudinary upload failed'),
            );
          }
          resolve(uploaded);
        },
      );

      stream.end(file.buffer);
    });

    return { url: result.secure_url, publicId: result.public_id };
  }

  /**
   * Store one submitted document and return what the database keeps about it.
   *
   * Uploaded as `raw`, which means it is stored and served byte for byte —
   * there is no re-encoding step to disarm it the way an avatar gets one, and
   * that is why the signature check above is narrow rather than generous. A
   * report is a PDF or a Word file or a zip; anything else is refused before it
   * reaches the network.
   *
   * The filename is returned rather than used: `use_filename: false` keeps
   * caller-chosen text out of the public URL, and what the student called their
   * file is display text the database stores separately.
   */
  async uploadDocument(file: Express.Multer.File): Promise<StoredDocument> {
    assertIsDocument(file);
    this.assertConfigured('tệp');

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: DOCUMENT_FOLDER,
          use_filename: false,
          unique_filename: true,
          overwrite: false,
          resource_type: 'raw',
        },
        (error, uploaded) => {
          if (error || !uploaded) {
            return reject(
              error instanceof Error
                ? error
                : new Error('Cloudinary upload failed'),
            );
          }
          resolve(uploaded);
        },
      );

      stream.end(file.buffer);
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      fileName: safeFileName(file.originalname),
      bytes: file.buffer.length,
    };
  }

  /**
   * Best effort, and deliberately so. This runs after the row has already been
   * pointed at the new image, so a failure here costs an orphaned file in the
   * account — while throwing would tell a user their upload failed when it
   * plainly succeeded.
   */
  async destroy(
    publicId: string,
    kind: 'image' | 'raw' = 'image',
  ): Promise<void> {
    if (!this.configured) return;

    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: kind });
    } catch (error) {
      this.logger.warn(
        `Could not delete ${kind} ${publicId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Named for what the caller was trying to store, because the person reading it
   * is a student who uploaded a report and would otherwise be told the system
   * cannot store pictures.
   */
  private assertConfigured(what: 'ảnh' | 'tệp'): void {
    if (this.configured) return;

    throw new ServiceUnavailableException(
      `Chưa cấu hình dịch vụ lưu ${what}. Liên hệ quản trị viên.`,
    );
  }
}

/** Refuses anything whose bytes are not a document format we accept. */
function assertIsDocument(file: Express.Multer.File): void {
  const buffer = file.buffer;

  if (!buffer?.length) {
    throw new BadRequestException('Tệp rỗng, hãy chọn lại file.');
  }

  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new BadRequestException('File vượt quá 25MB.');
  }

  if (!DOCUMENT_SIGNATURES.some((signature) => signature.matches(buffer))) {
    throw new BadRequestException(
      'Chỉ nhận file PDF, Word hoặc ZIP. Nếu là mã nguồn, hãy dán link repository thay vì tải lên.',
    );
  }
}

/**
 * The uploader's filename, reduced to something safe to show.
 *
 * It is never a path here — the storage id is generated — but it is rendered on
 * two screens and stored in the database, so the parts that make a filename
 * dangerous elsewhere are taken off anyway: directory separators, control
 * characters, and any length that would break a table cell.
 */
function safeFileName(original: string): string {
  // Both separators, because the name arrives from whatever machine the student
  // uploaded from and a Windows browser sends backslashes.
  const base = original.split(/[\\/]/).pop() ?? 'bai-nop';

  return (
    base
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f<>:"|?*]/g, '')
      .trim()
      .slice(0, 200) || 'bai-nop'
  );
}

/** Refuses anything whose bytes are not one of the three formats we accept. */
function assertIsImage(file: Express.Multer.File): void {
  const buffer = file.buffer;

  if (!buffer?.length) {
    throw new BadRequestException('Tệp rỗng, hãy chọn lại ảnh.');
  }

  if (!IMAGE_SIGNATURES.some((signature) => signature.matches(buffer))) {
    throw new BadRequestException('Chỉ nhận ảnh PNG, JPEG hoặc WebP.');
  }
}
