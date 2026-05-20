-- AlterTable
ALTER TABLE "device_assignments" ADD COLUMN "locationId" TEXT;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "office_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "device_assignments_locationId_idx" ON "device_assignments"("locationId");
