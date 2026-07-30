import crypto from 'node:crypto';
import { prisma, runAsSystem } from '@whats-boot/database';
import { hashPassword } from '../modules/auth/password';
import { seedTenantRoles, ROLE_KEYS } from '../modules/auth/rbac';

/**
 * Cria um usuário administrador de exemplo (idempotente) para o primeiro acesso.
 * Configurável por env: SEED_EMAIL, SEED_PASSWORD, SEED_NAME, SEED_COMPANY.
 *
 * Uso: npm run seed   (requer Postgres no ar + migrations aplicadas)
 */
const email = process.env.SEED_EMAIL ?? 'admin@whatsboot.dev';
const password = process.env.SEED_PASSWORD ?? 'Admin123';
const name = process.env.SEED_NAME ?? 'Admin';
const companyName = process.env.SEED_COMPANY ?? 'Minha Empresa';

async function main(): Promise<void> {
  await runAsSystem(async () => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // eslint-disable-next-line no-console
      console.log(`Usuário já existe: ${email} (nenhuma alteração).`);
      return;
    }

    const passwordHash = await hashPassword(password);
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto
      .randomBytes(3)
      .toString('hex')}`;

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name, email, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      const tenant = await tx.tenant.create({
        data: { name: companyName, slug, ownerUserId: user.id, status: 'ACTIVE' },
      });
      await seedTenantRoles(tx, tenant.id);
      const adminRole = await tx.role.findUniqueOrThrow({
        where: { tenantId_key: { tenantId: tenant.id, key: ROLE_KEYS.ADMIN } },
      });
      await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          roleId: adminRole.id,
          status: 'ACTIVE',
          isOwner: true,
        },
      });
    });

    // eslint-disable-next-line no-console
    console.log(`✅ Admin criado.\n   e-mail: ${email}\n   senha:  ${password}`);
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('Falha no seed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
