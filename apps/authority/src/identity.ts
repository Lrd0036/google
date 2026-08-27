import { OAuth2Client } from 'google-auth-library';

export interface HumanIdentity { subject: string; email: string; }
interface IapVerifier {
  getIapPublicKeys(): Promise<{ pubkeys: Record<string, string> }>;
  verifySignedJwtWithCertsAsync(jwt: string, certs: Record<string, string>, audience: string, issuers: string[]): Promise<{ getPayload(): unknown }>;
}

export async function verifyIapIdentity(jwt: string, audience: string, verifier: IapVerifier = new OAuth2Client()): Promise<HumanIdentity> {
  if (!jwt || !audience) throw new Error('IAP_ASSERTION_REQUIRED');
  const { pubkeys } = await verifier.getIapPublicKeys();
  const ticket = await verifier.verifySignedJwtWithCertsAsync(jwt, pubkeys, audience, ['https://cloud.google.com/iap']);
  const payload = ticket.getPayload() as Record<string, unknown> | undefined;
  if (!payload || typeof payload.sub !== 'string' || typeof payload.email !== 'string' || payload.email_verified !== true) throw new Error('INVALID_IAP_IDENTITY');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number' || payload.iat > now + 30 || payload.exp <= now) throw new Error('STALE_IAP_IDENTITY');
  return { subject: payload.sub, email: payload.email.toLowerCase() };
}

export async function verifyConsoleWorkload(authorization: string, audience: string, expectedEmail: string, client = new OAuth2Client()): Promise<void> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  if (!token) throw new Error('WORKLOAD_ID_TOKEN_REQUIRED');
  const ticket = await client.verifyIdToken({ idToken: token, audience });
  const payload = ticket.getPayload();
  if (!payload || payload.email !== expectedEmail || payload.email_verified !== true) throw new Error('CONSOLE_WORKLOAD_MISMATCH');
}
