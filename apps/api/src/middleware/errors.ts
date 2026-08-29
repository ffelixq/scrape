import type { ErrorRequestHandler, RequestHandler } from 'express';

export const notFound: RequestHandler = (_request, response) => {
  response.status(404).json({ error: 'Route not found' });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next;
  if (error?.name === 'ZodError' && typeof error.flatten === 'function') {
    response.status(400).json({
      error: 'Invalid request',
      details: error.flatten().fieldErrors,
    });
    return;
  }
  const status = typeof error?.status === 'number' ? error.status : 500;
  const message =
    status >= 500 ? 'The server could not process the request.' : String(error.message);
  response.status(status).json({ error: message, requestId: response.locals.requestId });
};
