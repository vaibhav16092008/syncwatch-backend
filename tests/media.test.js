process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { app, httpServer, io } from '../src/server.js';
import roomStorage from '../src/storage/room.storage.js';
import mediaService from '../src/services/media.service.js';
import roomService from '../src/services/room.service.js';
import { ERROR_CODES } from '../src/utils/errors.js';
import { extractYouTubeVideoId } from '../src/validators/media.validator.js';

describe('Phase B3 — Media & Synchronization Tests', () => {
  let port;

  before(async () => {
    if (!httpServer.listening) {
      await new Promise((resolve) => httpServer.listen(0, resolve));
    }
    port = httpServer.address().port;
  });

  after(async () => {
    if (httpServer.listening) {
      await new Promise((resolve) => {
        io.close(() => {
          httpServer.close(resolve);
        });
      });
    }
  });

  beforeEach(() => {
    roomStorage.clear();
  });

  const createClient = () => {
    return ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true
    });
  };

  describe('1. YouTube Source Validation', () => {
    it('accepts valid 11-character YouTube video IDs', () => {
      assert.strictEqual(extractYouTubeVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    });

    it('extracts ID from full youtube.com/watch?v= URLs', () => {
      assert.strictEqual(
        extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
        'dQw4w9WgXcQ'
      );
    });

    it('extracts ID from short youtu.be/ URLs', () => {
      assert.strictEqual(
        extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ'),
        'dQw4w9WgXcQ'
      );
    });

    it('extracts ID from youtube.com/embed/ URLs', () => {
      assert.strictEqual(
        extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'),
        'dQw4w9WgXcQ'
      );
    });

    it('rejects malformed IDs and non-YouTube URLs', () => {
      assert.throws(() => extractYouTubeVideoId('invalid_id'), (err) => err.code === ERROR_CODES.INVALID_MEDIA_SOURCE);
      assert.throws(() => extractYouTubeVideoId('https://vimeo.com/12345678'), (err) => err.code === ERROR_CODES.INVALID_MEDIA_SOURCE);
    });

    it('rejects iframe, script tags, and HTML injection', () => {
      assert.throws(
        () => extractYouTubeVideoId('<iframe src="https://youtube.com"></iframe>'),
        (err) => err.code === ERROR_CODES.INVALID_MEDIA_SOURCE
      );
      assert.throws(
        () => extractYouTubeVideoId('<script>alert(1)</script>'),
        (err) => err.code === ERROR_CODES.INVALID_MEDIA_SOURCE
      );
    });
  });

  describe('2. Media Service & Business Logic', () => {
    it('initializes room with default media state', () => {
      const { room } = roomService.createRoom({ name: 'Media Room', mode: 'youtube', displayName: 'Host' });
      assert.deepStrictEqual(room.media, {
        source: null,
        status: 'paused',
        position: 0,
        playbackRate: 1,
        updatedAt: 0,
        version: 0
      });
    });

    it('allows host to set media source and resets playback defaults', () => {
      const { room, hostUserId } = roomService.createRoom({ name: 'Media Room', mode: 'youtube', displayName: 'Host' });
      const state = mediaService.setMediaSource({
        roomId: room.id,
        actingUserId: hostUserId,
        type: 'youtube',
        mediaId: 'dQw4w9WgXcQ'
      });

      assert.deepStrictEqual(state.source, { type: 'youtube', mediaId: 'dQw4w9WgXcQ' });
      assert.strictEqual(state.status, 'paused');
      assert.strictEqual(state.position, 0);
      assert.strictEqual(state.playbackRate, 1);
      assert.ok(state.updatedAt > 0);
      assert.strictEqual(state.version, 1);
    });

    it('rejects non-host setting media source', () => {
      const { room } = roomService.createRoom({ name: 'Media Room', mode: 'youtube', displayName: 'Host' });
      assert.throws(
        () => mediaService.setMediaSource({ roomId: room.id, actingUserId: 'fake-user', type: 'youtube', mediaId: 'dQw4w9WgXcQ' }),
        (err) => err.code === ERROR_CODES.MEDIA_CONTROL_FORBIDDEN
      );
    });

    it('allows host to play, pause, seek, and clear media', () => {
      const { room, hostUserId } = roomService.createRoom({ name: 'Media Room', mode: 'youtube', displayName: 'Host' });
      mediaService.setMediaSource({ roomId: room.id, actingUserId: hostUserId, type: 'youtube', mediaId: 'dQw4w9WgXcQ' });

      // Play at position 10
      const playState = mediaService.playMedia({ roomId: room.id, actingUserId: hostUserId, position: 10 });
      assert.strictEqual(playState.status, 'playing');
      assert.strictEqual(playState.version, 2);

      // Seek to position 50
      const seekState = mediaService.seekMedia({ roomId: room.id, actingUserId: hostUserId, position: 50 });
      assert.strictEqual(seekState.position, 50);
      assert.strictEqual(seekState.version, 3);

      // Pause at position 60
      const pauseState = mediaService.pauseMedia({ roomId: room.id, actingUserId: hostUserId, position: 60 });
      assert.strictEqual(pauseState.status, 'paused');
      assert.strictEqual(pauseState.position, 60);
      assert.strictEqual(pauseState.version, 4);

      // Clear media
      const clearState = mediaService.clearMedia({ roomId: room.id, actingUserId: hostUserId });
      assert.strictEqual(clearState.source, null);
      assert.strictEqual(clearState.version, 5);
    });

    it('calculates effective position during playback based on server time', async () => {
      const { room, hostUserId } = roomService.createRoom({ name: 'Media Room', mode: 'youtube', displayName: 'Host' });
      mediaService.setMediaSource({ roomId: room.id, actingUserId: hostUserId, type: 'youtube', mediaId: 'dQw4w9WgXcQ' });
      mediaService.playMedia({ roomId: room.id, actingUserId: hostUserId, position: 0 });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const currentState = mediaService.getMediaState(room.id);
      assert.ok(currentState.position >= 0.15, `Expected effective position > 0.15, got ${currentState.position}`);
    });

    it('updates position anchor when changing playback rate while playing', () => {
      const { room, hostUserId } = roomService.createRoom({ name: 'Media Room', mode: 'youtube', displayName: 'Host' });
      mediaService.setMediaSource({ roomId: room.id, actingUserId: hostUserId, type: 'youtube', mediaId: 'dQw4w9WgXcQ' });
      mediaService.playMedia({ roomId: room.id, actingUserId: hostUserId, position: 10 });

      const rateState = mediaService.setPlaybackRate({ roomId: room.id, actingUserId: hostUserId, playbackRate: 1.5 });
      assert.strictEqual(rateState.playbackRate, 1.5);
      assert.ok(rateState.version === 3);
    });

    it('throws MEDIA_NOT_FOUND when performing playback actions on room without media', () => {
      const { room, hostUserId } = roomService.createRoom({ name: 'Media Room', mode: 'youtube', displayName: 'Host' });
      assert.throws(
        () => mediaService.playMedia({ roomId: room.id, actingUserId: hostUserId, position: 0 }),
        (err) => err.code === ERROR_CODES.MEDIA_NOT_FOUND
      );
    });
  });

  describe('3. Validation Rules & Versioning', () => {
    it('rejects invalid/negative positions and invalid playback rates', () => {
      const { room, hostUserId } = roomService.createRoom({ name: 'Media Room', mode: 'youtube', displayName: 'Host' });
      mediaService.setMediaSource({ roomId: room.id, actingUserId: hostUserId, type: 'youtube', mediaId: 'dQw4w9WgXcQ' });

      assert.throws(
        () => mediaService.playMedia({ roomId: room.id, actingUserId: hostUserId, position: -5 }),
        (err) => err.code === ERROR_CODES.INVALID_MEDIA_POSITION
      );

      assert.throws(
        () => mediaService.setPlaybackRate({ roomId: room.id, actingUserId: hostUserId, playbackRate: 3.0 }),
        (err) => err.code === ERROR_CODES.INVALID_PLAYBACK_RATE
      );
    });

    it('does not increment version on failed operations', () => {
      const { room, hostUserId } = roomService.createRoom({ name: 'Media Room', mode: 'youtube', displayName: 'Host' });
      mediaService.setMediaSource({ roomId: room.id, actingUserId: hostUserId, type: 'youtube', mediaId: 'dQw4w9WgXcQ' });

      const initialVersion = mediaService.getMediaState(room.id).version;

      try {
        mediaService.playMedia({ roomId: room.id, actingUserId: hostUserId, position: -10 });
      } catch (err) {
        // Expected
      }

      assert.strictEqual(mediaService.getMediaState(room.id).version, initialVersion);
    });
  });

  describe('4. REST Media Endpoint (GET /api/rooms/:roomId/media)', () => {
    it('returns public authoritative media state for valid room', async () => {
      const { room, hostUserId } = roomService.createRoom({ name: 'REST Room', mode: 'youtube', displayName: 'Host' });
      mediaService.setMediaSource({ roomId: room.id, actingUserId: hostUserId, type: 'youtube', mediaId: 'dQw4w9WgXcQ' });

      const res = await request(app)
        .get(`/api/rooms/${room.id}/media`)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.deepStrictEqual(res.body.data.media.source, { type: 'youtube', mediaId: 'dQw4w9WgXcQ' });
      assert.strictEqual(res.body.data.media.version, 1);
    });

    it('returns 400 for malformed room code', async () => {
      const res = await request(app)
        .get('/api/rooms/invalid-code/media')
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.INVALID_ROOM_CODE);
    });

    it('returns 404 for non-existent room', async () => {
      const res = await request(app)
        .get('/api/rooms/SYNC-99999/media')
        .expect(404);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.ROOM_NOT_FOUND);
    });
  });

  describe('5. Socket Media Events & Late Join Synchronization', () => {
    const joinAsHost = async (socket, roomId, displayName = 'HostSocket') => {
      const res = await new Promise((resolve) => {
        socket.emit('room:join', { roomId, displayName }, resolve);
      });
      assert.strictEqual(res.success, true);
      const userId = res.data.user.id;
      roomStorage.updateRoom(roomId, (r) => {
        r.hostUserId = userId;
        r.users.forEach((u) => {
          u.role = u.id === userId ? 'host' : 'member';
        });
        return r;
      });
      return userId;
    };

    it('broadcasts media:state on media mutations to room members', async () => {
      const { room } = roomService.createRoom({ name: 'Socket Room', mode: 'youtube', displayName: 'InitHost' });

      const hostSocket = createClient();
      const memberSocket = createClient();

      await new Promise((resolve) => hostSocket.on('connect', resolve));
      await new Promise((resolve) => memberSocket.on('connect', resolve));

      // Host joins room & becomes host
      await joinAsHost(hostSocket, room.id, 'HostSocket');

      // Member joins room
      await new Promise((resolve) => {
        memberSocket.emit('room:join', { roomId: room.id, displayName: 'Member' }, resolve);
      });

      // Member listens for media:state
      const statePromise = new Promise((resolve) => {
        memberSocket.on('media:state', (state) => {
          resolve(state);
        });
      });

      // Host sets media
      hostSocket.emit('media:set', { type: 'youtube', mediaId: 'dQw4w9WgXcQ' });

      const receivedState = await statePromise;
      assert.deepStrictEqual(receivedState.source, { type: 'youtube', mediaId: 'dQw4w9WgXcQ' });
      assert.strictEqual(receivedState.version, 1);

      hostSocket.disconnect();
      memberSocket.disconnect();
    });

    it('rejects media control events from non-host users over socket', async () => {
      const { room } = roomService.createRoom({ name: 'Socket Room', mode: 'youtube', displayName: 'InitHost' });

      const hostSocket = createClient();
      const memberSocket = createClient();

      await new Promise((resolve) => hostSocket.on('connect', resolve));
      await new Promise((resolve) => memberSocket.on('connect', resolve));

      await joinAsHost(hostSocket, room.id, 'HostSocket');
      await new Promise((resolve) => memberSocket.emit('room:join', { roomId: room.id, displayName: 'Member' }, resolve));

      // Host sets media
      await new Promise((resolve) => {
        hostSocket.emit('media:set', { type: 'youtube', mediaId: 'dQw4w9WgXcQ' }, resolve);
      });

      // Member attempts to play media -> fails
      const response = await new Promise((resolve) => {
        memberSocket.emit('media:play', { position: 0 }, resolve);
      });

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error.code, ERROR_CODES.MEDIA_CONTROL_FORBIDDEN);

      hostSocket.disconnect();
      memberSocket.disconnect();
    });

    it('sends current authoritative media state to late-joining client', async () => {
      const { room } = roomService.createRoom({ name: 'Late Join Room', mode: 'youtube', displayName: 'InitHost' });

      const hostSocket = createClient();
      await new Promise((resolve) => hostSocket.on('connect', resolve));
      await joinAsHost(hostSocket, room.id, 'HostSocket');

      // Host sets and plays media
      await new Promise((resolve) => hostSocket.emit('media:set', { type: 'youtube', mediaId: 'dQw4w9WgXcQ' }, resolve));
      await new Promise((resolve) => hostSocket.emit('media:play', { position: 10 }, resolve));

      // Late joining member connects and receives media:state on join
      const memberSocket = createClient();
      await new Promise((resolve) => memberSocket.on('connect', resolve));

      const lateJoinMediaStatePromise = new Promise((resolve) => {
        memberSocket.on('media:state', resolve);
      });

      await new Promise((resolve) => memberSocket.emit('room:join', { roomId: room.id, displayName: 'LateMember' }, resolve));

      const mediaState = await lateJoinMediaStatePromise;
      assert.strictEqual(mediaState.status, 'playing');
      assert.ok(mediaState.position >= 10);
      assert.strictEqual(mediaState.version, 2);

      hostSocket.disconnect();
      memberSocket.disconnect();
    });

    it('updates media control permissions immediately upon host transfer', async () => {
      const { room } = roomService.createRoom({ name: 'Transfer Room', mode: 'youtube', displayName: 'InitHost' });

      const hostSocket = createClient();
      const memberSocket = createClient();

      await new Promise((resolve) => hostSocket.on('connect', resolve));
      await new Promise((resolve) => memberSocket.on('connect', resolve));

      await joinAsHost(hostSocket, room.id, 'HostSocket');
      const memberJoinRes = await new Promise((resolve) => {
        memberSocket.emit('room:join', { roomId: room.id, displayName: 'NewHostCandidate' }, resolve);
      });
      const newHostUserId = memberJoinRes.data.user.id;

      // Set initial media
      await new Promise((resolve) => hostSocket.emit('media:set', { type: 'youtube', mediaId: 'dQw4w9WgXcQ' }, resolve));

      // Transfer host role to member
      const transferRes = await new Promise((resolve) => {
        hostSocket.emit('room:transfer-host', { targetUserId: newHostUserId }, resolve);
      });
      assert.strictEqual(transferRes.success, true);

      // Former host attempts to play media -> fails
      const formerHostPlayRes = await new Promise((resolve) => {
        hostSocket.emit('media:play', { position: 5 }, resolve);
      });
      assert.strictEqual(formerHostPlayRes.success, false);
      assert.strictEqual(formerHostPlayRes.error.code, ERROR_CODES.MEDIA_CONTROL_FORBIDDEN);

      // New host attempts to play media -> succeeds
      const newHostPlayRes = await new Promise((resolve) => {
        memberSocket.emit('media:play', { position: 5 }, resolve);
      });
      assert.strictEqual(newHostPlayRes.success, true);
      assert.strictEqual(newHostPlayRes.data.media.status, 'playing');

      hostSocket.disconnect();
      memberSocket.disconnect();
    });
  });

  describe('6. Room Isolation', () => {
    it('isolates media state between independent rooms', async () => {
      const roomA = roomService.createRoom({ name: 'Room A', mode: 'youtube', displayName: 'InitHostA' }).room;
      const roomB = roomService.createRoom({ name: 'Room B', mode: 'youtube', displayName: 'InitHostB' }).room;

      const hostASocket = createClient();
      await new Promise((resolve) => hostASocket.on('connect', resolve));
      
      const joinRes = await new Promise((resolve) => {
        hostASocket.emit('room:join', { roomId: roomA.id, displayName: 'HostASocket' }, resolve);
      });
      roomStorage.updateRoom(roomA.id, (r) => {
        r.hostUserId = joinRes.data.user.id;
        r.users.forEach((u) => { u.role = u.id === joinRes.data.user.id ? 'host' : 'member'; });
        return r;
      });

      await new Promise((resolve) => hostASocket.emit('media:set', { type: 'youtube', mediaId: 'dQw4w9WgXcQ' }, resolve));

      const mediaA = mediaService.getMediaState(roomA.id);
      const mediaB = mediaService.getMediaState(roomB.id);

      assert.deepStrictEqual(mediaA.source, { type: 'youtube', mediaId: 'dQw4w9WgXcQ' });
      assert.strictEqual(mediaB.source, null);

      hostASocket.disconnect();
    });

    it('supports simultaneous media operations across separate rooms without interference', async () => {
      const roomA = roomService.createRoom({ name: 'Room A', mode: 'youtube', displayName: 'InitHostA' }).room;
      const roomB = roomService.createRoom({ name: 'Room B', mode: 'youtube', displayName: 'InitHostB' }).room;

      const hostASocket = createClient();
      const hostBSocket = createClient();

      await new Promise((resolve) => hostASocket.on('connect', resolve));
      await new Promise((resolve) => hostBSocket.on('connect', resolve));

      const joinARes = await new Promise((resolve) => hostASocket.emit('room:join', { roomId: roomA.id, displayName: 'HostA' }, resolve));
      const joinBRes = await new Promise((resolve) => hostBSocket.emit('room:join', { roomId: roomB.id, displayName: 'HostB' }, resolve));

      roomStorage.updateRoom(roomA.id, (r) => { r.hostUserId = joinARes.data.user.id; return r; });
      roomStorage.updateRoom(roomB.id, (r) => { r.hostUserId = joinBRes.data.user.id; return r; });

      // Simultaneously set different media sources
      await Promise.all([
        new Promise((resolve) => hostASocket.emit('media:set', { type: 'youtube', mediaId: 'dQw4w9WgXcQ' }, resolve)),
        new Promise((resolve) => hostBSocket.emit('media:set', { type: 'youtube', mediaId: 'l482T0yNkeo' }, resolve))
      ]);

      const stateA = mediaService.getMediaState(roomA.id);
      const stateB = mediaService.getMediaState(roomB.id);

      assert.strictEqual(stateA.source.mediaId, 'dQw4w9WgXcQ');
      assert.strictEqual(stateB.source.mediaId, 'l482T0yNkeo');

      hostASocket.disconnect();
      hostBSocket.disconnect();
    });
  });
});
