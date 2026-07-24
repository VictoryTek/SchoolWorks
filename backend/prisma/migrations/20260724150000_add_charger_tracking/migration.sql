-- CreateTable
CREATE TABLE "chargers" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "isDisposed" BOOLEAN NOT NULL DEFAULT false,
    "disposedDate" TIMESTAMP(3),
    "disposedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chargers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charger_assignments" (
    "id" TEXT NOT NULL,
    "chargerId" TEXT NOT NULL,
    "deviceAssignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assigneeType" TEXT NOT NULL,
    "checkoutBy" TEXT NOT NULL,
    "checkoutAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "returnedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charger_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chargers_serialNumber_key" ON "chargers"("serialNumber");

-- CreateIndex
CREATE INDEX "chargers_status_idx" ON "chargers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "charger_assignments_deviceAssignmentId_key" ON "charger_assignments"("deviceAssignmentId");

-- CreateIndex
CREATE INDEX "charger_assignments_chargerId_idx" ON "charger_assignments"("chargerId");

-- CreateIndex
CREATE INDEX "charger_assignments_userId_idx" ON "charger_assignments"("userId");

-- CreateIndex
CREATE INDEX "charger_assignments_returnedAt_idx" ON "charger_assignments"("returnedAt");

-- AddForeignKey
ALTER TABLE "charger_assignments" ADD CONSTRAINT "charger_assignments_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "chargers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charger_assignments" ADD CONSTRAINT "charger_assignments_deviceAssignmentId_fkey" FOREIGN KEY ("deviceAssignmentId") REFERENCES "device_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charger_assignments" ADD CONSTRAINT "charger_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charger_assignments" ADD CONSTRAINT "charger_assignments_checkoutBy_fkey" FOREIGN KEY ("checkoutBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charger_assignments" ADD CONSTRAINT "charger_assignments_returnedBy_fkey" FOREIGN KEY ("returnedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "damage_incidents" ADD COLUMN "chargerAssignmentId" TEXT;

-- CreateIndex
CREATE INDEX "damage_incidents_chargerAssignmentId_idx" ON "damage_incidents"("chargerAssignmentId");

-- AddForeignKey
ALTER TABLE "damage_incidents" ADD CONSTRAINT "damage_incidents_chargerAssignmentId_fkey" FOREIGN KEY ("chargerAssignmentId") REFERENCES "charger_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
