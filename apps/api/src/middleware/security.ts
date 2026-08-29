import cors from 'cors';
import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { appConfig } from '../config.js';

const requestId: RequestHandler = (request, response, next) => {
  const id = request.header('x-request-id')?.slice(0, 128) || randomUUID();
  response.setHeader('x-request-id', id);
  response.locals.requestId = id;
  next();
};

export function installSecurityMiddleware(app: Express) {
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || appConfig.corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Origin is not allowed'));
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: appConfig.nodeEnv === 'test' ? 10_000 : 40,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please wait before starting another investigation.' },
    }),
  );
}
