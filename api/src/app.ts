import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerErrorHandlers } from './http/errors.js';
import { registerGuard } from './http/guard.js';

export type AppDeps = { config: Config; pool: pg.Pool; mailer: unknown };

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  app.decorate('deps', deps);
  registerErrorHandlers(app);
  registerGuard(app);
  app.get('/healthz', async () => ({ ok: true }));
  registerAuthRoutes(app);
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
