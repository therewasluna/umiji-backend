-- AlterTable
ALTER TABLE "broker_bots" ADD COLUMN     "referral_percent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trial" JSONB,
ADD COLUMN     "trial_reset_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "summary_posted_on" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "broker_bot_customers" ADD COLUMN     "referred_by_id" INTEGER;

-- CreateIndex
CREATE INDEX "broker_bot_customers_referred_by_id_idx" ON "broker_bot_customers"("referred_by_id");

-- AddForeignKey
ALTER TABLE "broker_bot_customers" ADD CONSTRAINT "broker_bot_customers_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "broker_bot_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
