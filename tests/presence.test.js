process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { httpServer, io } from '../src/server.js';
import roomStorage from '../src/storage/room.storage.js';
import roomService from '../src/services/room.service.js';
import presenceService from '../src/services/presence.service.js';

describe('Phase B5 — Presence Tests', () => {
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

  beforeEach(() => {
    roomStorage.clear();
  });

  const createClient = () => {
    return ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });
  };

  describe('1. Server-Authoritative Presence & Event Lifecycle', () => {
    it('broadcasts presence:state containing connected users on room:join', async () => {
      const { room } = roomService.createRoom({ name: 'Presence Room', mode: 'youtube', displayName: 'HostAlice' });

      const hostClient = createClient();
      await new Promise((resolve) => hostClient.on('connect', resolve));

      const presencePromise = new Promise((resolve) => {
        hostClient.on('presence:state', resolve);
      });

      const joinRes = await new Promise((resolve) => {
        hostClient.emit('room:join', { roomId: room.id, displayName: 'HostAliceSocket' }, resolve);
      });

      assert.strictEqual(joinRes.success, true);
      const presenceState = await presencePromise;

      assert.strictEqual(presenceState.users.length, 2); // REST Host + HostAliceSocket
      assert.strictEqual(presenceState.users.every((u) => u.connected === true), true);

      hostClient.disconnect();
    });

    it('updates presence:state when a user leaves the room via room:leave', async () => {
      const { room } = roomService.createRoom({ name: 'Leave Presence Room', mode: 'youtube', displayName: 'Host' });

      const hostClient = createClient();
      const leaverClient = createClient();
      await new Promise((resolve) => hostClient.on('connect', resolve));
      await new Promise((resolve) => leaverClient.on('connect', resolve));

      await new Promise((resolve) => hostClient.emit('room:join', { roomId: room.id, displayName: 'HostSocket' }, resolve));
      await new Promise((resolve) => leaverClient.emit('room:join', { roomId: room.id, displayName: 'LeaverUser' }, resolve));

      const presencePromise = new Promise((resolve) => {
        hostClient.on('presence:state', (state) => {
          if (!state.users.some((u) => u.displayName === 'LeaverUser')) {
            resolve(state);
          }
        });
      });

      await new Promise((resolve) => leaverClient.emit('room:leave', resolve));

      const updatedPresence = await presencePromise;
      assert.strictEqual(updatedPresence.users.some((u) => u.displayName === 'LeaverUser'), false);

      hostClient.disconnect();
      leaverClient.disconnect();
    });

    it('updates presence:state when a user disconnects socket connection', async () => {
      const { room } = roomService.createRoom({ name: 'Disconnect Presence Room', mode: 'youtube', displayName: 'Host' });

      const hostClient = createClient();
      const discClient = createClient();
      await new Promise((resolve) => hostClient.on('connect', resolve));
      await new Promise((resolve) => discClient.on('connect', resolve));

      await new Promise((resolve) => hostClient.emit('room:join', { roomId: room.id, displayName: 'HostSocket' }, resolve));
      await new Promise((resolve) => discClient.emit('room:join', { roomId: room.id, displayName: 'DiscUser' }, resolve));

      const presencePromise = new Promise((resolve) => {
        hostClient.on('presence:state', (state) => {
          if (!state.users.some((u) => u.displayName === 'DiscUser')) {
            resolve(state);
          }
        });
      });

      discClient.disconnect();

      const updatedPresence = await presencePromise;
      assert.strictEqual(updatedPresence.users.some((u) => u.displayName === 'DiscUser'), false);

      hostClient.disconnect();
    });
  });

  describe('2. Room Isolation', () => {
    it('isolates presence:state updates strictly per room', async () => {
      const roomA = roomService.createRoom({ name: 'Room A', mode: 'youtube', displayName: 'HostA' }).room;
      const roomB = roomService.createRoom({ name: 'Room B', mode: 'youtube', displayName: 'HostB' }).room;

      const clientA = createClient();
      const clientB = createClient();
      await new Promise((resolve) => clientA.on('connect', resolve));
      await new Promise((resolve) => clientB.on('connect', resolve));

      await new Promise((resolve) => clientA.emit('room:join', { roomId: roomA.id, displayName: 'UserA' }, resolve));
      await new Promise((resolve) => clientB.emit('room:join', { roomId: roomB.id, displayName: 'UserB' }, resolve));

      let roomBReceivedPresenceUpdate = false;
      clientB.on('presence:state', (state) => {
        if (state.users.some((u) => u.displayName === 'NewUserA')) {
          roomBReceivedPresenceUpdate = true;
        }
      });

      const newUserA = createClient();
      await new Promise((resolve) => newUserA.on('connect', resolve));
      await new Promise((resolve) => newUserA.emit('room:join', { roomId: roomA.id, displayName: 'NewUserA' }, resolve));

      await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual(roomBReceivedPresenceUpdate, false);

      clientA.disconnect();
      clientB.disconnect();
      newUserA.disconnect();
    });
  });
});
