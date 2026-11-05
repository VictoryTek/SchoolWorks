/**
 * The purchase order list search (shared by the All / Issued / ... tabs) also finds a PO by
 * the name of the person who requested it: first name, last name, display name, or a full
 * name typed as several words ("Joseph Lewis"). The previous matches (description, PO
 * number, program) keep working.
 *
 * Names carry a random suffix so this never collides with POs from other test files.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { PurchaseOrderService } from '../services/purchaseOrder.service';
import { getTestPrisma, cleanupUsers } from './helpers/db';

describe('Purchase orders — search by requester', () => {
  const prisma = getTestPrisma();
  const service = new PurchaseOrderService(prisma);
  const s = crypto.randomUUID().slice(0, 8);

  const userIds: string[] = [];
  let joeId: string;
  let joeIssued: string;
  let joeDraft: string;
  let sandraIssued: string;
  let zedIssued: string;

  const makeUser = async (firstName: string, lastName: string, displayName?: string) => {
    const id = crypto.randomUUID();
    const u = await prisma.user.create({
      data: {
        entraId: `test-entra-${id}`,
        email: `test-${id}@example.test`,
        firstName,
        lastName,
        displayName: displayName ?? `${firstName} ${lastName}`,
        role: 'USER',
        isActive: true,
        cachedGroups: [],
        groupsLastSyncedAt: new Date(),
      },
      select: { id: true },
    });
    userIds.push(u.id);
    return u.id;
  };
  const makePo = async (requestorId: string, status: string, description: string) =>
    (await prisma.purchase_orders.create({
      data: { type: 'equipment', requestorId, status, description, amount: 100 },
      select: { id: true },
    })).id;

  // Level 5: sees every PO, so only the search decides what comes back.
  const search = async (term: string, status?: 'po_issued') => {
    const res = await service.getPurchaseOrders({ page: 1, limit: 50, search: term, ...(status && { status }) } as never, 'viewer', 5, []);
    return res.items.map((p) => p.id);
  };

  beforeAll(async () => {
    const joe = await makeUser('Joseph', `Lewis${s}`);
    joeId = joe;
    const sandra = await makeUser('Sandra', `Simpson${s}`);
    const zed = await makeUser('Zed', `Zeta${s}`, `Zedd Nickname${s}`);
    joeIssued = await makePo(joe, 'po_issued', `Projector ${s}`);
    joeDraft = await makePo(joe, 'draft', `Cables ${s}`);
    sandraIssued = await makePo(sandra, 'po_issued', `Chairs ${s}`);
    zedIssued = await makePo(zed, 'po_issued', `Desks ${s}`);
  });

  afterAll(async () => {
    await prisma.purchase_orders.deleteMany({ where: { requestorId: { in: userIds } } });
    await cleanupUsers(userIds);
  });

  it('finds an issued PO by the requester\'s last name', async () => {
    expect(await search(`lewis${s}`, 'po_issued')).toEqual([joeIssued]);
  });

  it('finds an issued PO by first name plus last name, in any letter case', async () => {
    expect(await search(`Joseph Lewis${s}`, 'po_issued')).toEqual([joeIssued]);
    expect(await search(`SANDRA SIMPSON${s}`, 'po_issued')).toEqual([sandraIssued]);
  });

  it('finds a PO by the requester\'s display name', async () => {
    expect(await search(`nickname${s}`, 'po_issued')).toEqual([zedIssued]);
  });

  it('needs every typed word to match the same requester', async () => {
    expect(await search(`Joseph Simpson${s}`, 'po_issued')).toEqual([]);
  });

  it('searches every status when no status filter is given', async () => {
    expect((await search(`lewis${s}`)).sort()).toEqual([joeIssued, joeDraft].sort());
  });

  it('does not let a regular user find other people\'s POs by requester name', async () => {
    // Level 1 only sees their own POs; the name search must not widen that.
    const asJoe = async (term: string) =>
      (await service.getPurchaseOrders({ page: 1, limit: 50, search: term } as never, joeId, 1, [])).items.map((p) => p.id);

    expect((await asJoe(`joseph lewis${s}`)).sort()).toEqual([joeIssued, joeDraft].sort());
    expect(await asJoe(`sandra simpson${s}`)).toEqual([]);
    expect(await asJoe(`nickname${s}`)).toEqual([]);
  });

  it('still finds a PO by its description', async () => {
    expect(await search(`Projector ${s}`, 'po_issued')).toEqual([joeIssued]);
  });
});
