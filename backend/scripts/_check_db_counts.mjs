import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const [di, eq] = await Promise.all([p.damageIncident.count(), p.equipment.count()]);
console.log('DamageIncidents:', di, '| Equipment:', eq);
await p.$disconnect();
