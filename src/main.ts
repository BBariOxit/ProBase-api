import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ZodValidationPipe } from './common/zod-validation.pipe';

/**
 * How many reverse proxies sit in front of this process.
 *
 * Everything that counts per caller — the rate limits on the credential
 * endpoints above all — reads `req.ip`, and Express fills that in from the
 * socket unless it is told to trust `X-Forwarded-For`. Behind nginx or a
 * platform router that means every request in the world arrives from the
 * proxy's address and shares one bucket: the API would throttle itself into an
 * outage on the first busy morning.
 *
 * It has to be configuration rather than a constant, because being wrong in the
 * other direction is worse. Trusting a header that no proxy overwrites lets any
 * caller set `X-Forwarded-For` to a fresh value per request and walk past every
 * limit here. So the default is to trust nothing, and a deployment that has a
 * proxy states how many hops to skip.
 */
function trustedProxyHops(): number {
  const configured = process.env.TRUST_PROXY_HOPS;
  if (!configured) return 0;

  const hops = Number(configured);
  if (!Number.isInteger(hops) || hops < 0) {
    // Refusing to start beats starting with rate limiting quietly disabled.
    throw new Error(
      `TRUST_PROXY_HOPS must be a non-negative integer, got "${configured}"`,
    );
  }
  return hops;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const hops = trustedProxyHops();
  if (hops > 0) app.set('trust proxy', hops);

  app.enableCors();
  app.useGlobalPipes(new ZodValidationPipe());
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
