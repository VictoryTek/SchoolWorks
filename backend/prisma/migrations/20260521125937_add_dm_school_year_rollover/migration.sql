-- AlterTable
ALTER TABLE "damage_incidents" ADD COLUMN     "schoolYear" TEXT;

-- AlterTable
ALTER TABLE "damage_invoices" ADD COLUMN     "schoolYear" TEXT;

-- AlterTable
ALTER TABLE "repair_tickets" ADD COLUMN     "schoolYear" TEXT;

-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "currentSchoolYear" TEXT,
ADD COLUMN     "lastDmRolloverAt" TIMESTAMP(3),
ADD COLUMN     "lastDmRolloverBy" TEXT;

-- CreateTable
CREATE TABLE "dm_year_rollover_history" (
    "id" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "newSchoolYear" TEXT NOT NULL,
    "schoolYearStart" TIMESTAMP(3) NOT NULL,
    "schoolYearEnd" TIMESTAMP(3) NOT NULL,
    "incidentsStamped" INTEGER NOT NULL DEFAULT 0,
    "ticketsStamped" INTEGER NOT NULL DEFAULT 0,
    "invoicesStamped" INTEGER NOT NULL DEFAULT 0,
    "performedById" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_year_rollover_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dm_year_rollover_history_newSchoolYear_key" ON "dm_year_rollover_history"("newSchoolYear");

-- CreateIndex
CREATE INDEX "dm_year_rollover_history_schoolYear_idx" ON "dm_year_rollover_history"("schoolYear");

-- CreateIndex
CREATE INDEX "damage_incidents_schoolYear_idx" ON "damage_incidents"("schoolYear");

-- CreateIndex
CREATE INDEX "damage_invoices_schoolYear_idx" ON "damage_invoices"("schoolYear");

-- CreateIndex
CREATE INDEX "repair_tickets_schoolYear_idx" ON "repair_tickets"("schoolYear");

-- AddForeignKey
ALTER TABLE "dm_year_rollover_history" ADD CONSTRAINT "dm_year_rollover_history_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
