import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyIapIdentity } from './identity.js';

test('IAP identity requires signed, audience-bound, current email evidence', async () => {
  const now = Math.floor(Date.now() / 1000);
  const verifier = {
    getIapPublicKeys: async () => ({ pubkeys: { key: 'pem' } }),
    verifySignedJwtWithCertsAsync: async (_jwt: string, _certs: Record<string, string>, audience: string) => {
      assert.equal(audience, '/projects/123/global/backendServices/service');
      return { getPayload: () => ({ sub: 'subject', email: 'USER@example.com', email_verified: true, iat: now, exp: now + 60 }) };
    },
  };
  assert.deepEqual(await verifyIapIdentity('signed', '/projects/123/global/backendServices/service', verifier), { subject: 'subject', email: 'user@example.com' });
});

test('unsigned identity headers cannot substitute for an IAP assertion', async () => {
  await assert.rejects(() => verifyIapIdentity('', 'audience'), /IAP_ASSERTION_REQUIRED/);
});
