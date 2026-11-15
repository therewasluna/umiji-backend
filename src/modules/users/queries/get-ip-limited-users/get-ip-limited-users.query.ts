import { Query } from '@nestjs/cqrs';

import { TResult } from '@common/types';

export class GetIpLimitedUsersQuery extends Query<TResult<{ id: bigint; ipLimit: number }[]>> {}
