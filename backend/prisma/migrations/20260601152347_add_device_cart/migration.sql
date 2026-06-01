-- AlterTable
ALTER TABLE "device_assignments" ADD COLUMN     "cartId" TEXT;

-- CreateTable
CREATE TABLE "device_carts" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "assignedToUserId" TEXT,
    "assigneeType" TEXT,
    "locationId" TEXT,
    "dueDate" TIMESTAMP(3),
    "checkoutCondition" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3),
    "committedById" TEXT,
    "fullyReturnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "condition" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_carts_status_idx" ON "device_carts"("status");

-- CreateIndex
CREATE INDEX "device_carts_assignedToUserId_idx" ON "device_carts"("assignedToUserId");

-- CreateIndex
CREATE INDEX "device_carts_locationId_idx" ON "device_carts"("locationId");

-- CreateIndex
CREATE INDEX "device_carts_createdById_idx" ON "device_carts"("createdById");

-- CreateIndex
CREATE INDEX "device_carts_committedAt_idx" ON "device_carts"("committedAt");

-- CreateIndex
CREATE UNIQUE INDEX "device_cart_items_assignmentId_key" ON "device_cart_items"("assignmentId");

-- CreateIndex
CREATE INDEX "device_cart_items_cartId_idx" ON "device_cart_items"("cartId");

-- CreateIndex
CREATE INDEX "device_cart_items_equipmentId_idx" ON "device_cart_items"("equipmentId");

-- CreateIndex
CREATE INDEX "device_cart_items_assignmentId_idx" ON "device_cart_items"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "device_cart_items_cartId_equipmentId_key" ON "device_cart_items"("cartId", "equipmentId");

-- CreateIndex
CREATE INDEX "device_assignments_cartId_idx" ON "device_assignments"("cartId");

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "device_carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_carts" ADD CONSTRAINT "device_carts_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_carts" ADD CONSTRAINT "device_carts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "office_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_carts" ADD CONSTRAINT "device_carts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_carts" ADD CONSTRAINT "device_carts_committedById_fkey" FOREIGN KEY ("committedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_cart_items" ADD CONSTRAINT "device_cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "device_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_cart_items" ADD CONSTRAINT "device_cart_items_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_cart_items" ADD CONSTRAINT "device_cart_items_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "device_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
