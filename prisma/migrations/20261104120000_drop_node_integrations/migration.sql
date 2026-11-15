-- Node integrations were removed: the node agent never shipped an integration that read them.
ALTER TABLE "nodes" DROP COLUMN "integration_uuids";

DROP TABLE "integrations";
