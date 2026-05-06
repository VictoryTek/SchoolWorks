import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireAdmin } from '../middleware/auth';
import { requireAdminOrPrimarySupervisor } from '../middleware/requireAdminOrPrimarySupervisor';
import { validateRequest } from '../middleware/validation';
import { validateCsrfToken } from '../middleware/csrf';
import {
  LocationIdParamSchema,
  RoomIdParamSchema,
  RoomUserParamSchema,
  UserIdParamSchema,
} from '../validators/userRoomAssignment.validators';
import * as controller from '../controllers/userRoomAssignment.controller';

const router = Router();

const assignRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many assignment requests, please try again later.' },
});

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/room-assignments/location/:locationId
 * List all rooms in a location with their assigned users.
 * Accessible to admins and the primary supervisor of that location.
 */
router.get(
  '/room-assignments/location/:locationId',
  validateRequest(LocationIdParamSchema, 'params'),
  requireAdminOrPrimarySupervisor('params'),
  controller.getAssignmentsByLocation
);

/**
 * GET /api/room-assignments/location/:locationId/users
 * Get active staff users for a location (for the assignment dialog).
 * Accessible to admins and the primary supervisor of that location.
 */
router.get(
  '/room-assignments/location/:locationId/users',
  validateRequest(LocationIdParamSchema, 'params'),
  requireAdminOrPrimarySupervisor('params'),
  controller.getUsersByLocation
);

/**
 * GET /api/room-assignments/room/:roomId
 * Get assignments for a specific room.
 * Accessible to admins and the primary supervisor of the room's location (checked inline).
 */
router.get(
  '/room-assignments/room/:roomId',
  validateRequest(RoomIdParamSchema, 'params'),
  controller.getAssignmentsByRoom
);

/**
 * GET /api/room-assignments/user/:userId
 * Get all room assignments for a user. Admin only.
 */
router.get(
  '/room-assignments/user/:userId',
  requireAdmin,
  validateRequest(UserIdParamSchema, 'params'),
  controller.getUserRoomAssignments
);

/**
 * POST /api/room-assignments/room/:roomId/assign
 * Assign users to a room (body includes locationId for scope validation).
 */
router.post(
  '/room-assignments/room/:roomId/assign',
  assignRateLimiter,
  validateCsrfToken,
  validateRequest(RoomIdParamSchema, 'params'),
  controller.assignUsersToRoom
);

/**
 * DELETE /api/room-assignments/room/:roomId/user/:userId
 * Remove a user from a room (query includes locationId for scope validation).
 */
router.delete(
  '/room-assignments/room/:roomId/user/:userId',
  validateCsrfToken,
  validateRequest(RoomUserParamSchema, 'params'),
  controller.unassignUserFromRoom
);

/**
 * PUT /api/room-assignments/user/:userId/primary-room
 * Set or clear the primary room for a user. Admin or primary supervisor.
 */
router.put(
  '/room-assignments/user/:userId/primary-room',
  validateCsrfToken,
  validateRequest(UserIdParamSchema, 'params'),
  controller.setPrimaryRoom
);

export default router;
