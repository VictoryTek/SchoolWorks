-- Bookkeeper approval now requires confirming funding obligations are met and
-- recording the account number funds will be drawn from; that account number
-- carries forward on the request so the Finance Director can see and confirm
-- it (their own new acknowledgment checkbox) when the trip reaches their stage.
ALTER TABLE "field_trip_requests" ADD COLUMN IF NOT EXISTS "bookkeeperAccountNumber" VARCHAR(200);
ALTER TABLE "field_trip_approvals" ADD COLUMN IF NOT EXISTS "fundingObligationsAcknowledged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "field_trip_approvals" ADD COLUMN IF NOT EXISTS "adequateFundingAcknowledged" BOOLEAN NOT NULL DEFAULT false;
