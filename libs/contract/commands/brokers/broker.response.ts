import { z } from 'zod';

import { BrokerSchema } from '../../models';

export const BrokerResponseSchema = z.object({
    response: BrokerSchema,
});
