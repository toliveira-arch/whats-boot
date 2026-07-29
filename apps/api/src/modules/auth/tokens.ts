import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';

export interface AccessTokenPayload {
  sub: string; // userId
  tid: string; // tenantId
  mid: string; // membershipId
  role: string; // roleKey
  perms: string[]; // permission keys
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: string;
  permissions: string[];
}

/** Converte "15m", "7d", "3600s", "12h" em segundos. */
export function parseDurationToSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return Number(value) || 0;
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return amount * (multipliers[unit] ?? 1);
}

// ---------------------------------------------------------------------------
// Access token (JWT stateless)
// ---------------------------------------------------------------------------

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: parseDurationToSeconds(env.JWT_ACCESS_TTL),
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof decoded === 'string') {
    throw new Error('token inválido');
  }
  return decoded as AccessTokenPayload;
}

// ---------------------------------------------------------------------------
// Refresh token (opaco, persistido e rotacionado)
// ---------------------------------------------------------------------------

const REFRESH_BYTES = 48;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export interface RefreshMeta {
  userAgent?: string;
  ip?: string;
}

/** Cria um novo refresh token (inicia uma nova "família"). */
export async function issueRefreshToken(userId: string, meta: RefreshMeta): Promise<string> {
  const raw = crypto.randomBytes(REFRESH_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + parseDurationToSeconds(env.JWT_REFRESH_TTL) * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      jti: crypto.randomUUID(),
      tokenHash: sha256(raw),
      familyId: crypto.randomUUID(),
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt,
    },
  });

  return raw;
}

export interface RotationResult {
  raw: string;
  userId: string;
}

/**
 * Rotaciona um refresh token: revoga o atual e emite um novo na mesma família.
 * Detecta reuso de token já revogado → revoga a família inteira (defesa contra roubo).
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: RefreshMeta,
): Promise<RotationResult> {
  const tokenHash = sha256(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!existing) {
    throw new Error('refresh token inválido');
  }

  // Reuso de um token já revogado → compromisso; invalida toda a família.
  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new Error('refresh token reutilizado');
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw new Error('refresh token expirado');
  }

  const raw = crypto.randomBytes(REFRESH_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + parseDurationToSeconds(env.JWT_REFRESH_TTL) * 1000);

  const created = await prisma.refreshToken.create({
    data: {
      userId: existing.userId,
      jti: crypto.randomUUID(),
      tokenHash: sha256(raw),
      familyId: existing.familyId,
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt,
    },
  });

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedById: created.id },
  });

  return { raw, userId: existing.userId };
}

/** Revoga um refresh token específico (logout). */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoga todos os refresh tokens de um usuário (ex.: após reset de senha). */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
