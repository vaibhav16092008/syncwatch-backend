process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { httpServer, io } from '../src/server.js';
import roomStorage from '../src/storage/room.storage.js';
import roomService from '../src/services/room.service.js';
import chatService from '../src/services/chat.service.js';
import { ERROR_CODES } from '../src/utils/errors.js';

describe('Phase B5 — Chat Tests', () => {
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

  describe('1. Chat Message Sending & Formatting', () => {
    it('allows room member to send valid chat message and broadcasts to room', async () => {
      const { room } = roomService.createRoom({ name: 'Chat Room', mode: 'youtube', displayName: 'HostAlice' });

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

      const messagePromise = new Promise((resolve) => {
        hostClient.on('chat:message', resolve);
      });

      const sendRes = await new Promise((resolve) => {
        memberClient.emit('chat:send', { message: 'Hello Watch Party!' }, resolve);
      });

      assert.strictEqual(sendRes.success, true);
      assert.strictEqual(sendRes.data.message.message, 'Hello Watch Party!');
      assert.strictEqual(sendRes.data.message.displayName, 'Bob');
      assert.ok(sendRes.data.message.id);
      assert.ok(sendRes.data.message.createdAt);

      const broadcastedMessage = await messagePromise;
      assert.strictEqual(broadcastedMessage.message, 'Hello Watch Party!');
      assert.strictEqual(broadcastedMessage.displayName, 'Bob');

      hostClient.disconnect();
      memberClient.disconnect();
    });

    it('rejects empty and whitespace-only chat messages', async () => {
      const { room } = roomService.createRoom({ name: 'Empty Test', mode: 'youtube', displayName: 'Host' });
      const client = createClient();
      await new Promise((resolve) => client.on('connect', resolve));
      await new Promise((resolve) => client.emit('room:join', { roomId: room.id, displayName: 'User' }, resolve));

      const res1 = await new Promise((resolve) => {
        client.emit('chat:send', { message: '' }, resolve);
      });
      assert.strictEqual(res1.success, false);
      assert.strictEqual(res1.error.code, ERROR_CODES.INVALID_CHAT_MESSAGE);

      const res2 = await new Promise((resolve) => {
        client.emit('chat:send', { message: '   \n  \t  ' }, resolve);
      });
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res2.error.code, ERROR_CODES.INVALID_CHAT_MESSAGE);

      client.disconnect();
    });

    it('rejects chat messages exceeding 500 characters', async () => {
      const { room } = roomService.createRoom({ name: 'Long Message Test', mode: 'youtube', displayName: 'Host' });
      const client = createClient();
      await new Promise((resolve) => client.on('connect', resolve));
      await new Promise((resolve) => client.emit('room:join', { roomId: room.id, displayName: 'User' }, resolve));

      const longMessage = 'A'.repeat(501);
      const res = await new Promise((resolve) => {
        client.emit('chat:send', { message: longMessage }, resolve);
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.code, ERROR_CODES.CHAT_MESSAGE_TOO_LONG);

      client.disconnect();
    });

    it('sanitizes HTML tags in chat message content', async () => {
      const { room } = roomService.createRoom({ name: 'HTML Test', mode: 'youtube', displayName: 'Host' });
      const client = createClient();
      await new Promise((resolve) => client.on('connect', resolve));
      await new Promise((resolve) => client.emit('room:join', { roomId: room.id, displayName: 'User' }, resolve));

      const res = await new Promise((resolve) => {
        client.emit('chat:send', { message: '<script>alert("xss")</script>' }, resolve);
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.message.message, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');

      client.disconnect();
    });
  });

  describe('2. Security, Anti-Spoofing & Room Isolation', () => {
    it('ignores client-supplied userId, displayName, and roomId in chat:send payload', async () => {
      const { room } = roomService.createRoom({ name: 'Spoof Test', mode: 'youtube', displayName: 'Host' });
      const client = createClient();
      await new Promise((resolve) => client.on('connect', resolve));

      const joinRes = await new Promise((resolve) => {
        client.emit('room:join', { roomId: room.id, displayName: 'RealName' }, resolve);
      });

      const res = await new Promise((resolve) => {
        client.emit(
          'chat:send',
          {
            message: 'Attacker message',
            userId: 'fake-user-id',
            displayName: 'SpoofedAdmin',
            roomId: 'SYNC-FAKE'
          },
          resolve
        );
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.message.userId, joinRes.data.user.id);
      assert.strictEqual(res.data.message.displayName, 'RealName');
      assert.strictEqual(res.data.message.roomId, room.id);

      client.disconnect();
    });

    it('rejects chat message attempt from a socket not currently in a room', async () => {
      const client = createClient();
      await new Promise((resolve) => client.on('connect', resolve));

      const res = await new Promise((resolve) => {
        client.emit('chat:send', { message: 'Rogue message' }, resolve);
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.code, ERROR_CODES.NOT_ROOM_MEMBER);

      client.disconnect();
    });

    it('isolates chat messages strictly between rooms', async () => {
      const roomA = roomService.createRoom({ name: 'Room A', mode: 'youtube', displayName: 'HostA' }).room;
      const roomB = roomService.createRoom({ name: 'Room B', mode: 'youtube', displayName: 'HostB' }).room;

      const clientA = createClient();
      const clientB = createClient();
      await new Promise((resolve) => clientA.on('connect', resolve));
      await new Promise((resolve) => clientB.on('connect', resolve));

      await new Promise((resolve) => clientA.emit('room:join', { roomId: roomA.id, displayName: 'UserA' }, resolve));
      await new Promise((resolve) => clientB.emit('room:join', { roomId: roomB.id, displayName: 'UserB' }, resolve));

      let roomBReceivedMessage = false;
      clientB.on('chat:message', () => {
        roomBReceivedMessage = true;
      });

      await new Promise((resolve) => {
        clientA.emit('chat:send', { message: 'Message in Room A' }, resolve);
      });

      await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual(roomBReceivedMessage, false);

      clientA.disconnect();
      clientB.disconnect();
    });
  });

  describe('3. Memory Cap & Late-Join Synchronization', () => {
    it('caps stored chat history to 100 messages max per room', () => {
      const createRes = roomService.createRoom({ name: 'Cap Room', mode: 'youtube', displayName: 'Host' });
      const roomId = createRes.room.id;
      const userId = createRes.hostUserId;

      for (let i = 1; i <= 105; i++) {
        chatService.addMessage({ roomId, userId, message: `Msg ${i}` });
      }

      const history = chatService.getChatHistory(roomId, userId);
      assert.strictEqual(history.length, 100);
      assert.strictEqual(history[0].message, 'Msg 6');
      assert.strictEqual(history[99].message, 'Msg 105');
    });

    it('sends chat history to late-joining socket via chat:history event', async () => {
      const createRes = roomService.createRoom({ name: 'History Room', mode: 'youtube', displayName: 'Host' });
      const roomId = createRes.room.id;
      const hostId = createRes.hostUserId;

      chatService.addMessage({ roomId, userId: hostId, message: 'Early Msg 1' });
      chatService.addMessage({ roomId, userId: hostId, message: 'Early Msg 2' });

      const lateClient = createClient();
      await new Promise((resolve) => lateClient.on('connect', resolve));

      const historyPromise = new Promise((resolve) => {
        lateClient.on('chat:history', resolve);
      });

      await new Promise((resolve) => {
        lateClient.emit('room:join', { roomId, displayName: 'LateUser' }, resolve);
      });

      const historyEvent = await historyPromise;
      assert.strictEqual(historyEvent.messages.length, 2);
      assert.strictEqual(historyEvent.messages[0].message, 'Early Msg 1');
      assert.strictEqual(historyEvent.messages[1].message, 'Early Msg 2');

      lateClient.disconnect();
    });
  });
});
