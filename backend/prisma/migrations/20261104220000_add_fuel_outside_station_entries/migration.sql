-- Outside-station fill-ups: a driver can record a fill-up made somewhere other than one of our
-- fuel stations (e.g. on a trip) so the vehicle's mileage chain stays correct. Such an entry has
-- no station, and its gallons are optional.
ALTER TABLE "fuel_consumption_entries"
  ALTER COLUMN "fuelStationId" DROP NOT NULL,
  ALTER COLUMN "fuelAmount" DROP NOT NULL,
  ADD COLUMN "isOutsideStation" BOOLEAN NOT NULL DEFAULT false;

-- The existing foreign key to transportation_fuel_stations stays ON DELETE RESTRICT (the schema
-- sets onDelete: Restrict explicitly), so no foreign-key change is needed.

-- Only an outside-station fill-up may omit the station or the gallons. Every existing row has both.
ALTER TABLE "fuel_consumption_entries"
  ADD CONSTRAINT "fuel_consumption_entries_station_amount_chk"
  CHECK ("isOutsideStation" OR ("fuelStationId" IS NOT NULL AND "fuelAmount" IS NOT NULL));
