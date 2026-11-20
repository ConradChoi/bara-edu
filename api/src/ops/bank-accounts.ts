import { z } from 'zod';
import { defineOp } from './registry.js';

export const bankAccountsList = defineOp({
  name: 'bank_accounts.list',
  access: 'user',
  params: z.object({}).strict(),
  async run({ tx }) {
    const r = await tx.query(
      'select id, bank_name, account_number, account_holder, "order" from bank_accounts order by "order", created_at, id',
    );
    return r.rows;
  },
});
