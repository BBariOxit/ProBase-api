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
    this.assertConfigured();

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
   * Best effort, and deliberately so. This runs after the row has already been
   * pointed at the new image, so a failure here costs an orphaned file in the
   * account — while throwing would tell a user their upload failed when it
   * plainly succeeded.
   */
  async destroy(publicId: string): Promise<void> {
    if (!this.configured) return;

    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    } catch (error) {
      this.logger.warn(
        `Could not delete image ${publicId}: ${(error as Error).message}`,
      );
    }
  }

  private assertConfigured(): void {
    if (this.configured) return;

    throw new ServiceUnavailableException(
      'Chưa cấu hình dịch vụ lưu ảnh. Liên hệ quản trị viên.',
    );
  }
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
