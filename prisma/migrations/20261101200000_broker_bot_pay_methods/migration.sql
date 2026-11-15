-- AlterTable
ALTER TABLE "broker_bots" ADD COLUMN     "pay_methods" JSONB NOT NULL DEFAULT '[]';
