-- Store every user's derived Telegram secret, so the unique index also stops a broker from typing in
-- another user's. Same formula as deriveMtprotoSecret. A row whose secret is already taken (a typed
-- copy, or users sharing a VLESS UUID) stays null and keeps deriving it, so this can't fail.
WITH derived AS (
    SELECT id, secret, count(*) OVER (PARTITION BY secret) AS uses
    FROM (
        SELECT id,
               left(encode(sha256(convert_to('mtproto:' || vless_uuid::text, 'UTF8')), 'hex'), 32) AS secret
        FROM users
        WHERE mtproto_secret IS NULL
    ) AS candidates
)
UPDATE users
SET mtproto_secret = derived.secret
FROM derived
WHERE users.id = derived.id
  AND derived.uses = 1
  AND NOT EXISTS (SELECT 1 FROM users AS taken WHERE taken.mtproto_secret = derived.secret);

-- Brokers may now set only the subscription headers apps read; drop any other one they saved.
UPDATE external_squads
SET response_headers_add = (
    SELECT coalesce(jsonb_object_agg(name, value), '{}'::jsonb)
    FROM jsonb_each(external_squads.response_headers_add) AS headers(name, value)
    WHERE lower(name) IN ('profile-title', 'profile-web-page-url', 'profile-update-interval',
                          'support-url', 'routing', 'announce')
)
WHERE uuid IN (SELECT external_squad_uuid FROM brokers WHERE external_squad_uuid IS NOT NULL);
