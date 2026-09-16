process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { z } from 'zod';
import { app, httpServer } from '../src/server.js';
import config from '../src/config/env.js';
import { AppError, ERROR_CODES, createApiResponse, createErrorResponse } from '../src/utils/errors.js';
import { InMemoryRateLimiter } from '../src/utils/rate-limit.js';
import { RoomStorage } from '../src/storage/room.storage.js';

describe('Phase B1 — SyncWatch Backend Foundation Tests', () => {
  let port;

  before(async () => {
    if (!httpServer.listening) {
      await new Promise((resolve) => httpServer.listen(0, resolve));
    }
    port = httpServer.address().port;
  });

  after(async () => {
    // Keep server active for subsequent test files sharing singleton httpServer
  });

  describe('1. Environment Configuration', () => {
    it('should load default environment configuration correctly', () => {
      assert.equal(typeof config.PORT, 'number');
      assert.equal(typeof config.CLIENT_URL, 'string');
      assert.equal(typeof config.RATE_LIMIT_WINDOW_MS, 'number');
      assert.equal(typeof config.RATE_LIMIT_MAX_REQUESTS, 'number');
    });
  });

  describe('2. HTTP Endpoints & Response Formatting', () => {
    it('GET /api/health returns 200 OK with standard response schema', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.status, 'ok');
      assert.equal(res.body.data.service, 'syncwatch-server');
    });

    it('GET /api/unknown-route returns 404 NOT_FOUND', async () => {
      const res = await request(app).get('/api/unknown-route');
      assert.equal(res.status, 404);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, ERROR_CODES.NOT_FOUND);
      assert.equal(res.body.error.message, 'Route not found');
    });
  });

  describe('3. Centralized Error System', () => {
    it('AppError produces expected properties', () => {
      const err = new AppError('Unauthorized access', 401, ERROR_CODES.UNAUTHORIZED);
      assert.equal(err.message, 'Unauthorized access');
      assert.equal(err.statusCode, 401);
      assert.equal(err.code, ERROR_CODES.UNAUTHORIZED);
    });

    it('createApiResponse and createErrorResponse format correctly', () => {
      const ok = createApiResponse({ foo: 'bar' });
      assert.deepEqual(ok, { success: true, data: { foo: 'bar' } });

      const err = createErrorResponse(ERROR_CODES.VALIDATION_ERROR, 'Invalid input', { field: 'name' });
      assert.deepEqual(err, {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid input',
          details: { field: 'name' }
        }
      });
    });
  });

  describe('4. Zod Validation Foundation', () => {
    const testSchema = z.object({
      username: z.string().min(3),
      age: z.number().positive()
    });

    it('validates valid input correctly', () => {
      const valid = { username: 'Alice', age: 25 };
      const parsed = testSchema.safeParse(valid);
      assert.equal(parsed.success, true);
      assert.deepEqual(parsed.data, valid);
    });

    it('catches invalid input correctly', () => {
      const invalid = { username: 'Al', age: -5 };
      const parsed = testSchema.safeParse(invalid);
      assert.equal(parsed.success, false);
      assert.ok(parsed.error.issues.length > 0);
    });
  });

  describe('5. Rate Limiting Foundation', () => {
    it('allows requests under the rate limit', () => {
      const limiter = new InMemoryRateLimiter(60000, 2);
      const res1 = limiter.isAllowed('test-ip');
      const res2 = limiter.isAllowed('test-ip');
      assert.equal(res1.allowed, true);
      assert.equal(res2.allowed, true);
    });

    it('blocks requests exceeding the rate limit', () => {
      const limiter = new InMemoryRateLimiter(60000, 2);
      limiter.isAllowed('test-ip');
      limiter.isAllowed('test-ip');
      const res3 = limiter.isAllowed('test-ip');
      assert.equal(res3.allowed, false);
      assert.equal(res3.remaining, 0);
    });
  });

  describe('6. In-Memory Room Storage Abstraction', () => {
    it('creates, retrieves, updates, and deletes rooms correctly', () => {
      const storage = new RoomStorage();
      
      // Create
      const created = storage.createRoom('room-101', { hostId: 'user-1' });
      assert.equal(created.id, 'room-101');
      assert.equal(created.hostId, 'user-1');
      assert.equal(storage.hasRoom('room-101'), true);

      // Get
      const retrieved = storage.getRoom('room-101');
      assert.equal(retrieved.hostId, 'user-1');

      // Update
      const updated = storage.updateRoom('room-101', { title: 'Movie Night' });
      assert.equal(updated.title, 'Movie Night');

      // Delete
      const deleted = storage.deleteRoom('room-101');
      assert.equal(deleted, true);
      assert.equal(storage.hasRoom('room-101'), false);
    });
  });

  describe('7. Socket.io Foundation', () => {
    it('allows client to connect and disconnect cleanly', async () => {
      const clientSocket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true
      });

      await new Promise((resolve) => {
        clientSocket.on('connect', () => {
          assert.ok(clientSocket.id);
          clientSocket.disconnect();
          resolve();
        });
      });
    });
  });
});
