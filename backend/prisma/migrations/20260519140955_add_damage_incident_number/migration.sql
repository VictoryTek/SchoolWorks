/*
  Warnings:

  - A unique constraint covering the columns `[incidentNumber]` on the table `damage_incidents` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "damage_incidents" ADD COLUMN     "incidentNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "damage_incidents_incidentNumber_key" ON "damage_incidents"("incidentNumber");

-- CreateIndex
CREATE INDEX "damage_incidents_incidentNumber_idx" ON "damage_incidents"("incidentNumber");
