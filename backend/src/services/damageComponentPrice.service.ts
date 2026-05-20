import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { NotFoundError } from '../utils/errors';
import type { z } from 'zod';
import type {
  CreateComponentPriceSchema,
  UpdateComponentPriceSchema,
  ListComponentPricesQuerySchema,
} from '../validators/damageComponentPrice.validators';

const log = createLogger('DamageComponentPriceService');

type CreateData = z.infer<typeof CreateComponentPriceSchema>;
type UpdateData = z.infer<typeof UpdateComponentPriceSchema>;
type ListQuery  = z.infer<typeof ListComponentPricesQuerySchema>;

export async function getAll(query: ListQuery) {
  const page            = Number(query.page)  || 1;
  const limit           = Number(query.limit) || 50;
  const { category, includeInactive } = query;
  const skip = (page - 1) * limit;

  const where = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(category ? { category } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.damageComponentPrice.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
    prisma.damageComponentPrice.count({ where }),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getById(id: string) {
  const price = await prisma.damageComponentPrice.findUnique({ where: { id } });
  if (!price) throw new NotFoundError('DamageComponentPrice', id);
  return price;
}

export async function create(data: CreateData) {
  log.info('Creating component price', { name: data.name });
  return prisma.damageComponentPrice.create({ data });
}

export async function update(id: string, data: UpdateData) {
  log.info('Updating component price', { id });
  const existing = await prisma.damageComponentPrice.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('DamageComponentPrice', id);
  return prisma.damageComponentPrice.update({ where: { id }, data });
}

export async function deactivate(id: string) {
  log.info('Deactivating component price', { id });
  const existing = await prisma.damageComponentPrice.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('DamageComponentPrice', id);
  return prisma.damageComponentPrice.update({ where: { id }, data: { isActive: false } });
}
