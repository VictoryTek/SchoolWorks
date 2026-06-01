-- Fix checksum mismatch for previously modified migration
UPDATE "_prisma_migrations"
SET checksum = '66178fe8862b29e6f3eae7038d0ffa1ccddb4fb71f0836090c88b09cc82f1bc8'
WHERE migration_name = '20260601172219_add_cart_tag_and_multi_user';
