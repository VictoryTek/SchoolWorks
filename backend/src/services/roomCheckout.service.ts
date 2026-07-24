/**
 * Room Check Out Service
 *
 * Reassigns equipment.roomId/officeLocationId from a scanned list of tags.
 * Deliberately does not create any InventoryAuditSession/InventoryAuditItem
 * rows — this is a lightweight operational tool, not part of the audited
 * inventory trail (see .github/docs/subagent_docs/ROOM_CHECKOUT_spec.md).
 */

import { PrismaClient } from '@prisma/client';
import { NotFoundError } from '../utils/errors';
import { loggers } from '../lib/logger';
import { InventoryService } from './inventory.service';

interface UserContext {
  id: string;
  email: string;
  name: string;
}

export interface RoomCheckoutCompleteResult {
  moved: number;
  unassigned: number;
  failed: number;
  errors: Array<{ equipmentId: string; error: string }>;
}

export class RoomCheckoutService {
  private inventoryService: InventoryService;

  constructor(private prisma: PrismaClient) {
    this.inventoryService = new InventoryService(prisma);
  }

  /**
   * Look up a device by exact, case-insensitive match on assetTag, barcode,
   * or qrCode — the "scan a tag" lookup for Room Check Out.
   */
  async lookupTag(tag: string) {
    const equipment = await this.prisma.equipment.findFirst({
      where: {
        OR: [
          { assetTag: { equals: tag, mode: 'insensitive' } },
          { barcode: { equals: tag, mode: 'insensitive' } },
          { qrCode: { equals: tag, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        assetTag: true,
        name: true,
        serialNumber: true,
        status: true,
        isDisposed: true,
        roomId: true,
        officeLocationId: true,
        room: { select: { id: true, name: true } },
        officeLocation: { select: { id: true, name: true } },
      },
    });

    if (!equipment) {
      throw new NotFoundError('Equipment', tag);
    }

    return equipment;
  }

  /**
   * Complete a room check out: the scanned equipmentIds become the
   * authoritative full inventory for this room. Every scanned device is
   * moved into the room; every device currently in the room but not
   * scanned is unassigned (roomId cleared).
   *
   * Loops with per-item try/catch (matching InventoryService.bulkUpdate's
   * existing shape) rather than a single transaction, so one bad id can't
   * abort the whole reconciliation.
   */
  async completeCheckout(
    officeLocationId: string,
    roomId: string,
    equipmentIds: string[],
    user: UserContext
  ): Promise<RoomCheckoutCompleteResult> {
    const errors: Array<{ equipmentId: string; error: string }> = [];
    let moved = 0;

    for (const id of equipmentIds) {
      try {
        await this.inventoryService.update(id, { roomId, officeLocationId }, user);
        moved++;
      } catch (error) {
        errors.push({
          equipmentId: id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const staleOccupants = await this.prisma.equipment.findMany({
      where: { roomId, id: { notIn: equipmentIds } },
      select: { id: true },
    });

    let unassigned = 0;
    for (const item of staleOccupants) {
      try {
        await this.inventoryService.update(item.id, { roomId: null }, user);
        unassigned++;
      } catch (error) {
        errors.push({
          equipmentId: item.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    loggers.inventory.info('Room check out completed', {
      officeLocationId,
      roomId,
      userId: user.id,
      moved,
      unassigned,
      failed: errors.length,
    });

    return { moved, unassigned, failed: errors.length, errors };
  }
}
