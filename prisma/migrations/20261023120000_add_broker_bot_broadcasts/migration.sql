-- CreateTable
CREATE TABLE "broker_bot_broadcasts" (
    "id" SERIAL NOT NULL,
    "caption" TEXT,
    "has_media" BOOLEAN NOT NULL DEFAULT false,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "broker_bot_broadcasts_pkey" PRIMARY KEY ("id")
);

