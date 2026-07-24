/**
 * Room Check Out Controller
 *
 * Handles HTTP requests and responses for the Room Check Out feature.
 * Delegates business logic to RoomCheckoutService.
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { RoomCheckoutService } from '../services/roomCheckout.service';
import { RoomCheckoutLookupQueryDto, CompleteRoomCheckoutDto } from '../validators/roomCheckout.validators';
import { handleControllerError } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';

const roomCheckoutService = new RoomCheckoutService(prisma);

function buildUserContext(req: AuthRequest) {
  return {
    id: req.user!.id,
    name: req.user!.name,
    email: req.user!.email,
  };
}

/**
 * GET /api/room-checkout/lookup?tag=...
 */
export const lookupTag = async (req: AuthRequest, res: Response) => {
  try {
    const { tag } = req.query as unknown as RoomCheckoutLookupQueryDto;
    const result = await roomCheckoutService.lookupTag(tag);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/room-checkout/complete
 */
export const completeCheckout = async (req: AuthRequest, res: Response) => {
  try {
    const { officeLocationId, roomId, equipmentIds } = req.body as CompleteRoomCheckoutDto;
    const user = buildUserContext(req);
    const result = await roomCheckoutService.completeCheckout(officeLocationId, roomId, equipmentIds, user);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};
