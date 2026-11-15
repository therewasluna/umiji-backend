-- How many IPs may use a user at once, across all nodes. Null = unlimited, so existing users are unchanged.
ALTER TABLE "users" ADD COLUMN "ip_limit" INTEGER;
ALTER TABLE "broker_bot_plans" ADD COLUMN "ip_limit" INTEGER;
