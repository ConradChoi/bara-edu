import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import type { Mailer } from './mail/mailer.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerErrorHandlers, sendError } from './http/errors.js';
import { keyMatches, registerGuard } from './http/guard.js';

export type AppDeps = { config: Config; pool: pg.Pool; mailer: Mailer };

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
    frameworkErrors: (_err, req, reply) =>
      keyMatches(req.headers['x-bara-service-key'], deps.config.serviceKey)
        ? sendError(reply, 'validation', '요청 형식이 올바르지 않습니다.')
        : sendError(reply, 'unauthorized_service', '서비스 키가 올바르지 않습니다.'),
  });
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
