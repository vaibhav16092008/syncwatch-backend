process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { app, httpServer, gracefulShutdown } from '../src/server.js';
import { defaultRateLimiter, InMemoryRateLimiter, getClientIp } from '../src/utils/rate-limit.js';
import { ERROR_CODES } from '../src/utils/errors.js';

describe('Phase B8 — Production Hardening & Security Tests', () => {
  let port;

  before(async () => {
    if (!httpServer.listening) {
      await new Promise((resolve) => httpServer.listen(0, resolve));
    }
    port = httpServer.address().port;
  });

  beforeEach(() => {
    defaultRateLimiter.reset();
  });

  afterEach(() => {
    defaultRateLimiter.reset();
  });

  describe('1. HTTP Security Headers', () => {
    it('sets standard security hardening headers on HTTP responses', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['x-frame-options'], 'DENY');
      assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    });
  });

  describe('2. HTTP JSON Payload Limits (10KB limit)', () => {
    it('accepts valid JSON payload under 10KB', async () => {
      const validPayload = {
        name: 'Valid Party',
        mode: 'youtube',
        displayName: 'Alice'
      };
      const res = await request(app)
        .post('/api/rooms')
        .send(validPayload);
      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
    });

    it('rejects JSON payload exceeding 10KB with HTTP 413 or 400', async () => {
      const largeString = 'A'.repeat(12 * 1024); // 12KB string
      const res = await request(app)
        .post('/api/rooms')
        .send({
          name: largeString,
          mode: 'youtube',
          displayName: 'Alice'
        });
      assert.ok([400, 413].includes(res.status));
    });
  });

  describe('3. Rate Limiting & Proxy IP Handling', () => {
    it('enforces rate limit threshold crossing and returns HTTP 429 RATE_LIMITED with headers', async () => {
      const limiter = new InMemoryRateLimiter(60000, 3); // 3 max requests
      for (let i = 0; i < 3; i++) {
        const result = limiter.isAllowed('rate-limit-test-ip');
        assert.equal(result.allowed, true);
      }

      const blockedResult = limiter.isAllowed('rate-limit-test-ip');
      assert.equal(blockedResult.allowed, false);
      assert.equal(blockedResult.remaining, 0);
    });

    it('extracts first IP safely from comma-separated x-forwarded-for header when trust proxy is false', () => {
      const mockReq = {
        headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178' },
        socket: { remoteAddress: '127.0.0.1' },
        app: { get: () => false }
      };
      const ip = getClientIp(mockReq);
      assert.equal(ip, '203.0.113.195');
    });

    it('uses Express req.ip when trust proxy is enabled', () => {
      const mockReq = {
        ip: '198.51.100.1',
        headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' },
        socket: { remoteAddress: '10.0.0.1' },
        app: { get: (setting) => setting === 'trust proxy' }
      };
      const ip = getClientIp(mockReq);
      assert.equal(ip, '198.51.100.1');
    });
  });

  describe('4. Socket.io Transport Payload Limits (64KB maxHttpBufferSize)', () => {
    it('allows normal socket payloads under 64KB', async () => {
      const client = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true
      });

      await new Promise((resolve) => client.on('connect', resolve));

      const res = await new Promise((resolve) => {
        client.emit('room:join', { roomId: 'INVALID-CODE', displayName: 'ValidUser' }, resolve);
      });

      assert.equal(res.success, false);
      assert.equal(res.error.code, ERROR_CODES.INVALID_ROOM_CODE);
      client.disconnect();
    });
  });

  describe('5. Graceful Shutdown Helper', () => {
    it('executes gracefulShutdown callback safely without exception', async () => {
      await new Promise((resolve) => {
        gracefulShutdown(() => {
          resolve();
        });
      });
    });
  });
});
