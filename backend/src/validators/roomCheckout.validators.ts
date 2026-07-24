/**
 * Zod validation schemas for the Room Check Out feature.
 *
 * Room Check Out reassigns existing equipment.roomId/officeLocationId based
 * on a scanned list of tags — it does not create any new persisted session
 * or history record (see .github/docs/subagent_docs/ROOM_CHECKOUT_spec.md).
 */

import { z } from 'zod';

/**
 * Validation schema for the tag lookup query (GET /room-checkout/lookup?tag=...)
 */
export const RoomCheckoutLookupQuerySchema = z.object({
  tag: z.string().trim().min(1, 'Tag is required').max(100, 'Tag too long'),
});

/**
 * Validation schema for completing a room check out.
 * equipmentIds is the full scanned list for the room (authoritative — see spec §2).
 */
export const CompleteRoomCheckoutSchema = z.object({
  officeLocationId: z.string().uuid('Invalid location ID format'),
  roomId: z.string().uuid('Invalid room ID format'),
  equipmentIds: z.array(z.string().uuid('Invalid equipment ID format')).max(500, 'Too many devices in one checkout'),
});

/**
 * TypeScript type exports (inferred from schemas)
 */
export type RoomCheckoutLookupQueryDto = z.infer<typeof RoomCheckoutLookupQuerySchema>;
export type CompleteRoomCheckoutDto = z.infer<typeof CompleteRoomCheckoutSchema>;
