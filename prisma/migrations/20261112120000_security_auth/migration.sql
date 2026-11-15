CREATE UNIQUE INDEX "admin_single_owner"
ON "admin" ("role")
WHERE "role" = 'ADMIN';

ALTER TABLE "brokers"
ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
