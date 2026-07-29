import type { Prisma } from '@whats-boot/database';

/**
 * Catálogo de permissões (global) e papéis padrão por tenant.
 * Papéis pedidos na ETAPA 4: Administrador, Cliente, Funcionário.
 */

export const PERMISSIONS = [
  { key: 'users.read', group: 'users', name: 'Ver usuários' },
  { key: 'users.manage', group: 'users', name: 'Gerenciar usuários' },
  { key: 'team.read', group: 'team', name: 'Ver equipe' },
  { key: 'team.manage', group: 'team', name: 'Gerenciar equipe' },
  { key: 'channels.read', group: 'channels', name: 'Ver canais' },
  { key: 'channels.manage', group: 'channels', name: 'Gerenciar canais' },
  { key: 'conversations.read', group: 'conversations', name: 'Ver conversas' },
  { key: 'conversations.write', group: 'conversations', name: 'Atender conversas' },
  { key: 'conversations.assign', group: 'conversations', name: 'Atribuir conversas' },
  { key: 'contacts.read', group: 'contacts', name: 'Ver contatos' },
  { key: 'contacts.write', group: 'contacts', name: 'Editar contatos' },
  { key: 'ai.read', group: 'ai', name: 'Ver configuração de IA' },
  { key: 'ai.manage', group: 'ai', name: 'Gerenciar IA' },
  { key: 'settings.read', group: 'settings', name: 'Ver configurações' },
  { key: 'settings.manage', group: 'settings', name: 'Gerenciar configurações' },
  { key: 'billing.read', group: 'billing', name: 'Ver faturamento' },
  { key: 'billing.manage', group: 'billing', name: 'Gerenciar faturamento' },
  { key: 'reports.read', group: 'reports', name: 'Ver relatórios' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const ROLE_KEYS = {
  ADMIN: 'admin',
  CLIENT: 'client',
  EMPLOYEE: 'employee',
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key);

/** Papéis padrão e suas permissões. */
export const ROLE_DEFINITIONS: Record<
  RoleKey,
  { name: string; description: string; permissions: readonly PermissionKey[] }
> = {
  [ROLE_KEYS.ADMIN]: {
    name: 'Administrador',
    description: 'Acesso total à conta',
    permissions: ALL_PERMISSIONS,
  },
  [ROLE_KEYS.CLIENT]: {
    name: 'Cliente',
    description: 'Dono da conta: visão gerencial e faturamento',
    permissions: [
      'channels.read',
      'conversations.read',
      'contacts.read',
      'contacts.write',
      'ai.read',
      'settings.read',
      'settings.manage',
      'billing.read',
      'billing.manage',
      'reports.read',
      'team.read',
    ],
  },
  [ROLE_KEYS.EMPLOYEE]: {
    name: 'Funcionário',
    description: 'Operação de atendimento',
    permissions: [
      'channels.read',
      'conversations.read',
      'conversations.write',
      'conversations.assign',
      'contacts.read',
      'contacts.write',
      'ai.read',
    ],
  },
};

/**
 * Garante as permissões globais e cria/atualiza os 3 papéis padrão de um tenant.
 * Idempotente. Chamado no registro de uma nova conta.
 */
export async function seedTenantRoles(
  prisma: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  // 1. Permissões globais (upsert por key)
  await Promise.all(
    PERMISSIONS.map((p) =>
      prisma.permission.upsert({
        where: { key: p.key },
        update: { name: p.name, group: p.group },
        create: { key: p.key, name: p.name, group: p.group },
      }),
    ),
  );

  const permissions = await prisma.permission.findMany({
    where: { key: { in: ALL_PERMISSIONS as unknown as string[] } },
    select: { id: true, key: true },
  });
  const permIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

  // 2. Papéis do tenant + vínculos de permissão
  for (const [key, def] of Object.entries(ROLE_DEFINITIONS) as [
    RoleKey,
    (typeof ROLE_DEFINITIONS)[RoleKey],
  ][]) {
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { name: def.name, description: def.description },
      create: {
        tenantId,
        key,
        name: def.name,
        description: def.description,
        scope: 'TENANT',
        isSystem: true,
        isDefault: key === ROLE_KEYS.EMPLOYEE,
      },
    });

    const rows = def.permissions
      .map((pk) => permIdByKey.get(pk))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId: role.id, permissionId }));

    if (rows.length > 0) {
      await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
    }
  }
}
