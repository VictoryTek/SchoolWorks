-- AlterTable
ALTER TABLE "transportation_settings" ADD COLUMN     "mvrNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mvrReminderDays" JSONB NOT NULL DEFAULT '[60,30,14,7]';

-- CreateTable
CREATE TABLE "mvr_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pullDate" TIMESTAMP(3) NOT NULL,
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "remindersSent" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mvr_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mvr_records_userId_idx" ON "mvr_records"("userId");

-- CreateIndex
CREATE INDEX "mvr_records_expirationDate_idx" ON "mvr_records"("expirationDate");

-- CreateIndex
CREATE INDEX "mvr_records_isActive_idx" ON "mvr_records"("isActive");

-- CreateIndex
CREATE INDEX "mvr_records_userId_isActive_idx" ON "mvr_records"("userId", "isActive");

-- CreateIndex
CREATE INDEX "mvr_records_expirationDate_isActive_idx" ON "mvr_records"("expirationDate", "isActive");

-- AddForeignKey
ALTER TABLE "mvr_records" ADD CONSTRAINT "mvr_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mvr_records" ADD CONSTRAINT "mvr_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
