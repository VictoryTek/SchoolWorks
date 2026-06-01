/*
  Warnings:

  - A unique constraint covering the columns `[tagNumber]` on the table `device_carts` will be added. If there are existing duplicate values, this will fail.

*/

-- Step 1: Create sequence for cart tag numbers
CREATE SEQUENCE IF NOT EXISTS device_cart_tag_seq START 1;

-- Step 2: Add tagNumber column as nullable (must backfill before adding NOT NULL)
ALTER TABLE "device_carts" ADD COLUMN "tagNumber" VARCHAR(20);

-- Step 3: Backfill existing rows with sequential tag numbers
DO $$
DECLARE
  cart_row RECORD;
  seq_val  BIGINT;
BEGIN
  FOR cart_row IN SELECT id FROM device_carts ORDER BY "createdAt" ASC LOOP
    seq_val := nextval('device_cart_tag_seq');
    UPDATE device_carts
    SET "tagNumber" = 'CART-' || lpad(seq_val::text, 3, '0')
    WHERE id = cart_row.id;
  END LOOP;
END $$;

-- Step 4: Add NOT NULL constraint and default
ALTER TABLE "device_carts"
  ALTER COLUMN "tagNumber" SET NOT NULL,
  ALTER COLUMN "tagNumber" SET DEFAULT ('CART-' || lpad(nextval('device_cart_tag_seq')::text, 3, '0'));

-- CreateIndex
CREATE UNIQUE INDEX "device_carts_tagNumber_key" ON "device_carts"("tagNumber");

-- CreateIndex
CREATE INDEX "device_carts_tagNumber_idx" ON "device_carts"("tagNumber");

-- CreateTable: device_cart_users with inline unique constraint
CREATE TABLE "device_cart_users" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_cart_users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "device_cart_users_cartId_userId_key" UNIQUE ("cartId", "userId")
);

-- CreateIndex
CREATE INDEX "device_cart_users_cartId_idx" ON "device_cart_users"("cartId");

-- CreateIndex
CREATE INDEX "device_cart_users_userId_idx" ON "device_cart_users"("userId");

-- AddForeignKey
ALTER TABLE "device_cart_users" ADD CONSTRAINT "device_cart_users_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "device_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_cart_users" ADD CONSTRAINT "device_cart_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: copy existing single-user assignments into the join table
INSERT INTO "device_cart_users" ("id", "cartId", "userId", "role")
SELECT gen_random_uuid()::text, id, "assignedToUserId", 'primary'
FROM "device_carts"
WHERE "assignedToUserId" IS NOT NULL
ON CONFLICT ("cartId", "userId") DO NOTHING;

