import { Prisma } from '@prisma/client';

export class BulkIncrementBrokerUsedTrafficBuilder {
    public query: Prisma.Sql;

    constructor(list: { u: string; b: string }[]) {
        this.query = this.getQuery(list);
        return this;
    }

    public getQuery(list: { u: string; b: string }[]): Prisma.Sql {
        const values = Prisma.join(list.map((h) => Prisma.sql`(${h.b}::bigint, ${h.u}::bigint)`));

        // Brokers are locked in uuid order so concurrent usage batches can't deadlock.
        return Prisma.sql`
        WITH data("inc_used","id") AS (
          VALUES ${values}
        ),
        increments AS (
          SELECT u."broker_uuid" AS "uuid", SUM(d."inc_used") AS "inc_used"
          FROM data d
          JOIN "users" u ON u."id" = d."id"
          WHERE u."broker_uuid" IS NOT NULL
          GROUP BY u."broker_uuid"
        ),
        locked AS (
          SELECT b."uuid"
          FROM "brokers" b
          JOIN increments i ON i."uuid" = b."uuid"
          ORDER BY b."uuid"
          FOR UPDATE OF b
        )
        UPDATE "brokers" AS b
        SET "used_traffic_bytes" = b."used_traffic_bytes" + i."inc_used"
        FROM increments i
        JOIN locked l ON l."uuid" = i."uuid"
        WHERE b."uuid" = i."uuid"
        `;
    }
}
