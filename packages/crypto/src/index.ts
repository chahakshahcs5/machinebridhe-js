import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto';

export interface Identity {
  machineId: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function generateIdentity(machineId: string): Identity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { machineId, privateKey, publicKey };
}

export function publicKeyPem(key: KeyObject): string {
  return key.export({ type: 'spki', format: 'pem' }).toString();
}

export function privateKeyPem(key: KeyObject): string {
  return key.export({ type: 'pkcs8', format: 'pem' }).toString();
}

export function importPrivateKey(pem: string): KeyObject {
  return createPrivateKey(pem);
}

export function importPublicKey(pem: string): KeyObject {
  return createPublicKey(pem);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

export function makeSigningString(
  machineId: string,
  timestamp: number,
  nonce: string,
  requestId: string,
  hash: string,
): string {
  return [machineId, timestamp, nonce, requestId, hash].join('.');
}

export function signRequest(privateKey: KeyObject, value: string): string {
  return sign(null, Buffer.from(value, 'utf8'), privateKey).toString('base64url');
}

export function verifyRequest(publicKey: KeyObject, value: string, signature: string): boolean {
  try {
    const expected = verify(
      null,
      Buffer.from(value, 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64url'),
    );
    return expected;
  } catch {
    return false;
  }
}

export function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createNonce(): string {
  return randomBytes(24).toString('base64url');
}
