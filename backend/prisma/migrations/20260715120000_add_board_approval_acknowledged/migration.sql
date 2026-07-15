-- Add boardApprovalAcknowledged to field_trip_approvals
ALTER TABLE "field_trip_approvals" ADD COLUMN "boardApprovalAcknowledged" BOOLEAN NOT NULL DEFAULT false;
