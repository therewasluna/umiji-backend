-- AlterTable
ALTER TABLE "broker_bot_orders" ADD COLUMN     "checkout_key" TEXT;

-- CreateIndex
CREATE INDEX "broker_bot_orders_user_id_idx" ON "broker_bot_orders"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "broker_bot_orders_customer_id_checkout_key_key" ON "broker_bot_orders"("customer_id", "checkout_key");

