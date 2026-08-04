-- Device carts are not lending records: a cart is the device's home, not a
-- borrower with a return deadline. Drop the unused due date column.
-- NOTE: this discards any due dates already stored — irreversible.
ALTER TABLE "device_carts" DROP COLUMN "dueDate";
