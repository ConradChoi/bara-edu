import { z } from 'zod';
import { defineOp } from './registry.js';

export const profilesGetMine = defineOp({
  name: 'profiles.getMine',
  access: 'user',
  params: z.object({}).strict(),
  async run({ tx }) {
    const r = await tx.query('select id, name, phone, role, status, email from profiles where id = auth.uid()');
    return r.rows[0] ?? null;
  },
});
