-- AlterTable
ALTER TABLE "email_queue" ADD COLUMN     "attachments" JSONB;

-- CreateTable
CREATE TABLE "device_assignments" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assigneeType" TEXT NOT NULL,
    "checkoutBy" TEXT NOT NULL,
    "checkoutAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkoutCondition" TEXT NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "returnCondition" TEXT,
    "returnedBy" TEXT,
    "notes" TEXT,
    "returnNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_incidents" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "userId" TEXT,
    "reportedBy" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "damageType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT,
    "estimatedCost" DECIMAL(10,2),
    "status" TEXT NOT NULL DEFAULT 'reported',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "damage_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_incident_photos" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_incident_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_tickets" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "damageIncidentId" TEXT,
    "vendorId" TEXT,
    "createdBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentForRepairAt" TIMESTAMP(3),
    "expectedReturnDate" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "repairCost" DECIMAL(10,2),
    "trackingNumber" TEXT,
    "repairNotes" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "damageIncidentId" TEXT NOT NULL,
    "userId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "damage_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT,
    "checkNumber" TEXT,
    "notes" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_assignments_equipmentId_idx" ON "device_assignments"("equipmentId");

-- CreateIndex
CREATE INDEX "device_assignments_userId_idx" ON "device_assignments"("userId");

-- CreateIndex
CREATE INDEX "device_assignments_assigneeType_idx" ON "device_assignments"("assigneeType");

-- CreateIndex
CREATE INDEX "device_assignments_checkoutAt_idx" ON "device_assignments"("checkoutAt");

-- CreateIndex
CREATE INDEX "device_assignments_returnedAt_idx" ON "device_assignments"("returnedAt");

-- CreateIndex
CREATE INDEX "device_assignments_equipmentId_returnedAt_idx" ON "device_assignments"("equipmentId", "returnedAt");

-- CreateIndex
CREATE INDEX "damage_incidents_equipmentId_idx" ON "damage_incidents"("equipmentId");

-- CreateIndex
CREATE INDEX "damage_incidents_assignmentId_idx" ON "damage_incidents"("assignmentId");

-- CreateIndex
CREATE INDEX "damage_incidents_userId_idx" ON "damage_incidents"("userId");

-- CreateIndex
CREATE INDEX "damage_incidents_status_idx" ON "damage_incidents"("status");

-- CreateIndex
CREATE INDEX "damage_incidents_reportedAt_idx" ON "damage_incidents"("reportedAt");

-- CreateIndex
CREATE INDEX "damage_incident_photos_incidentId_idx" ON "damage_incident_photos"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "repair_tickets_ticketNumber_key" ON "repair_tickets"("ticketNumber");

-- CreateIndex
CREATE INDEX "repair_tickets_equipmentId_idx" ON "repair_tickets"("equipmentId");

-- CreateIndex
CREATE INDEX "repair_tickets_damageIncidentId_idx" ON "repair_tickets"("damageIncidentId");

-- CreateIndex
CREATE INDEX "repair_tickets_vendorId_idx" ON "repair_tickets"("vendorId");

-- CreateIndex
CREATE INDEX "repair_tickets_status_idx" ON "repair_tickets"("status");

-- CreateIndex
CREATE INDEX "repair_tickets_sentForRepairAt_idx" ON "repair_tickets"("sentForRepairAt");

-- CreateIndex
CREATE UNIQUE INDEX "damage_invoices_invoiceNumber_key" ON "damage_invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "damage_invoices_damageIncidentId_idx" ON "damage_invoices"("damageIncidentId");

-- CreateIndex
CREATE INDEX "damage_invoices_userId_idx" ON "damage_invoices"("userId");

-- CreateIndex
CREATE INDEX "damage_invoices_status_idx" ON "damage_invoices"("status");

-- CreateIndex
CREATE INDEX "damage_invoices_dueDate_idx" ON "damage_invoices"("dueDate");

-- CreateIndex
CREATE INDEX "invoice_payments_invoiceId_idx" ON "invoice_payments"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_payments_paidAt_idx" ON "invoice_payments"("paidAt");

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_checkoutBy_fkey" FOREIGN KEY ("checkoutBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_returnedBy_fkey" FOREIGN KEY ("returnedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_incidents" ADD CONSTRAINT "damage_incidents_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_incidents" ADD CONSTRAINT "damage_incidents_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "device_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_incidents" ADD CONSTRAINT "damage_incidents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_incidents" ADD CONSTRAINT "damage_incidents_reportedBy_fkey" FOREIGN KEY ("reportedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_incidents" ADD CONSTRAINT "damage_incidents_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_incident_photos" ADD CONSTRAINT "damage_incident_photos_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "damage_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_incident_photos" ADD CONSTRAINT "damage_incident_photos_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_damageIncidentId_fkey" FOREIGN KEY ("damageIncidentId") REFERENCES "damage_incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_invoices" ADD CONSTRAINT "damage_invoices_damageIncidentId_fkey" FOREIGN KEY ("damageIncidentId") REFERENCES "damage_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_invoices" ADD CONSTRAINT "damage_invoices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_invoices" ADD CONSTRAINT "damage_invoices_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "damage_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
