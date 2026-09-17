process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { httpServer } from '../src/server.js';
import roomStorage from '../src/storage/room.storage.js';
import roomService from '../src/services/room.service.js';
import { ERROR_CODES } from '../src/utils/errors.js';

describe('Phase B6 — WebRTC Signaling Tests', () => {
  let port;

  before(async () => {
    if (!httpServer.listening) {
      await new Promise((resolve) => httpServer.listen(0, resolve));
    }
    port = httpServer.address().port;
  });

  after(async () => {
    // Keep server active for single-process test runner
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

  describe('1. Peer Readiness & Discovery', () => {
    it('registers peer as ready and broadcasts webrtc:peer-ready to room', async () => {
      const { room } = roomService.createRoom({ name: 'WebRTC Room', mode: 'youtube', displayName: 'HostAlice' });

      const clientA = createClient();
      const clientB = createClient();
      await new Promise((resolve) => clientA.on('connect', resolve));
      await new Promise((resolve) => clientB.on('connect', resolve));

      const joinARes = await new Promise((resolve) => {
        clientA.emit('room:join', { roomId: room.id, displayName: 'Alice' }, resolve);
      });
      await new Promise((resolve) => {
        clientB.emit('room:join', { roomId: room.id, displayName: 'Bob' }, resolve);
      });

      const peerReadyPromise = new Promise((resolve) => {
        clientB.on('webrtc:peer-ready', resolve);
      });

      const readyRes = await new Promise((resolve) => {
        clientA.emit('webrtc:peer-ready', {}, resolve);
      });

      assert.strictEqual(readyRes.success, true);
      assert.ok(readyRes.data.readyPeers.some((p) => p.userId === joinARes.data.user.id));

      const peerReadyEvent = await peerReadyPromise;
      assert.strictEqual(peerReadyEvent.userId, joinARes.data.user.id);
      assert.strictEqual(peerReadyEvent.displayName, 'Alice');

      clientA.disconnect();
      clientB.disconnect();
    });
  });

  describe('2. Offer / Answer / ICE Candidate Relay', () => {
    it('relays WebRTC offer, answer, and ICE candidate between room members', async () => {
      const { room } = roomService.createRoom({ name: 'Relay Room', mode: 'youtube', displayName: 'HostAlice' });

      const clientA = createClient();
      const clientB = createClient();
      await new Promise((resolve) => clientA.on('connect', resolve));
      await new Promise((resolve) => clientB.on('connect', resolve));

      const joinARes = await new Promise((resolve) => {
        clientA.emit('room:join', { roomId: room.id, displayName: 'Alice' }, resolve);
      });
      const joinBRes = await new Promise((resolve) => {
        clientB.emit('room:join', { roomId: room.id, displayName: 'Bob' }, resolve);
      });

      const userAId = joinARes.data.user.id;
      const userBId = joinBRes.data.user.id;

      // Offer from A to B
      const offerPromise = new Promise((resolve) => {
        clientB.on('webrtc:offer', resolve);
      });

      const offerRes = await new Promise((resolve) => {
        clientA.emit(
          'webrtc:offer',
          {
            targetUserId: userBId,
            sdp: { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1' }
          },
          resolve
        );
      });
      assert.strictEqual(offerRes.success, true);

      const receivedOffer = await offerPromise;
      assert.strictEqual(receivedOffer.senderUserId, userAId);
      assert.strictEqual(receivedOffer.senderDisplayName, 'Alice');
      assert.strictEqual(receivedOffer.sdp.type, 'offer');

      // Answer from B to A
      const answerPromise = new Promise((resolve) => {
        clientA.on('webrtc:answer', resolve);
      });

      const answerRes = await new Promise((resolve) => {
        clientB.emit(
          'webrtc:answer',
          {
            targetUserId: userAId,
            sdp: { type: 'answer', sdp: 'v=0\r\no=- 67890 2 IN IP4 127.0.0.1' }
          },
          resolve
        );
      });
      assert.strictEqual(answerRes.success, true);

      const receivedAnswer = await answerPromise;
      assert.strictEqual(receivedAnswer.senderUserId, userBId);
      assert.strictEqual(receivedAnswer.senderDisplayName, 'Bob');
      assert.strictEqual(receivedAnswer.sdp.type, 'answer');

      // ICE candidate from A to B
      const candidatePromise = new Promise((resolve) => {
        clientB.on('webrtc:ice-candidate', resolve);
      });

      const candidateRes = await new Promise((resolve) => {
        clientA.emit(
          'webrtc:ice-candidate',
          {
            targetUserId: userBId,
            candidate: { candidate: 'candidate:12345 1 udp 16777215 127.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 }
          },
          resolve
        );
      });
      assert.strictEqual(candidateRes.success, true);

      const receivedCandidate = await candidatePromise;
      assert.strictEqual(receivedCandidate.senderUserId, userAId);
      assert.strictEqual(receivedCandidate.candidate.candidate, 'candidate:12345 1 udp 16777215 127.0.0.1 5000 typ host');

      clientA.disconnect();
      clientB.disconnect();
    });
  });

  describe('3. Security, Anti-Spoofing & Room Isolation', () => {
    it('ignores client-supplied senderUserId and senderDisplayName in payload', async () => {
      const { room } = roomService.createRoom({ name: 'Spoof Room', mode: 'youtube', displayName: 'HostAlice' });

      const clientA = createClient();
      const clientB = createClient();
      await new Promise((resolve) => clientA.on('connect', resolve));
      await new Promise((resolve) => clientB.on('connect', resolve));

      const joinARes = await new Promise((resolve) => {
        clientA.emit('room:join', { roomId: room.id, displayName: 'Alice' }, resolve);
      });
      const joinBRes = await new Promise((resolve) => {
        clientB.emit('room:join', { roomId: room.id, displayName: 'Bob' }, resolve);
      });

      const offerPromise = new Promise((resolve) => {
        clientB.on('webrtc:offer', resolve);
      });

      await new Promise((resolve) => {
        clientA.emit(
          'webrtc:offer',
          {
            targetUserId: joinBRes.data.user.id,
            senderUserId: 'fake-admin-id',
            senderDisplayName: 'SuperAdmin',
            sdp: { type: 'offer', sdp: 'v=0\r\no=- 111 2 IN IP4 127.0.0.1' }
          },
          resolve
        );
      });

      const offer = await offerPromise;
      assert.strictEqual(offer.senderUserId, joinARes.data.user.id);
      assert.strictEqual(offer.senderDisplayName, 'Alice');

      clientA.disconnect();
      clientB.disconnect();
    });

    it('rejects WebRTC signaling targeting a user in another room', async () => {
      const roomA = roomService.createRoom({ name: 'Room A', mode: 'youtube', displayName: 'HostAlice' }).room;
      const roomB = roomService.createRoom({ name: 'Room B', mode: 'youtube', displayName: 'HostBob' }).room;

      const clientA = createClient();
      const clientB = createClient();
      await new Promise((resolve) => clientA.on('connect', resolve));
      await new Promise((resolve) => clientB.on('connect', resolve));

      await new Promise((resolve) => clientA.emit('room:join', { roomId: roomA.id, displayName: 'ClientAlice' }, resolve));
      const joinBRes = await new Promise((resolve) => clientB.emit('room:join', { roomId: roomB.id, displayName: 'ClientBob' }, resolve));

      const res = await new Promise((resolve) => {
        clientA.emit(
          'webrtc:offer',
          {
            targetUserId: joinBRes.data.user.id,
            sdp: { type: 'offer', sdp: 'v=0\r\no=- 222 2 IN IP4 127.0.0.1' }
          },
          resolve
        );
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.code, ERROR_CODES.PEER_NOT_IN_ROOM);

      clientA.disconnect();
      clientB.disconnect();
    });

    it('rejects WebRTC signaling from a client not in a room', async () => {
      const client = createClient();
      await new Promise((resolve) => client.on('connect', resolve));

      const res = await new Promise((resolve) => {
        client.emit(
          'webrtc:offer',
          {
            targetUserId: 'some-user',
            sdp: { type: 'offer', sdp: 'v=0' }
          },
          resolve
        );
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.code, ERROR_CODES.NOT_ROOM_MEMBER);

      client.disconnect();
    });
  });

  describe('4. Validation Bounds & File Metadata Signaling', () => {
    it('rejects oversized SDP payloads exceeding 32KB', async () => {
      const { room } = roomService.createRoom({ name: 'SDP Bound Room', mode: 'youtube', displayName: 'Host' });
      const clientA = createClient();
      const clientB = createClient();
      await new Promise((resolve) => clientA.on('connect', resolve));
      await new Promise((resolve) => clientB.on('connect', resolve));

      await new Promise((resolve) => clientA.emit('room:join', { roomId: room.id, displayName: 'Alice' }, resolve));
      const joinBRes = await new Promise((resolve) => clientB.emit('room:join', { roomId: room.id, displayName: 'Bob' }, resolve));

      const hugeSdp = 'X'.repeat(32769);
      const res = await new Promise((resolve) => {
        clientA.emit(
          'webrtc:offer',
          {
            targetUserId: joinBRes.data.user.id,
            sdp: { type: 'offer', sdp: hugeSdp }
          },
          resolve
        );
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.code, ERROR_CODES.INVALID_WEBRTC_SIGNAL);

      clientA.disconnect();
      clientB.disconnect();
    });

    it('validates file metadata and signals webrtc:file-offer to target peer', async () => {
      const { room } = roomService.createRoom({ name: 'File Share Room', mode: 'youtube', displayName: 'Host' });
      const clientA = createClient();
      const clientB = createClient();
      await new Promise((resolve) => clientA.on('connect', resolve));
      await new Promise((resolve) => clientB.on('connect', resolve));

      const joinARes = await new Promise((resolve) => clientA.emit('room:join', { roomId: room.id, displayName: 'Alice' }, resolve));
      const joinBRes = await new Promise((resolve) => clientB.emit('room:join', { roomId: room.id, displayName: 'Bob' }, resolve));

      const fileOfferPromise = new Promise((resolve) => {
        clientB.on('webrtc:file-offer', resolve);
      });

      const res = await new Promise((resolve) => {
        clientA.emit(
          'webrtc:file-metadata',
          {
            targetUserId: joinBRes.data.user.id,
            fileId: 'file-123',
            name: 'movie.mp4',
            size: 50000000,
            mimeType: 'video/mp4'
          },
          resolve
        );
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.fileId, 'file-123');

      const fileOffer = await fileOfferPromise;
      assert.strictEqual(fileOffer.senderUserId, joinARes.data.user.id);
      assert.strictEqual(fileOffer.senderDisplayName, 'Alice');
      assert.strictEqual(fileOffer.name, 'movie.mp4');
      assert.strictEqual(fileOffer.size, 50000000);
      assert.strictEqual(fileOffer.mimeType, 'video/mp4');

      clientA.disconnect();
      clientB.disconnect();
    });

    it('rejects invalid file metadata (negative size or size > 10GB)', async () => {
      const { room } = roomService.createRoom({ name: 'Invalid File Room', mode: 'youtube', displayName: 'Host' });
      const client = createClient();
      await new Promise((resolve) => client.on('connect', resolve));
      await new Promise((resolve) => client.emit('room:join', { roomId: room.id, displayName: 'Alice' }, resolve));

      const res1 = await new Promise((resolve) => {
        client.emit('webrtc:file-metadata', { name: 'test.txt', size: -100, mimeType: 'text/plain' }, resolve);
      });
      assert.strictEqual(res1.success, false);
      assert.strictEqual(res1.error.code, ERROR_CODES.INVALID_FILE_METADATA);

      const res2 = await new Promise((resolve) => {
        client.emit('webrtc:file-metadata', { name: 'huge.iso', size: 20000000000, mimeType: 'application/x-iso' }, resolve);
      });
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res2.error.code, ERROR_CODES.INVALID_FILE_METADATA);

      client.disconnect();
    });
  });

  describe('5. Peer Cleanup & Disconnect', () => {
    it('emits webrtc:peer-left when a peer leaves the room', async () => {
      const { room } = roomService.createRoom({ name: 'Peer Cleanup Room', mode: 'youtube', displayName: 'Host' });
      const clientA = createClient();
      const clientB = createClient();
      await new Promise((resolve) => clientA.on('connect', resolve));
      await new Promise((resolve) => clientB.on('connect', resolve));

      const joinARes = await new Promise((resolve) => clientA.emit('room:join', { roomId: room.id, displayName: 'Alice' }, resolve));
      await new Promise((resolve) => clientB.emit('room:join', { roomId: room.id, displayName: 'Bob' }, resolve));

      const peerLeftPromise = new Promise((resolve) => {
        clientB.on('webrtc:peer-left', resolve);
      });

      await new Promise((resolve) => clientA.emit('room:leave', {}, resolve));

      const peerLeftEvent = await peerLeftPromise;
      assert.strictEqual(peerLeftEvent.userId, joinARes.data.user.id);

      clientA.disconnect();
      clientB.disconnect();
    });
  });
});
