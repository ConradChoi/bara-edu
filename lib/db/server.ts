import 'server-only';
import { cache } from 'react';
import { apiFetch } from './api';
import { RpcBuilder, TableBuilder, type Send } from './query-builder';
import { readSession } from './session-cookie';

export type AuthUser = { id: string; email: string };

export type DbClient = {
  from(table: string): TableBuilder;
  rpc(fn: string, args?: Record<string, unknown>): RpcBuilder;
  auth: { getUser(): Promise<{ data: { user: AuthUser | null }; error: null }> };
};

// keyed by token so a session issued mid-request (sign-in) is looked up fresh
const sessionUser = cache(async (token: string): Promise<AuthUser | null> => {
  const r = await apiFetch<{ user: AuthUser }>('/v1/auth/session', { method: 'GET', session: token });
  return r.ok ? { id: r.data.user.id, email: r.data.user.email } : null;
});

const send: Send = async (path, body) => apiFetch(path, { method: 'POST', body, session: await readSession() });

export async function createClient(): Promise<DbClient> {
  return {
    from: (table) => new TableBuilder(send, table),
    rpc: (fn, args = {}) => new RpcBuilder(send, fn, args),
    auth: {
      async getUser() {
        const token = await readSession();
        return { data: { user: token ? await sessionUser(token) : null }, error: null };
      },
    },
  };
}
