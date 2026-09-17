process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { app, httpServer, io } from '../src/server.js';
import roomStorage from '../src/storage/room.storage.js';
import roomService from '../src/services/room.service.js';
import reconnectionService from '../src/services/reconnection.service.js';
import { ERROR_CODES } from '../src/utils/errors.js';

describe('Phase B7 — Reconnection & Cleanup Tests', () => {
  let port;

  before(async () => {
    if (!httpServer.listening) {
      await new Promise((resolve) => httpServer.listen(0, resolve));
    }
    port = httpServer.address().port;
  });

  after(() => {
    reconnectionService.resetGracePeriodMs();
  });

  beforeEach(() => {
    roomStorage.clear();
    reconnectionService.clear();
    reconnectionService.resetGracePeriodMs();
  });

  const createClient = () => {
    return ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });
  };

  describe('1. Reconnection Token Generation & Basic Reconnection', () => {
    it('generates a reconnectToken on room:join and restores logical user state on room:reconnect', async () => {
      const { room } = roomService.createRoom({ name: 'Reconnect Room', mode: 'youtube', displayName: 'Host' });

      const client1 = createClient();
      await new Promise((resolve) => client1.on('connect', resolve));

      const joinRes = await new Promise((resolve) => {
        client1.emit('room:join', { roomId: room.id, displayName: 'Alice' }, resolve);
      });

      assert.strictEqual(joinRes.success, true);
      const { user } = joinRes.data;
      assert.ok(user.reconnectToken);
      assert.strictEqual(user.displayName, 'Alice');

      // Disconnect socket unexpectedly
      client1.disconnect();
      await new Promise((r) => setTimeout(r, 50));

      // User state should be disconnected in roomStorage during grace period
      const roomStateMid = roomStorage.getRoom(room.id);
      const disconnectedUser = roomStateMid.users.find((u) => u.userId === user.userId);
      assert.ok(disconnectedUser);
      assert.strictEqual(disconnectedUser.connected, false);

      // Reconnect with new socket
      const client2 = createClient();
      await new Promise((resolve) => client2.on('connect', resolve));

      const mediaPromise = new Promise((resolve) => client2.on('media:state', resolve));
      const chatPromise = new Promise((resolve) => client2.on('chat:history', resolve));

      const reconnectRes = await new Promise((resolve) => {
        client2.emit('room:reconnect', {
          roomId: room.id,
          userId: user.userId,
          reconnectToken: user.reconnectToken
        }, resolve);
      });

      assert.strictEqual(reconnectRes.success, true);
      assert.strictEqual(reconnectRes.data.user.userId, user.userId);
      assert.strictEqual(reconnectRes.data.user.displayName, 'Alice');
      assert.strictEqual(reconnectRes.data.user.reconnectToken, user.reconnectToken);
      assert.strictEqual(reconnectRes.data.user.connected, true);

      const mediaState = await mediaPromise;
      assert.ok(mediaState);

      const chatHistory = await chatPromise;
      assert.ok(Array.isArray(chatHistory.messages));

      client2.disconnect();
    });
  });

  describe('2. Grace Expiration & Session Expiry', () => {
    it('permanently removes user and invalidates session when grace period expires', async () => {
      reconnectionService.setGracePeriodMs(100);

      const { room } = roomService.createRoom({ name: 'Expiry Room', mode: 'youtube', displayName: 'Host' });

      const client1 = createClient();
      await new Promise((resolve) => client1.on('connect', resolve));

      const joinRes = await new Promise((resolve) => {
        client1.emit('room:join', { roomId: room.id, displayName: 'Bob' }, resolve);
      });

      const { user } = joinRes.data;

      // Disconnect socket
      client1.disconnect();

      // Wait for grace period to expire
      await new Promise((r) => setTimeout(r, 200));

      // User should now be permanently removed from room
      const roomStateAfter = roomStorage.getRoom(room.id);
      assert.strictEqual(roomStateAfter.users.some((u) => u.userId === user.userId), false);

      // Attempting to reconnect should fail with SESSION_EXPIRED
      const client2 = createClient();
      await new Promise((resolve) => client2.on('connect', resolve));

      const reconnectRes = await new Promise((resolve) => {
        client2.emit('room:reconnect', {
          roomId: room.id,
          userId: user.userId,
          reconnectToken: user.reconnectToken
        }, resolve);
      });

      assert.strictEqual(reconnectRes.success, false);
      assert.strictEqual(reconnectRes.error.code, ERROR_CODES.SESSION_EXPIRED);

      client2.disconnect();
    });
  });

  describe('3. Reconnection Security & Anti-Spoofing', () => {
    it('rejects reconnection with invalid or mismatched reconnectToken', async () => {
      const { room } = roomService.createRoom({ name: 'Security Room', mode: 'youtube', displayName: 'Host' });

      const client1 = createClient();
      await new Promise((resolve) => client1.on('connect', resolve));

      const joinRes = await new Promise((resolve) => {
        client1.emit('room:join', { roomId: room.id, displayName: 'Charlie' }, resolve);
      });

      const { user } = joinRes.data;
      client1.disconnect();
      await new Promise((r) => setTimeout(r, 50));

      const client2 = createClient();
      await new Promise((resolve) => client2.on('connect', resolve));

      // Wrong token
      const wrongTokenRes = await new Promise((resolve) => {
        client2.emit('room:reconnect', {
          roomId: room.id,
          userId: user.userId,
          reconnectToken: '00000000-0000-0000-0000-000000000000'
        }, resolve);
      });

      assert.strictEqual(wrongTokenRes.success, false);
      assert.strictEqual(wrongTokenRes.error.code, ERROR_CODES.INVALID_RECONNECT_TOKEN);

      client2.disconnect();
    });

    it('rejects reconnection targeting mismatched room ID or user ID', async () => {
      const { room: room1 } = roomService.createRoom({ name: 'Room 1', mode: 'youtube', displayName: 'Host1' });
      const { room: room2 } = roomService.createRoom({ name: 'Room 2', mode: 'youtube', displayName: 'Host2' });

      const client1 = createClient();
      await new Promise((resolve) => client1.on('connect', resolve));

      const joinRes = await new Promise((resolve) => {
        client1.emit('room:join', { roomId: room1.id, displayName: 'Dave' }, resolve);
      });

      const { user } = joinRes.data;
      client1.disconnect();
      await new Promise((r) => setTimeout(r, 50));

      const client2 = createClient();
      await new Promise((resolve) => client2.on('connect', resolve));

      // Target wrong room
      const wrongRoomRes = await new Promise((resolve) => {
        client2.emit('room:reconnect', {
          roomId: room2.id,
          userId: user.userId,
          reconnectToken: user.reconnectToken
        }, resolve);
      });

      assert.strictEqual(wrongRoomRes.success, false);
      assert.ok([ERROR_CODES.SESSION_EXPIRED, ERROR_CODES.INVALID_RECONNECT_TOKEN].includes(wrongRoomRes.error.code));

      client2.disconnect();
    });
  });

  describe('4. Host Disconnect & Auto-Transfer', () => {
    it('reserves host role during grace period and transfers host if grace expires', async () => {
      reconnectionService.setGracePeriodMs(100);

      const { room } = roomService.createRoom({ name: 'Host Grace Room', mode: 'youtube', displayName: 'RESTHost' });

      const hostClient = createClient();
      const memberClient = createClient();
      await new Promise((resolve) => hostClient.on('connect', resolve));
      await new Promise((resolve) => memberClient.on('connect', resolve));

      const hostJoinRes = await new Promise((resolve) => {
        hostClient.emit('room:reconnect', {
          roomId: room.id,
          userId: room.hostId,
          reconnectToken: roomService.getPublicRoomState(room.id).users.find((u) => u.userId === room.hostId).reconnectToken
        }, resolve);
      });
      await new Promise((resolve) => {
        memberClient.emit('room:join', { roomId: room.id, displayName: 'MemberBob' }, resolve);
      });

      const hostUser = hostJoinRes.data.user;

      // Disconnect host
      hostClient.disconnect();
      await new Promise((r) => setTimeout(r, 30));

      // Host should still be reserved during grace
      const roomMid = roomStorage.getRoom(room.id);
      assert.strictEqual(roomMid.users.find((u) => u.userId === hostUser.userId).role, 'host');

      // Wait for grace period to expire
      await new Promise((r) => setTimeout(r, 150));

      // Host should be transferred to MemberBob
      const roomFinal = roomStorage.getRoom(room.id);
      assert.strictEqual(roomFinal.users.length, 1); // Only MemberBob remains
      const bobUser = roomFinal.users.find((u) => u.displayName === 'MemberBob');
      assert.strictEqual(bobUser.role, 'host');
      assert.strictEqual(roomFinal.hostUserId, bobUser.userId);

      memberClient.disconnect();
    });
  });

  describe('5. WebRTC & Presence Reconnection Behavior', () => {
    it('updates presence on disconnect and reconnect without duplicating user', async () => {
      const { room } = roomService.createRoom({ name: 'Presence Reconnect Room', mode: 'youtube', displayName: 'Host' });

      const hostClient = createClient();
      const discClient = createClient();
      await new Promise((resolve) => hostClient.on('connect', resolve));
      await new Promise((resolve) => discClient.on('connect', resolve));

      await new Promise((resolve) => hostClient.emit('room:join', { roomId: room.id, displayName: 'HostSocket' }, resolve));
      const joinRes = await new Promise((resolve) => {
        discClient.emit('room:join', { roomId: room.id, displayName: 'ReconnectingUser' }, resolve);
      });

      const { user } = joinRes.data;

      let presenceUpdatedOffline = false;
      let presenceUpdatedOnline = false;

      hostClient.on('presence:state', (state) => {
        const hasUser = state.users.some((u) => u.displayName === 'ReconnectingUser');
        if (!hasUser) {
          presenceUpdatedOffline = true;
        } else if (presenceUpdatedOffline && hasUser) {
          presenceUpdatedOnline = true;
        }
      });

      discClient.disconnect();
      await new Promise((r) => setTimeout(r, 60));
      assert.strictEqual(presenceUpdatedOffline, true);

      const recClient = createClient();
      await new Promise((resolve) => recClient.on('connect', resolve));
      await new Promise((resolve) => {
        recClient.emit('room:reconnect', {
          roomId: room.id,
          userId: user.userId,
          reconnectToken: user.reconnectToken
        }, resolve);
      });

      await new Promise((r) => setTimeout(r, 60));
      assert.strictEqual(presenceUpdatedOnline, true);

      hostClient.disconnect();
      recClient.disconnect();
    });
  });

  describe('6. Explicit Room Leave', () => {
    it('cancels grace period timer and invalidates reconnect token immediately on room:leave', async () => {
      const { room } = roomService.createRoom({ name: 'Explicit Leave Room', mode: 'youtube', displayName: 'Host' });

      const client1 = createClient();
      await new Promise((resolve) => client1.on('connect', resolve));

      const joinRes = await new Promise((resolve) => {
        client1.emit('room:join', { roomId: room.id, displayName: 'ExplicitLeaver' }, resolve);
      });

      const { user } = joinRes.data;

      await new Promise((resolve) => {
        client1.emit('room:leave', resolve);
      });

      client1.disconnect();

      const client2 = createClient();
      await new Promise((resolve) => client2.on('connect', resolve));

      const reconnectRes = await new Promise((resolve) => {
        client2.emit('room:reconnect', {
          roomId: room.id,
          userId: user.userId,
          reconnectToken: user.reconnectToken
        }, resolve);
      });

      assert.strictEqual(reconnectRes.success, false);
      assert.strictEqual(reconnectRes.error.code, ERROR_CODES.SESSION_EXPIRED);

      client2.disconnect();
    });
  });
});
