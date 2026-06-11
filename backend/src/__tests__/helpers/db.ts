import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import crypto from 'crypto';

// ─── Singleton test Prisma client ────────────────────────────────────────────
// Separate from the app's singleton so test teardown can disconnect cleanly
// without disturbing the application client imported via app.ts.

let _testPrisma: PrismaClient | undefined;

export function getTestPrisma(): PrismaClient {
  if (!_testPrisma) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
    });
    const adapter = new PrismaPg(pool);
    _testPrisma = new PrismaClient({ adapter });
  }
  return _testPrisma;
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

export async function createTestUser(overrides?: Partial<{
  role: string;
  isActive: boolean;
  cachedGroups: string[];
}>): Promise<{ id: string; entraId: string; email: string }> {
  const prisma = getTestPrisma();
  const uid = crypto.randomUUID();
  return prisma.user.create({
    data: {
      entraId: `test-entra-${uid}`,
      email: `test-${uid}@example.test`,
      firstName: 'Test',
      lastName: 'User',
      displayName: `Test User ${uid.slice(0, 8)}`,
      role: overrides?.role ?? 'USER',
      isActive: overrides?.isActive ?? true,
      // Non-empty cachedGroups + fresh groupsLastSyncedAt prevents Graph API
      // calls during token refresh (GROUP_MEMBERSHIP_CACHE_TTL_MS=999999999).
      cachedGroups: overrides?.cachedGroups ?? [
        process.env.ENTRA_ALL_STAFF_GROUP_ID ?? 'test-allstaff-group-id',
      ],
      groupsLastSyncedAt: new Date(),
    },
    select: { id: true, entraId: true, email: true },
  });
}

/**
 * Creates a RefreshToken row in the DB.
 * Returns the jti that was used.
 */
export async function createTestRefreshToken(
  userId: string,
  jti: string = crypto.randomUUID(),
  revokedAt?: Date,
): Promise<string> {
  const prisma = getTestPrisma();
  await prisma.refreshToken.create({
    data: {
      jti,
      userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: revokedAt ?? null,
    },
  });
  return jti;
}

export async function createTestLocation(name?: string): Promise<{ id: string }> {
  const prisma = getTestPrisma();
  const uid = crypto.randomUUID().slice(0, 8);
  return prisma.officeLocation.create({
    data: {
      name: name ?? `Test Location ${uid}`,
      type: 'SCHOOL',
      isActive: true,
    },
    select: { id: true },
  });
}

/**
 * Assigns a user as a LocationSupervisor at an office location.
 * Used to establish the location scope for level-3 work order users.
 */
export async function assignLocationSupervisor(
  userId: string,
  locationId: string,
): Promise<void> {
  const prisma = getTestPrisma();
  await prisma.locationSupervisor.create({
    data: {
      locationId,
      userId,
      supervisorType: 'SCHOOL_MAINTENANCE',
      isPrimary: false,
    },
  });
}

/**
 * Creates a Ticket (work order) at the specified location.
 * Note: `department` and `status` use Prisma enum string values.
 */
export async function createTestWorkOrder(params: {
  reportedById: string;
  officeLocationId: string;
  assignedToId?: string;
}): Promise<{ id: string }> {
  const prisma = getTestPrisma();
  const uid = crypto.randomUUID().slice(0, 8);
  return prisma.ticket.create({
    data: {
      ticketNumber: `TEST-${Date.now()}-${uid}`,
      department: 'TECHNOLOGY',
      description: 'Test work order',
      priority: 'LOW',
      status: 'OPEN',
      fiscalYear: '2025-2026',
      reportedById: params.reportedById,
      officeLocationId: params.officeLocationId,
      assignedToId: params.assignedToId ?? null,
    },
    select: { id: true },
  });
}

// ─── Cleanup helpers ──────────────────────────────────────────────────────────
// FK ordering: tickets must be deleted before users and locations.
// User delete cascades: RefreshToken, LocationSupervisor.
// OfficeLocation delete cascades: LocationSupervisor.

export async function cleanupUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const prisma = getTestPrisma();
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

export async function cleanupLocations(locationIds: string[]): Promise<void> {
  if (locationIds.length === 0) return;
  const prisma = getTestPrisma();
  await prisma.officeLocation.deleteMany({ where: { id: { in: locationIds } } });
}

export async function cleanupTickets(ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) return;
  const prisma = getTestPrisma();
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
}
