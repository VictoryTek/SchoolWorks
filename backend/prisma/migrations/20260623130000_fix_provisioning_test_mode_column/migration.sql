-- Conditional rename: only runs if test_mode (snake_case) exists.
-- On fresh databases 20260623120000 already creates the column as "testMode",
-- so this migration is a no-op there. On the dev DB where the wrong name
-- was applied first, the rename still runs correctly.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'provisioning_config' AND column_name = 'test_mode'
  ) THEN
    ALTER TABLE "provisioning_config" RENAME COLUMN "test_mode" TO "testMode";
  END IF;
END $$;
