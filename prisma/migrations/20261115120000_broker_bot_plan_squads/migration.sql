ALTER TABLE "broker_bot_plans"
ADD COLUMN "squad_uuids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

UPDATE "broker_bot_plans" SET "squad_uuids" = ARRAY["squad_uuid"] WHERE "squad_uuid" IS NOT NULL;

ALTER TABLE "broker_bot_plans" DROP CONSTRAINT "broker_bot_plans_squad_uuid_fkey";
ALTER TABLE "broker_bot_plans" DROP COLUMN "squad_uuid";
