-- CreateTable
CREATE TABLE "dot_physicians" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "certNumber" VARCHAR(100),
    "nationalRegistryNumber" VARCHAR(100),
    "state" VARCHAR(2),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dot_physicians_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dot_physicians_name_idx" ON "dot_physicians"("name");

-- CreateIndex
CREATE INDEX "dot_physicians_isActive_idx" ON "dot_physicians"("isActive");

-- AddForeignKey
ALTER TABLE "dot_physicians" ADD CONSTRAINT "dot_physicians_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: add nullable physicianId FK to dot_physicals
ALTER TABLE "dot_physicals" ADD COLUMN "physicianId" TEXT;

-- CreateIndex
CREATE INDEX "dot_physicals_physicianId_idx" ON "dot_physicals"("physicianId");

-- AddForeignKey
ALTER TABLE "dot_physicals" ADD CONSTRAINT "dot_physicals_physicianId_fkey" FOREIGN KEY ("physicianId") REFERENCES "dot_physicians"("id") ON DELETE SET NULL ON UPDATE CASCADE;
