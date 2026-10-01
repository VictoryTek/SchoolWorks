-- Adds fundraiser tracking to field trip requests: whether one is needed to
-- meet funding obligations, and a list of { name, projectedRevenue } entries
-- recorded for the Bookkeeper's reference (informational — does not affect
-- the Total Cost calculation).
ALTER TABLE "field_trip_requests" ADD COLUMN IF NOT EXISTS "fundraiserNeeded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "field_trip_requests" ADD COLUMN IF NOT EXISTS "fundraisers" JSONB;
