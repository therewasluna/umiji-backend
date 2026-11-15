-- Telegram proxy: a secret the broker chose, and the user's own sponsored channel tag.
-- Both are optional, so existing users keep the secret derived from their UUID.
ALTER TABLE "users" ADD COLUMN "mtproto_secret" VARCHAR(32);
ALTER TABLE "users" ADD COLUMN "mtproto_ad_tag" VARCHAR(32);

-- Unique, because a secret is how a connection is matched to a user, and so whose usage it counts as.
CREATE UNIQUE INDEX "users_mtproto_secret_key" ON "users"("mtproto_secret");
