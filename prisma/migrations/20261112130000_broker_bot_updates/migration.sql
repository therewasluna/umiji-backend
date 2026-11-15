CREATE TABLE "broker_bot_updates" (
    "broker_uuid" UUID NOT NULL,
    "update_id" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ,
    "processed_at" TIMESTAMPTZ,
    CONSTRAINT "broker_bot_updates_pkey" PRIMARY KEY ("broker_uuid", "update_id"),
    CONSTRAINT "broker_bot_updates_broker_uuid_fkey"
        FOREIGN KEY ("broker_uuid") REFERENCES "broker_bots"("broker_uuid")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "broker_bot_updates_broker_uuid_status_update_id_idx"
ON "broker_bot_updates"("broker_uuid", "status", "update_id");

ALTER TABLE "broker_bot_orders"
ADD COLUMN "telegram_update_id" BIGINT;

CREATE UNIQUE INDEX "broker_bot_orders_broker_uuid_telegram_update_id_key"
ON "broker_bot_orders"("broker_uuid", "telegram_update_id");
