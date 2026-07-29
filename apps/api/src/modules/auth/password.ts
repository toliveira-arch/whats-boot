import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

/** Hash de senha com bcrypt. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Verifica a senha contra o hash armazenado. */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
