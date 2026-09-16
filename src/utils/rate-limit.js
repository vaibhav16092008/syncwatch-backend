import config from '../config/env.js';
import { AppError, ERROR_CODES } from './errors.js';

export class InMemoryRateLimiter {
  constructor(windowMs = config.RATE_LIMIT_WINDOW_MS, maxRequests = config.RATE_LIMIT_MAX_REQUESTS) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();
  }

  isAllowed(key) {
    const now = Date.now();
    const record = this.hits.get(key);

    if (!record || now - record.startTime > this.windowMs) {
      this.hits.set(key, { count: 1, startTime: now });
      return { allowed: true, remaining: this.maxRequests - 1, resetMs: this.windowMs };
    }

    if (record.count >= this.maxRequests) {
      const resetMs = this.windowMs - (now - record.startTime);
      return { allowed: false, remaining: 0, resetMs };
    }

    record.count += 1;
    const remaining = this.maxRequests - record.count;
    const resetMs = this.windowMs - (now - record.startTime);
    return { allowed: true, remaining, resetMs };
  }

  reset() {
    this.hits.clear();
  }
}

export const defaultRateLimiter = new InMemoryRateLimiter();

export const rateLimiterMiddleware = (limiter = defaultRateLimiter) => {
  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const result = limiter.isAllowed(key);

    res.setHeader('X-RateLimit-Limit', limiter.maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);

    if (!result.allowed) {
      return next(new AppError('Too many requests, please try again later.', 429, ERROR_CODES.RATE_LIMITED));
    }

    next();
  };
};
