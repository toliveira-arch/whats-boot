'use strict';

// Singleton do Prisma Client compartilhado por api e workers.
// Evita esgotar o pool recriando o client em hot-reload de desenvolvimento.
const { PrismaClient, Prisma } = require('@prisma/client');

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__whatsBootPrisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__whatsBootPrisma = prisma;
}

module.exports = { prisma, PrismaClient, Prisma };
