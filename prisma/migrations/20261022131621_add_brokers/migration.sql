-- AlterTable
ALTER TABLE "users" ADD COLUMN     "broker_uuid" UUID;

-- CreateTable
CREATE TABLE "brokers" (
    "uuid" UUID NOT NULL,
    "traffic_limit_bytes" BIGINT NOT NULL DEFAULT 0,
    "used_traffic_bytes" BIGINT NOT NULL DEFAULT 0,
    "users_limit" INTEGER,
    "expire_at" TIMESTAMP(3),
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "external_squad_uuid" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brokers_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "broker_internal_squads" (
    "broker_uuid" UUID NOT NULL,
    "internal_squad_uuid" UUID NOT NULL,

    CONSTRAINT "broker_internal_squads_pkey" PRIMARY KEY ("broker_uuid","internal_squad_uuid")
);

-- CreateIndex
CREATE UNIQUE INDEX "brokers_external_squad_uuid_key" ON "brokers"("external_squad_uuid");

-- CreateIndex
CREATE INDEX "users_broker_uuid_idx" ON "users"("broker_uuid");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_broker_uuid_fkey" FOREIGN KEY ("broker_uuid") REFERENCES "brokers"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brokers" ADD CONSTRAINT "brokers_uuid_fkey" FOREIGN KEY ("uuid") REFERENCES "admin"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brokers" ADD CONSTRAINT "brokers_external_squad_uuid_fkey" FOREIGN KEY ("external_squad_uuid") REFERENCES "external_squads"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_internal_squads" ADD CONSTRAINT "broker_internal_squads_broker_uuid_fkey" FOREIGN KEY ("broker_uuid") REFERENCES "brokers"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_internal_squads" ADD CONSTRAINT "broker_internal_squads_internal_squad_uuid_fkey" FOREIGN KEY ("internal_squad_uuid") REFERENCES "internal_squads"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

