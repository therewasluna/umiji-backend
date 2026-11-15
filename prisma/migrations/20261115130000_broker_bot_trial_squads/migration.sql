-- The free trial, like plans, now gives a list of squads: {squadUuid} becomes {squadUuids: [squadUuid]}.
UPDATE "broker_bots"
SET "trial" = ("trial" - 'squadUuid') || jsonb_build_object('squadUuids', jsonb_build_array("trial" -> 'squadUuid'))
WHERE "trial" ? 'squadUuid';
