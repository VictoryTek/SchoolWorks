-- Adds damageType/severity to repair_tickets so a ticket with no linked
-- damage incident (device-only, created from the inventory drawer) is still
-- self-describing. Nullable — routine repairs and existing rows have neither.
ALTER TABLE "repair_tickets" ADD COLUMN IF NOT EXISTS "damageType" TEXT;
ALTER TABLE "repair_tickets" ADD COLUMN IF NOT EXISTS "severity" TEXT;
