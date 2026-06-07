-- AlterTable
ALTER TABLE "transportation_settings" ADD COLUMN     "driverLicenseNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "driverLicenseReminderDays" JSONB NOT NULL DEFAULT '[60,30,14,7]';

-- CreateTable
CREATE TABLE "driver_licenses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "licenseNumber" VARCHAR(50),
    "licenseState" VARCHAR(50),
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "documentUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "remindersSent" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_licenses_userId_idx" ON "driver_licenses"("userId");

-- CreateIndex
CREATE INDEX "driver_licenses_expirationDate_idx" ON "driver_licenses"("expirationDate");

-- CreateIndex
CREATE INDEX "driver_licenses_isActive_idx" ON "driver_licenses"("isActive");

-- CreateIndex
CREATE INDEX "driver_licenses_userId_isActive_idx" ON "driver_licenses"("userId", "isActive");

-- CreateIndex
CREATE INDEX "driver_licenses_expirationDate_isActive_idx" ON "driver_licenses"("expirationDate", "isActive");

-- AddForeignKey
ALTER TABLE "driver_licenses" ADD CONSTRAINT "driver_licenses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_licenses" ADD CONSTRAINT "driver_licenses_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
