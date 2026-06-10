-- AlterTable
ALTER TABLE "users" ADD COLUMN "cachedGroups" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "users" ADD COLUMN "groupsLastSyncedAt" TIMESTAMP(3);
