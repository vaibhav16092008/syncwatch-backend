import http from 'node:http';
import express from 'express';
import cors from 'cors';
import config from './config/env.js';
import logger from './utils/logger.js';
import { AppError, ERROR_CODES, createApiResponse, createErrorResponse } from './utils/errors.js';
import { rateLimiterMiddleware } from './utils/rate-limit.js';
import { initSocket } from './socket/index.js';

const app = express();

// Basic Express Middleware
app.use(cors({
  origin: config.CLIENT_URL
}));
app.use(express.json());

// Apply Rate Limiter to API routes
app.use('/api', rateLimiterMiddleware());

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json(createApiResponse({
    status: 'ok',
    service: 'syncwatch-server'
  }));
});

// 404 Route Handler
app.use((req, res, next) => {
  next(new AppError('Route not found', 404, ERROR_CODES.NOT_FOUND));
});

// Centralized Error Handling Middleware
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
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

// Start server if not running in test runner
let serverInstance = null;
if (process.env.NODE_ENV !== 'test') {
  serverInstance = httpServer.listen(config.PORT, () => {
    logger.info(`SyncWatch Backend running on port ${config.PORT} [${config.NODE_ENV}]`);
  });
}

// Graceful Shutdown
export const gracefulShutdown = (done) => {
  logger.info('Received shutdown signal. Closing server cleanly...');
  io.close(() => {
    logger.info('Socket.io connections closed.');
    httpServer.close(() => {
      logger.info('HTTP server closed.');
      if (done) done();
    });
  });
};

process.on('SIGINT', () => gracefulShutdown(() => process.exit(0)));
process.on('SIGTERM', () => gracefulShutdown(() => process.exit(0)));

export { app, httpServer, io, serverInstance };
export default app;
