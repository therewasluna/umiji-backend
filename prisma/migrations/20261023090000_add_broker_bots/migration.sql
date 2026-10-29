-- CreateTable
CREATE TABLE "broker_bots" (
    "broker_uuid" UUID NOT NULL,
    "bot_token" TEXT,
    "bot_username" TEXT,
    "group_id" TEXT,
    "review_topic_id" INTEGER,
    "logs_topic_id" INTEGER,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "greeting" TEXT,
    "channel_url" TEXT,
    "cards" JSONB NOT NULL DEFAULT '[]',
    "wallets" JSONB NOT NULL DEFAULT '[]',
    "required_channels" JSONB NOT NULL DEFAULT '[]',
    "group_finds" JSONB NOT NULL DEFAULT '[]',
    "pending_rejects" JSONB NOT NULL DEFAULT '{}',
    "update_offset" INTEGER NOT NULL DEFAULT 0,
    "stats_reset_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_bots_pkey" PRIMARY KEY ("broker_uuid")
);

-- CreateTable
CREATE TABLE "broker_bot_plan_categories" (
    "id" SERIAL NOT NULL,
    "broker_uuid" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_bot_plan_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_bot_plans" (
    "id" SERIAL NOT NULL,
    "broker_uuid" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "traffic_gb" DOUBLE PRECISION NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "squad_uuid" UUID,
    "category_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_bot_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_bot_customers" (
    "id" SERIAL NOT NULL,
    "broker_uuid" UUID NOT NULL,
    "tg_user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "name" TEXT,
    "username" TEXT,
    "state" TEXT NOT NULL DEFAULT 'none',
    "state_amount" INTEGER,
    "wallet" BIGINT NOT NULL DEFAULT 0,
    "ticket_topic_id" INTEGER,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_bot_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_bot_orders" (
    "id" SERIAL NOT NULL,
    "broker_uuid" UUID NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "plan_id" INTEGER,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "receipt_kind" TEXT,
    "receipt_file_id" TEXT,
    "receipt_text" TEXT,
    "review_message_id" INTEGER,
    "reject_reason" TEXT,
    "user_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "broker_bot_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broker_bot_plan_categories_broker_uuid_idx" ON "broker_bot_plan_categories"("broker_uuid");

-- CreateIndex
CREATE INDEX "broker_bot_plans_broker_uuid_idx" ON "broker_bot_plans"("broker_uuid");

-- CreateIndex
CREATE INDEX "broker_bot_customers_broker_uuid_ticket_topic_id_idx" ON "broker_bot_customers"("broker_uuid", "ticket_topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "broker_bot_customers_broker_uuid_tg_user_id_key" ON "broker_bot_customers"("broker_uuid", "tg_user_id");

-- CreateIndex
CREATE INDEX "broker_bot_orders_broker_uuid_created_at_idx" ON "broker_bot_orders"("broker_uuid", "created_at");

-- CreateIndex
CREATE INDEX "broker_bot_orders_customer_id_idx" ON "broker_bot_orders"("customer_id");

-- AddForeignKey
ALTER TABLE "broker_bots" ADD CONSTRAINT "broker_bots_broker_uuid_fkey" FOREIGN KEY ("broker_uuid") REFERENCES "brokers"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_bot_plan_categories" ADD CONSTRAINT "broker_bot_plan_categories_broker_uuid_fkey" FOREIGN KEY ("broker_uuid") REFERENCES "brokers"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_bot_plans" ADD CONSTRAINT "broker_bot_plans_broker_uuid_fkey" FOREIGN KEY ("broker_uuid") REFERENCES "brokers"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_bot_plans" ADD CONSTRAINT "broker_bot_plans_squad_uuid_fkey" FOREIGN KEY ("squad_uuid") REFERENCES "internal_squads"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_bot_plans" ADD CONSTRAINT "broker_bot_plans_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "broker_bot_plan_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_bot_customers" ADD CONSTRAINT "broker_bot_customers_broker_uuid_fkey" FOREIGN KEY ("broker_uuid") REFERENCES "brokers"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_bot_orders" ADD CONSTRAINT "broker_bot_orders_broker_uuid_fkey" FOREIGN KEY ("broker_uuid") REFERENCES "brokers"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_bot_orders" ADD CONSTRAINT "broker_bot_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "broker_bot_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_bot_orders" ADD CONSTRAINT "broker_bot_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "broker_bot_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_bot_orders" ADD CONSTRAINT "broker_bot_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

