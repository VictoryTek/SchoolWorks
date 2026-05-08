/**
 * Zod validation schemas for user management endpoints
 * 
 * These schemas provide runtime validation of incoming requests for user operations.
 * TypeScript types are automatically inferred from these schemas using z.infer<>.
 */

import { z } from 'zod';

/**
 * Valid user roles in the system
 */
const UserRole = z.enum(['ADMIN', 'USER']);

/**
 * Validation schema for UUID parameters
 */
export const UserIdParamSchema = z.object({
  id: z.string().uuid('Invalid user ID format'),
});

/**
 * Validation schema for userId in params
 */
export const UserIdParamSchema2 = z.object({
  userId: z.string().uuid('Invalid user ID format'),
});

/**
 * Validation schema for supervisor ID in params
 */
export const SupervisorIdParamSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  supervisorId: z.string().uuid('Invalid supervisor ID format'),
});

/**
 * Validation schema for get users query parameters
 */
export const GetUsersQuerySchema = z.object({
  page: z.string().optional().transform((val) => val ? parseInt(val, 10) : 1),
  limit: z.string().optional().transform((val) => val ? parseInt(val, 10) : 50),
  search: z.string().max(200, 'Search term must be 200 characters or fewer').optional().default(''),
  accountType: z.enum(['all', 'staff', 'student']).optional(),
});

/**
 * Validation schema for updating user role
 */
export const UpdateUserRoleSchema = z.object({
  role: UserRole,
});

/**
 * Validation schema for adding a user supervisor
 */
export const AddUserSupervisorSchema = z.object({
  supervisorId: z.string().uuid('Invalid supervisor ID format'),
  supervisorType: z.enum(['ORMB', 'KURSTIE', 'SUPERVISOR', 'SFMH'])
    .optional(),
  notes: z.string().max(500).optional(),
});

/**
 * Validation schema for user search autocomplete query parameters
 */
export const SearchUsersQuerySchema = z.object({
  q: z.string().max(200, 'Search term must be 200 characters or fewer').optional().default(''),
  limit: z.coerce.number().int().positive().max(50).default(20).optional(),
});

/**
 * TypeScript type exports (inferred from schemas)
 */
export type UserIdParam = z.infer<typeof UserIdParamSchema>;
export type GetUsersQuery = z.infer<typeof GetUsersQuerySchema>;
export type UpdateUserRole = z.infer<typeof UpdateUserRoleSchema>;
export type AddUserSupervisor = z.infer<typeof AddUserSupervisorSchema>;
export type SearchUsersQuery = z.infer<typeof SearchUsersQuerySchema>;
