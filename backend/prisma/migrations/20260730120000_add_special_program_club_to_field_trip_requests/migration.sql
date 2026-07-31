ALTER TABLE "field_trip_requests" ADD COLUMN "isSpecialProgramOrClub" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "field_trip_requests" ADD COLUMN "specialProgramClubName" VARCHAR(200);
