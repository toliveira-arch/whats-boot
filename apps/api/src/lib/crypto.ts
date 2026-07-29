import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * Criptografia simétrica (AES-256-GCM) para segredos em repouso — ex.: a apikey
 * de cada instância da Evolution. Formato: iv.tag.ciphertext (base64).
 */
const key = crypto
  .createHash('sha256')
  .update(env.EVOLUTION_ENC_KEY ?? env.JWT_ACCESS_SECRET)
  .digest();

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('segredo criptografado inválido');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
