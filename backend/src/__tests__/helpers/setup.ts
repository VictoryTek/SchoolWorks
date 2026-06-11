import { beforeAll, afterAll } from 'vitest';
import { getTestPrisma } from './db';

// Guard: abort before any test runs if we are not pointed at the test database.
// Prevents accidental writes to the dev or production database.
beforeAll(() => {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('tech_v2_test') && !url.includes('test')) {
    throw new Error(
      `DATABASE_URL "${url}" does not look like a test database URL. ` +
        'Refusing to run tests against a non-test database.',
    );
  }
});

// Disconnect the shared Prisma client after all test suites complete.
afterAll(async () => {
  const prisma = getTestPrisma();
  await prisma.$disconnect();
});
