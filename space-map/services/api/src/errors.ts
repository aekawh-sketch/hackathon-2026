// Единый формат ошибок API (ТЗ 7.2): { code, message, details? }. message — для человека, по-русски.
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Не найдено') => new ApiError(404, 'not_found', what);
export const forbidden = () => new ApiError(403, 'forbidden', 'Нет доступа');
export const unauthorized = () => new ApiError(401, 'unauthorized', 'Нужно войти');

export function errorHandler(err: FastifyError | ApiError, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ApiError) {
    return reply.status(err.status).send({ code: err.code, message: err.message, details: err.details });
  }
  if (err.validation) {
    return reply.status(400).send({ code: 'validation', message: 'Неверные данные запроса', details: err.validation });
  }
  if (err.statusCode && err.statusCode < 500) {
    return reply.status(err.statusCode).send({ code: err.code ?? 'bad_request', message: err.message });
  }
  req.log.error(err);
  return reply.status(500).send({ code: 'internal', message: 'Ошибка сервера. Попробуйте ещё раз.' });
}
