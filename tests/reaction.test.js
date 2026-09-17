process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { httpServer, io } from '../src/server.js';
import roomStorage from '../src/storage/room.storage.js';
import roomService from '../src/services/room.service.js';
import { ALLOWED_EMOJIS } from '../src/validators/reaction.validator.js';
import { ERROR_CODES } from '../src/utils/errors.js';

describe('Phase B5 — Reaction Tests', () => {
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

  describe('1. Reaction Emission & Whitelist Validation', () => {
    it('allows room member to send whitelisted reaction and broadcasts to room', async () => {
      const { room } = roomService.createRoom({ name: 'Reaction Room', mode: 'youtube', displayName: 'HostAlice' });

      const hostClient = createClient();
      const memberClient = createClient();
      await new Promise((resolve) => hostClient.on('connect', resolve));
      await new Promise((resolve) => memberClient.on('connect', resolve));

      await new Promise((resolve) => {
        hostClient.emit('room:join', { roomId: room.id, displayName: 'HostAliceSocket' }, resolve);
      });

      await new Promise((resolve) => {
        memberClient.emit('room:join', { roomId: room.id, displayName: 'Bob' }, resolve);
      });

      const reactionPromise = new Promise((resolve) => {
        hostClient.on('reaction:event', resolve);
      });

      const sendRes = await new Promise((resolve) => {
        memberClient.emit('reaction:send', { emoji: '🔥' }, resolve);
      });

      assert.strictEqual(sendRes.success, true);
      assert.strictEqual(sendRes.data.reaction.emoji, '🔥');
      assert.strictEqual(sendRes.data.reaction.displayName, 'Bob');
      assert.ok(sendRes.data.reaction.id);
      assert.ok(sendRes.data.reaction.createdAt);

      const broadcastedReaction = await reactionPromise;
      assert.strictEqual(broadcastedReaction.emoji, '🔥');
      assert.strictEqual(broadcastedReaction.displayName, 'Bob');

      hostClient.disconnect();
      memberClient.disconnect();
    });

    it('accepts all allowed emojis in whitelist', async () => {
      const { room } = roomService.createRoom({ name: 'Emoji Test', mode: 'youtube', displayName: 'Host' });
      const client = createClient();
      await new Promise((resolve) => client.on('connect', resolve));
      await new Promise((resolve) => client.emit('room:join', { roomId: room.id, displayName: 'User' }, resolve));

      for (const emoji of ALLOWED_EMOJIS) {
        const res = await new Promise((resolve) => {
          client.emit('reaction:send', { emoji }, resolve);
        });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.data.reaction.emoji, emoji);
      }

      client.disconnect();
    });

    it('rejects invalid or non-whitelisted emojis', async () => {
      const { room } = roomService.createRoom({ name: 'Invalid Emoji Test', mode: 'youtube', displayName: 'Host' });
      const client = createClient();
      await new Promise((resolve) => client.on('connect', resolve));
      await new Promise((resolve) => client.emit('room:join', { roomId: room.id, displayName: 'User' }, resolve));

      const invalidEmojis = ['💩', 'invalid_string', '', '🚀'];

      for (const emoji of invalidEmojis) {
        const res = await new Promise((resolve) => {
          client.emit('reaction:send', { emoji }, resolve);
        });
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.error.code, ERROR_CODES.INVALID_REACTION);
      }

      client.disconnect();
    });
  });

  describe('2. Anti-Spoofing & Room Isolation', () => {
    it('ignores client-supplied userId, displayName, and roomId in reaction:send payload', async () => {
      const { room } = roomService.createRoom({ name: 'Spoof Test', mode: 'youtube', displayName: 'Host' });
      const client = createClient();
      await new Promise((resolve) => client.on('connect', resolve));

      const joinRes = await new Promise((resolve) => {
        client.emit('room:join', { roomId: room.id, displayName: 'RealUser' }, resolve);
      });

      const res = await new Promise((resolve) => {
        client.emit(
          'reaction:send',
          {
            emoji: '❤️',
            userId: 'fake-id',
            displayName: 'SpoofedName',
            roomId: 'SYNC-FAKE'
          },
          resolve
        );
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.reaction.userId, joinRes.data.user.id);
      assert.strictEqual(res.data.reaction.displayName, 'RealUser');
      assert.strictEqual(res.data.reaction.roomId, room.id);

      client.disconnect();
    });

    it('rejects reaction attempt from a socket not currently in a room', async () => {
      const client = createClient();
      await new Promise((resolve) => client.on('connect', resolve));

      const res = await new Promise((resolve) => {
        client.emit('reaction:send', { emoji: '👍' }, resolve);
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.code, ERROR_CODES.NOT_ROOM_MEMBER);

      client.disconnect();
    });

    it('isolates reaction events strictly between rooms', async () => {
      const roomA = roomService.createRoom({ name: 'Room A', mode: 'youtube', displayName: 'HostA' }).room;
      const roomB = roomService.createRoom({ name: 'Room B', mode: 'youtube', displayName: 'HostB' }).room;

      const clientA = createClient();
      const clientB = createClient();
      await new Promise((resolve) => clientA.on('connect', resolve));
      await new Promise((resolve) => clientB.on('connect', resolve));

      await new Promise((resolve) => clientA.emit('room:join', { roomId: roomA.id, displayName: 'UserA' }, resolve));
      await new Promise((resolve) => clientB.emit('room:join', { roomId: roomB.id, displayName: 'UserB' }, resolve));

      let roomBReceivedReaction = false;
      clientB.on('reaction:event', () => {
        roomBReceivedReaction = true;
      });

      await new Promise((resolve) => {
        clientA.emit('reaction:send', { emoji: '🎉' }, resolve);
      });

      await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual(roomBReceivedReaction, false);

      clientA.disconnect();
      clientB.disconnect();
    });
  });
});
