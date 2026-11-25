import type { FastifyInstance, FastifyReply } from 'fastify';

export type ErrorCode = 'unauthorized_service' | 'unauthenticated' | 'forbidden' | 'validation' | 'rate_limited' | 'not_found' | 'conflict' | 'internal';

const STATUS: Record<ErrorCode, number> = {
  unauthorized_service: 401,
  unauthenticated: 401,
  forbidden: 403,
  validation: 400,
  rate_limited: 429,
  not_found: 404,
  conflict: 409,
  internal: 500,
};

// `field`는 400 validation에서 문제가 된 입력 칸의 이름이다(앱이 칸별 안내에 쓴다). 없으면 응답에 넣지 않는다.
export function sendError(reply: FastifyReply, code: ErrorCode, message: string, field?: string): FastifyReply {
  return reply.code(STATUS[code]).send({ error: field ? { code, message, field } : { code, message } });
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((_req, reply) => sendError(reply, 'not_found', '요청한 경로를 찾을 수 없습니다.'));
  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return sendError(reply, 'validation', '요청 형식이 올바르지 않습니다.');
    req.log.error(err);
    return sendError(reply, 'internal', '서버 오류가 발생했습니다.');
  });
}
