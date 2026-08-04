-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "departmentLocationId" TEXT;

-- CreateIndex
CREATE INDEX "tickets_departmentLocationId_idx" ON "tickets"("departmentLocationId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_departmentLocationId_fkey" FOREIGN KEY ("departmentLocationId") REFERENCES "office_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
