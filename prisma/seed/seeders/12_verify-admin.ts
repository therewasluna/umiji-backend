import { PrismaClient } from '@prisma/client';
import consola from 'consola';

export async function verifyAdminUser(prisma: PrismaClient) {
    // Brokers share the admin table; only extra superadmins are a sign of tampering.
    const where = { role: 'ADMIN' };

    const adminsCount = await prisma.admin.count({ where });
    if (adminsCount === 0 || adminsCount === 1) {
        // first start
        return;
    } else {
        consola.warn(
            'Seems like there was direct database modification. Retaining oldest admin and removing all others...',
        );

        const oldestAdmin = await prisma.admin.findFirst({
            where,
            orderBy: { createdAt: 'asc' },
        });

        if (oldestAdmin) {
            await prisma.admin.deleteMany({
                where: {
                    ...where,
                    uuid: {
                        not: oldestAdmin.uuid,
                    },
                },
            });
            consola.success(
                `Retained oldest admin: ${oldestAdmin.username} and removed all others`,
            );
        }

        return;
    }
}
