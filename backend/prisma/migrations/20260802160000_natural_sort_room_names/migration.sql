CREATE COLLATION IF NOT EXISTS "natural_sort" (provider = icu, locale = 'en-u-kn-true', deterministic = true);

ALTER TABLE "rooms" ALTER COLUMN "name" TYPE text COLLATE "natural_sort";
