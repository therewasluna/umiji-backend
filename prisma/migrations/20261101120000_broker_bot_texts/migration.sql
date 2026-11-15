-- AlterTable
ALTER TABLE "broker_bots" ADD COLUMN     "langs" TEXT[] DEFAULT ARRAY['en']::TEXT[],
ADD COLUMN     "texts" JSONB NOT NULL DEFAULT '{}';

-- Each bot keeps speaking its one language.
UPDATE "broker_bots" SET "langs" = ARRAY["lang"]::TEXT[];

-- The custom greeting was plain text; texts are Telegram HTML, so escape it.
UPDATE "broker_bots"
SET "texts" = jsonb_build_object(
    "lang",
    jsonb_build_object(
        'greeting',
        replace(replace(replace(btrim("greeting"), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
    )
)
WHERE "greeting" IS NOT NULL AND btrim("greeting") <> '';

ALTER TABLE "broker_bots" DROP COLUMN "greeting";

-- AlterTable
ALTER TABLE "broker_bot_customers" ADD COLUMN     "lang" TEXT;
