import { randomUUID, timingSafeEqual } from 'node:crypto';

export const createId = (): string => randomUUID();
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export function clampPositiveInt(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function verifyApiKey(expectedKey: string, providedKey?: string): boolean {
  if (!providedKey || typeof providedKey !== 'string') {
    return false;
  }
  const expectedBuf = Buffer.from(expectedKey);
  const providedBuf = Buffer.from(providedKey);
  if (expectedBuf.length !== providedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

export * from './formatters.js';
