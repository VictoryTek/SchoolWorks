-- Adds the School/Club + Student cost contribution breakdown to field trip
-- requests (Total Cost = sum of the two) and the bus driver payment source
-- to the transportation sub-request. The new Bookkeeper approval stage needs
-- no schema change — status stays a plain free-text column.
ALTER TABLE "field_trip_requests" ADD COLUMN IF NOT EXISTS "schoolGroupClubContribution" DECIMAL(10,2);
ALTER TABLE "field_trip_requests" ADD COLUMN IF NOT EXISTS "studentContribution" DECIMAL(10,2);
ALTER TABLE "field_trip_transportation_requests" ADD COLUMN IF NOT EXISTS "driverPaymentSource" VARCHAR(20);
