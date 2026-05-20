-- CreateTable
CREATE TABLE "damage_component_prices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "description" TEXT,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "damage_component_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "componentPriceId" TEXT,
    "description" TEXT NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "lineTotal" DECIMAL(10,2) NOT NULL,
    "isReplacement" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "damage_component_prices_isActive_idx" ON "damage_component_prices"("isActive");

-- CreateIndex
CREATE INDEX "damage_invoice_line_items_invoiceId_idx" ON "damage_invoice_line_items"("invoiceId");

-- AddForeignKey
ALTER TABLE "damage_invoice_line_items" ADD CONSTRAINT "damage_invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "damage_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_invoice_line_items" ADD CONSTRAINT "damage_invoice_line_items_componentPriceId_fkey" FOREIGN KEY ("componentPriceId") REFERENCES "damage_component_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
