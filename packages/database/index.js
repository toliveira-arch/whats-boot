'use strict';

// Singleton do Prisma Client compartilhado por api e workers, JÁ com o guard
// de isolamento multi-tenant aplicado (ver tenant-context.js).
const { PrismaClient, Prisma } = require('@prisma/client');
const {
  applyTenantGuard,
  runWithTenant,
  runAsSystem,
  getTenantContext,
} = require('./tenant-context');

const globalForPrisma = globalThis;

function createClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
  });
  return applyTenantGuard(base);
}

const prisma = globalForPrisma.__whatsBootPrisma || createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__whatsBootPrisma = prisma;
}

module.exports = {
  prisma,
  PrismaClient,
  Prisma,
  runWithTenant,
  runAsSystem,
  getTenantContext,
};
