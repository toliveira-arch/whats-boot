import crypto from 'node:crypto';
import { prisma, runAsSystem, runWithTenant } from '@whats-boot/database';
import { encryptSecret } from '../lib/crypto';

/**
 * Cria dados de demonstração para o Chat (empresa, canal, contato, conversa e
 * mensagens) — permite testar a interface sem WhatsApp/Evolution.
 * Idempotente: se já existir o canal "demo", não faz nada.
 * Uso: npm run seed:demo   (requer o admin criado por `npm run seed`).
 */
const adminEmail = process.env.SEED_EMAIL ?? 'admin@whatsboot.dev';

async function main(): Promise<void> {
  const tenantId = await runAsSystem(async () => {
    const user = await prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });
    if (user) {
      const m = await prisma.membership.findFirst({
        where: { userId: user.id },
        select: { tenantId: true },
      });
      if (m) return m.tenantId;
    }
    const first = await prisma.tenant.findFirst({ select: { id: true } });
    return first?.id ?? null;
  });

  if (!tenantId) {
    // eslint-disable-next-line no-console
    console.error('Nenhum tenant encontrado. Rode `npm run seed` primeiro.');
    process.exit(1);
  }

  await runWithTenant(tenantId, async () => {
    const existing = await prisma.evolutionInstance.findFirst({ where: { name: 'Canal Demo' } });
    if (existing) {
      // eslint-disable-next-line no-console
      console.log('Dados de demo já existem — nada a fazer.');
      return;
    }

    const company =
      (await prisma.company.findFirst({ select: { id: true } })) ??
      (await prisma.company.create({
        data: { tenantId, name: 'Empresa Demo' },
        select: { id: true },
      }));

    const channel = await prisma.evolutionInstance.create({
      data: {
        tenantId,
        companyId: company.id,
        name: 'Canal Demo',
        instanceName: `demo-${crypto.randomBytes(3).toString('hex')}`,
        baseUrl: 'http://localhost:8080',
        apiKeyEncrypted: encryptSecret('demo-key'),
        webhookToken: crypto.randomBytes(16).toString('hex'),
        status: 'CONNECTED',
      },
    });

    const contacts = [
      { name: 'Maria Souza', phone: '5511988887777' },
      { name: 'João Pereira', phone: '5521977776666' },
    ];

    for (const [i, ct] of contacts.entries()) {
      const waJid = `${ct.phone}@s.whatsapp.net`;
      const contact = await prisma.contact.create({
        data: {
          tenantId,
          companyId: company.id,
          waJid,
          phoneNumber: ct.phone,
          name: ct.name,
          pushName: ct.name,
        },
      });

      const now = Date.now();
      const conversation = await prisma.conversation.create({
        data: {
          tenantId,
          companyId: company.id,
          contactId: contact.id,
          evolutionInstanceId: channel.id,
          waRemoteJid: waJid,
          status: 'OPEN',
          unreadCount: i === 0 ? 2 : 0,
          lastMessageAt: new Date(now),
        },
      });

      const msgs = [
        { dir: 'INBOUND', author: 'CONTACT', text: 'Olá! Gostaria de mais informações.', off: 6 },
        { dir: 'OUTBOUND', author: 'AGENT', text: 'Oi! Claro, como posso ajudar?', off: 5 },
        { dir: 'INBOUND', author: 'CONTACT', text: 'Qual o valor do plano?', off: 1 },
      ] as const;

      for (const m of msgs) {
        await prisma.message.create({
          data: {
            tenantId,
            companyId: company.id,
            conversationId: conversation.id,
            contactId: contact.id,
            evolutionInstanceId: channel.id,
            direction: m.dir,
            authorType: m.author,
            type: 'TEXT',
            content: m.text,
            status: m.dir === 'OUTBOUND' ? 'READ' : 'DELIVERED',
            waMessageId: crypto.randomBytes(8).toString('hex'),
            createdAt: new Date(now - m.off * 60 * 1000),
          },
        });
      }
    }

    // eslint-disable-next-line no-console
    console.log('✅ Dados de demonstração criados (2 conversas com mensagens).');
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('Falha no seed-demo:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
