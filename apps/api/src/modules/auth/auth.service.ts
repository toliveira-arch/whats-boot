import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../middlewares/error';
import { logger } from '../../lib/logger';
import { isProduction } from '../../config/env';
import { hashPassword, verifyPassword } from './password';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  signAccessToken,
  type RefreshMeta,
} from './tokens';
import { seedTenantRoles, ROLE_KEYS } from './rbac';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.validation';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Permissões (keys) de um papel. */
async function permissionsForRole(roleId: string): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { key: true } } },
  });
  return rows.map((r) => r.permission.key);
}

/** Resolve a membership ativa do usuário (contexto de tenant/papel). */
async function resolveMembership(userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId, status: 'ACTIVE', deletedAt: null },
    include: { role: true, tenant: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!membership) {
    throw new HttpError(403, 'Usuário sem acesso a nenhuma conta');
  }
  return membership;
}

/** Monta o access token a partir de uma membership. */
async function issueAccessForUser(
  userId: string,
): Promise<{ accessToken: string; tenantId: string }> {
  const membership = await resolveMembership(userId);
  const perms = await permissionsForRole(membership.roleId);
  const accessToken = signAccessToken({
    sub: userId,
    tid: membership.tenantId,
    mid: membership.id,
    role: membership.role.key,
    perms,
  });
  return { accessToken, tenantId: membership.tenantId };
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string };
}

// ---------------------------------------------------------------------------

export async function register(input: RegisterInput, meta: RefreshMeta): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new HttpError(409, 'E-mail já cadastrado');
  }

  const passwordHash = await hashPassword(input.password);
  const slug = `${slugify(input.companyName ?? input.name)}-${crypto.randomBytes(3).toString('hex')}`;

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: { name: input.name, email: input.email, passwordHash, status: 'ACTIVE' },
    });

    const tenant = await tx.tenant.create({
      data: {
        name: input.companyName ?? input.name,
        slug,
        ownerUserId: createdUser.id,
        status: 'TRIALING',
      },
    });

    await seedTenantRoles(tx, tenant.id);

    const adminRole = await tx.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: tenant.id, key: ROLE_KEYS.ADMIN } },
    });

    await tx.membership.create({
      data: {
        tenantId: tenant.id,
        userId: createdUser.id,
        roleId: adminRole.id,
        status: 'ACTIVE',
        isOwner: true,
      },
    });

    return createdUser;
  });

  const { accessToken } = await issueAccessForUser(user.id);
  const refreshToken = await issueRefreshToken(user.id, meta);

  logger.info({ userId: user.id }, 'novo usuário registrado');
  return { accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email } };
}

export async function login(input: LoginInput, meta: RefreshMeta): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Mensagem genérica para não revelar existência do e-mail.
  if (!user || !user.passwordHash) {
    throw new HttpError(401, 'Credenciais inválidas');
  }
  if (user.status !== 'ACTIVE') {
    throw new HttpError(403, 'Conta inativa ou suspensa');
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    throw new HttpError(401, 'Credenciais inválidas');
  }

  const { accessToken } = await issueAccessForUser(user.id);
  const refreshToken = await issueRefreshToken(user.id, meta);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return { accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email } };
}

export async function refresh(
  rawToken: string,
  meta: RefreshMeta,
): Promise<{ accessToken: string; refreshToken: string }> {
  const rotated = await rotateRefreshToken(rawToken, meta);
  const { accessToken } = await issueAccessForUser(rotated.userId);
  return { accessToken, refreshToken: rotated.raw };
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (rawToken) {
    await revokeRefreshToken(rawToken);
  }
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, avatarUrl: true, status: true, lastLoginAt: true },
  });
  if (!user) {
    throw new HttpError(404, 'Usuário não encontrado');
  }
  const membership = await resolveMembership(userId);
  const permissions = await permissionsForRole(membership.roleId);

  return {
    user,
    tenant: {
      id: membership.tenant.id,
      name: membership.tenant.name,
      slug: membership.tenant.slug,
    },
    role: { key: membership.role.key, name: membership.role.name },
    permissions,
  };
}

export async function forgotPassword(input: ForgotPasswordInput): Promise<{ devToken?: string }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Sempre responde sucesso (evita enumeração de usuários).
  if (!user) {
    return {};
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      email: user.email,
      type: 'PASSWORD_RESET',
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  // A ENTREGA por e-mail será integrada depois; por ora registramos o token.
  logger.info({ userId: user.id }, 'token de reset de senha gerado');

  // Em desenvolvimento devolvemos o token para permitir o teste do fluxo.
  return isProduction ? {} : { devToken: rawToken };
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const record = await prisma.verificationToken.findFirst({
    where: {
      tokenHash: sha256(input.token),
      type: 'PASSWORD_RESET',
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!record || !record.userId) {
    throw new HttpError(400, 'Token inválido ou expirado');
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
  ]);

  // Invalida todas as sessões após troca de senha.
  await revokeAllRefreshTokens(record.userId);
}
