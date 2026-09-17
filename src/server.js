import http from 'node:http';
import express from 'express';
import cors from 'cors';
import config from './config/env.js';
import logger from './utils/logger.js';
import { AppError, ERROR_CODES, createApiResponse, createErrorResponse } from './utils/errors.js';
import { rateLimiterMiddleware } from './utils/rate-limit.js';
import { initSocket } from './socket/index.js';
import roomRoutes from './routes/room.routes.js';
import mediaRoutes from './routes/media.routes.js';

const app = express();

if (config.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Lightweight HTTP Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Basic Express Middleware
app.use(cors({
  origin: config.CLIENT_URL
}));
app.use(express.json({ limit: '10kb' }));

// Apply Rate Limiter to API routes
app.use('/api', rateLimiterMiddleware());

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json(createApiResponse({
    status: 'ok',
    service: 'syncwatch-server'
  }));
});

// Room & Media REST Routes
app.use('/api/rooms', roomRoutes);
app.use('/api/rooms', mediaRoutes);

// 404 Route Handler
app.use((req, res, next) => {
  next(new AppError('Route not found', 404, ERROR_CODES.NOT_FOUND));
});

// Centralized Error Handling Middleware
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const errorCode = err.code || ERROR_CODES.INTERNAL_ERROR;
  const message = (statusCode === 500 && config.NODE_ENV === 'production')
    ? 'Internal server error'
    : (err.message || 'Internal server error');

  if (statusCode === 500) {
    logger.error('Unhandled server error', { error: err.message, stack: err.stack });
  } else {
    logger.warn('Client request error', { statusCode, errorCode, message: err.message });
  }

  res.status(statusCode).json(createErrorResponse(errorCode, message, err.details || null));
});

// Create HTTP Server & Attach Socket.io
const httpServer = http.createServer(app);
const io = initSocket(httpServer);

// Start server if not running in test mode
const isTestMode = config.NODE_ENV === 'test' ||
  process.env.NODE_ENV === 'test' ||
  process.env.SYNCWATCH_TEST_MODE === 'true' ||
  process.execArgv.includes('--test') ||
  process.argv.some((arg) => typeof arg === 'string' && (arg.includes('--test') || arg.includes('test')));

let serverInstance = null;
if (!isTestMode) {
  serverInstance = httpServer.listen(config.PORT, () => {
    logger.info(`SyncWatch Backend running on port ${config.PORT} [${config.NODE_ENV}]`);
  });
}

// Graceful Shutdown
export const gracefulShutdown = (done = () => {}) => {
  logger.info('Received shutdown signal. Closing server cleanly...');
  try {
    io.close(() => {
      logger.info('Socket.io connections closed.');
      if (httpServer.listening) {
        httpServer.close(() => {
          logger.info('HTTP server closed.');
          if (typeof done === 'function') done();
        });
      } else {
        if (typeof done === 'function') done();
      }
    });
  } catch (err) {
    logger.error('Error during shutdown', { error: err.message });
    if (typeof done === 'function') done(err);
  }
};

process.on('SIGINT', () => gracefulShutdown(() => process.exit(0)));
process.on('SIGTERM', () => gracefulShutdown(() => process.exit(0)));

export { app, httpServer, io, serverInstance };
export default app;
