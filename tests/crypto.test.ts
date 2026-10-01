import {
  generateIdentity,
  importPublicKey,
  makeSigningString,
  payloadHash,
  privateKeyPem,
  publicKeyPem,
  signRequest,
  verifyRequest,
} from '@machinebridge/crypto';

describe('crypto', () => {
  it('signs and verifies a canonical request', () => {
    const identity = generateIdentity('machine-1');
    const timestamp = 100;
    const nonce = 'nonce';
    const requestId = 'request';
    const hash = payloadHash({ b: 2, a: 1 });
    const signingString = makeSigningString('machine-1', timestamp, nonce, requestId, hash);
    const signature = signRequest(identity.privateKey, signingString);

    expect(
      verifyRequest(importPublicKey(publicKeyPem(identity.publicKey)), signingString, signature),
    ).toBe(true);
    expect(
      verifyRequest(
        importPublicKey(publicKeyPem(identity.publicKey)),
        makeSigningString('machine-1', timestamp, 'different', requestId, hash),
        signature,
      ),
    ).toBe(false);
    expect(privateKeyPem(identity.privateKey)).toContain('PRIVATE KEY');
  });

  it('canonicalizes object key order', () => {
    expect(payloadHash({ b: 2, a: 1 })).toBe(payloadHash({ a: 1, b: 2 }));
  });
});
