-- Add studentsContribute toggle to FieldTripRequest
-- When true (default): School/Club + Student per-student contribution fields apply.
-- When false: flat costPerStudent field applies instead.
ALTER TABLE "field_trip_requests" ADD COLUMN IF NOT EXISTS "studentsContribute" BOOLEAN NOT NULL DEFAULT true;
