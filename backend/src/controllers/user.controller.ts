import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { UserService } from '../services/user.service';
import { getUserIncidentSummary } from '../services/damageIncident.service';
import { handleControllerError } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';
import { loggers } from '../lib/logger';

// Instantiate service
const userService = new UserService(prisma);

/**
 * Get all users with pagination and search
 */
export const getUsers = async (req: Request, res: Response) => {
  try {
    const result = await userService.findAll(req.query);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get current authenticated user's own record (including permissions)
 */
export const getMe = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await userService.findById(userId);
    res.json(user);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Resolve the current user's officeLocation string to the matching OfficeLocation record.
 * Returns 200 with a result object (resolved: true|false) when user has an officeLocation string.
 * Returns 204 only when User.officeLocation is null/empty.
 */
export const getMyOfficeLocation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = await userService.getMyOfficeLocation(userId);
    if (!result) {
      // User has no officeLocation string at all
      return res.status(204).send();
    }
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get IT administrator contact info for permission-denied pages.
 * Returns users whose role is ADMIN (display name + email only).
 */
export const getAdminContacts = async (_req: AuthRequest, res: Response) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { displayName: true, email: true },
      orderBy: { displayName: 'asc' },
    });
    res.json(admins);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get user by ID
 */
export const getUserById = async (req: Request, res: Response) => {
  try {
    const user = await userService.findById(req.params.id as string);
    res.json(user);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Update user role
 */
export const updateUserRole = async (req: Request, res: Response) => {
  try {
    const { role } = req.body;
    const user = await userService.updateRole(req.params.id as string, role);
    res.json({ user });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Toggle user active status
 */
export const toggleUserStatus = async (req: Request, res: Response) => {
  try {
    const user = await userService.toggleStatus(req.params.id as string);
    res.json({ user });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get all users who are supervisors
 */
export const getSupervisorUsers = async (req: Request, res: Response) => {
  try {
    const users = await userService.getSupervisorUsers();
    res.json(users);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get supervisors assigned to a specific user
 */
export const getUserSupervisors = async (req: Request, res: Response) => {
  try {
    const supervisors = await userService.getUserSupervisors(req.params.userId as string);
    res.json(supervisors);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Add a supervisor to a user
 */
export const addUserSupervisor = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.params.userId as string;
    const { supervisorId, locationId, isPrimary = false, notes } = req.body;
    const assignedBy = req.user.id;

    // Validate required fields
    if (!supervisorId) {
      return res.status(400).json({ error: 'supervisorId is required' });
    }

    const assignment = await userService.assignSupervisor(userId, supervisorId, {
      locationId,
      isPrimary,
      notes,
      assignedBy,
    });

    res.status(201).json(assignment);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Remove a supervisor from a user
 */
export const removeUserSupervisor = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const supervisorId = req.params.supervisorId as string;
    await userService.removeSupervisor(userId, supervisorId);
    res.json({ message: 'Supervisor removed successfully' });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Search for potential supervisors
 */
export const searchPotentialSupervisors = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const search = (req.query.search as string) || '';
    const users = await userService.searchPotentialSupervisors(userId, search);
    res.json(users);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Search users for autocomplete (accessible to TECHNOLOGY permission holders)
 */
export const searchUsers = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 50);
    const locationId = req.query.locationId ? String(req.query.locationId) : undefined;
    const staffOnly = req.query.staffOnly === 'true';

    loggers.user.debug('User autocomplete search', { q, limit, locationId, staffOnly });

    const users = await userService.searchForAutocomplete(q, limit, locationId, staffOnly);
    res.json(users);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get a lightweight user summary (display fields only — no sensitive role/permission data).
 * Protected by requireModule('TECHNOLOGY', 1) — not admin-only.
 */
export const getUserSummary = async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const summary = await userService.getUserSummary(id);
    res.json(summary);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get damage incident summary for a user (count + recent incidents).
 * Protected by requireDeviceManagementAccess() — not admin-only.
 */
export const getUserIncidentSummaryController = async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const summary = await getUserIncidentSummary(id);
    res.json(summary);
  } catch (error) {
    handleControllerError(error, res);
  }
};

