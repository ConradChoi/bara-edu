import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import type { Mailer } from './mail/mailer.js';
import type { Storage } from './storage/storage.js';
import { registerStorageRoutes } from './storage/routes.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerErrorHandlers, sendError } from './http/errors.js';
import { keyMatches, registerGuard } from './http/guard.js';
import { loggerOptions, type LogOptions } from './http/logging.js';
import { bankAccountsList } from './ops/bank-accounts.js';
import { enrollmentsApply } from './ops/enrollments.js';
import { enrollmentsApprove } from './ops/enrollments-approve.js';
import { profilesGetMine } from './ops/profiles.js';
import { registerOps, type Op } from './ops/registry.js';
import { registerOpRoutes } from './ops/routes.js';
import { lazyCatalog } from './query/catalog.js';
import { registerQueryRoutes } from './query/routes.js';
import { lazyRpcCatalog, registerRpcRoutes } from './query/rpc.js';
import type { HttpsOptions } from './tls.js';

export type AppDeps = { config: Config; pool: pg.Pool; mailer: Mailer; storage: Storage; logger?: LogOptions; https?: HttpsOptions };

export function buildApp(deps: AppDeps, extraOps: Op[] = []): FastifyInstance {
  // with `https` the instance serves TLS only; the route/hook API is the same, so it is typed as the plain instance
  const app = Fastify({
    ...(deps.https ? { https: deps.https } : {}),
    logger: loggerOptions(deps.logger),
    bodyLimit: 1_048_576,
    frameworkErrors: (_err, req, reply) =>
      keyMatches(req.headers['x-bara-service-key'], deps.config.serviceKey)
        ? sendError(reply, 'validation', '요청 형식이 올바르지 않습니다.')
        : sendError(reply, 'unauthorized_service', '서비스 키가 올바르지 않습니다.'),
  }) as unknown as FastifyInstance;
  app.decorate('deps', deps);
  registerErrorHandlers(app);
  registerGuard(app);
  app.get('/healthz', async () => ({ ok: true }));
  registerAuthRoutes(app);
  registerOpRoutes(app, registerOps([profilesGetMine, bankAccountsList, enrollmentsApply, enrollmentsApprove, ...extraOps]));
  registerStorageRoutes(app);
  registerQueryRoutes(app, lazyCatalog(deps.pool));
  registerRpcRoutes(app, lazyRpcCatalog(deps.pool));
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
