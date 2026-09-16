process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { app, httpServer, io } from '../src/server.js';
import roomStorage from '../src/storage/room.storage.js';
import { generateRoomCode } from '../src/utils/room-code.js';
import { ERROR_CODES } from '../src/utils/errors.js';

describe('Phase B2 — Room Management Tests', () => {
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

  describe('1. Room Code Generation', () => {
    it('generates a code with SYNC- prefix and 5 uppercase alphanumeric chars', () => {
      const code = generateRoomCode(() => true);
      assert.match(code, /^SYNC-[A-Z0-9]{5}$/);
    });

    it('retries until a unique code is found', () => {
      const existing = new Set(['SYNC-AAAAA', 'SYNC-BBBBB']);
      const code = generateRoomCode((c) => !existing.has(c));
      assert.ok(!existing.has(code));
      assert.match(code, /^SYNC-[A-Z0-9]{5}$/);
    });
  });

  describe('2. REST Room Creation (POST /api/rooms)', () => {
    it('successfully creates a room and returns host details', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({
          name: 'Friday Watch Party',
          mode: 'youtube',
          displayName: 'Alice'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.match(res.body.data.room.id, /^SYNC-[A-Z0-9]{5}$/);
      assert.equal(res.body.data.room.name, 'Friday Watch Party');
      assert.equal(res.body.data.room.mode, 'youtube');
      assert.equal(res.body.data.room.maxUsers, 10);
      assert.equal(res.body.data.room.userCount, 1);
      assert.ok(res.body.data.hostUserId);
      assert.equal(res.body.data.user.displayName, 'Alice');
      assert.equal(res.body.data.user.role, 'host');
    });

    it('rejects creation with missing or invalid fields', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({
          name: '',
          mode: 'invalid_mode',
          displayName: 'A'
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.ok([ERROR_CODES.VALIDATION_ERROR, ERROR_CODES.INVALID_DISPLAY_NAME].includes(res.body.error.code));
    });
  });

  describe('3. REST Public Room Lookup (GET /api/rooms/:roomId)', () => {
    it('returns public room info for an existing room', async () => {
      const createRes = await request(app)
        .post('/api/rooms')
        .send({ name: 'Sci-Fi Night', mode: 'local', displayName: 'Bob' });

      const roomId = createRes.body.data.room.id;
      const getRes = await request(app).get(`/api/rooms/${roomId}`);

      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.success, true);
      assert.equal(getRes.body.data.room.id, roomId);
      assert.equal(getRes.body.data.room.name, 'Sci-Fi Night');
      assert.equal(getRes.body.data.room.mode, 'local');
      assert.equal(getRes.body.data.room.userCount, 1);
      assert.equal(getRes.body.data.room.maxUsers, 10);
      assert.equal(getRes.body.data.room.locked, false);
      assert.equal(getRes.body.data.room.socketId, undefined);
    });

    it('returns 404 for unknown room code', async () => {
      const res = await request(app).get('/api/rooms/SYNC-99999');
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, ERROR_CODES.ROOM_NOT_FOUND);
    });

    it('returns 400 for malformed room code', async () => {
      const res = await request(app).get('/api/rooms/INVALID-CODE');
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, ERROR_CODES.INVALID_ROOM_CODE);
    });
  });

  describe('4. Socket.io Room Joining & Display Name Rules', () => {
    it('allows a user to join an existing room via Socket.io', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ name: 'Anime Night', mode: 'youtube', displayName: 'HostUser' });

      const roomId = res.body.data.room.id;
      const client = createClient();

      await new Promise((resolve) => {
        client.emit('room:join', { roomId, displayName: 'MemberOne' }, (response) => {
          assert.equal(response.success, true);
          assert.equal(response.data.user.displayName, 'MemberOne');
          assert.equal(response.data.user.role, 'member');
          assert.equal(response.data.room.userCount, 2);
          client.disconnect();
          resolve();
        });
      });
    });

    it('rejects duplicate display name inside the same room', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ name: 'Gaming Room', mode: 'youtube', displayName: 'Charlie' });

      const roomId = res.body.data.room.id;
      const client = createClient();

      await new Promise((resolve) => {
        client.emit('room:join', { roomId, displayName: 'charlie' }, (response) => {
          assert.equal(response.success, false);
          assert.equal(response.error.code, ERROR_CODES.INVALID_DISPLAY_NAME);
          client.disconnect();
          resolve();
        });
      });
    });

    it('allows same display name in different rooms', async () => {
      const [res1, res2] = await Promise.all([
        request(app).post('/api/rooms').send({ name: 'Room 1', mode: 'youtube', displayName: 'Dave' }),
        request(app).post('/api/rooms').send({ name: 'Room 2', mode: 'youtube', displayName: 'Host2' })
      ]);

      const room2Id = res2.body.data.room.id;
      const client = createClient();

      await new Promise((resolve) => {
        client.emit('room:join', { roomId: room2Id, displayName: 'Dave' }, (response) => {
          assert.equal(response.success, true);
          assert.equal(response.data.user.displayName, 'Dave');
          client.disconnect();
          resolve();
        });
      });
    });
  });

  describe('5. Room Capacity (10-user limit)', () => {
    it('enforces maximum 10 connected users limit', async () => {
      const createRes = await request(app)
        .post('/api/rooms')
        .send({ name: 'Full Party', mode: 'youtube', displayName: 'User0' });
      const roomId = createRes.body.data.room.id;

      const clients = [];

      for (let i = 1; i <= 9; i++) {
        const client = createClient();
        clients.push(client);
        await new Promise((resolve) => {
          client.emit('room:join', { roomId, displayName: `User${i}` }, resolve);
        });
      }

      const overflowClient = createClient();
      clients.push(overflowClient);
      const res11 = await new Promise((resolve) => {
        overflowClient.emit('room:join', { roomId, displayName: 'User10' }, resolve);
      });

      assert.equal(res11.success, false);
      assert.equal(res11.error.code, ERROR_CODES.ROOM_FULL);

      clients.forEach((c) => c.disconnect());
    });
  });

  describe('6. Room Locking & Unlocking', () => {
    it('allows host to lock and unlock room, and prevents new joins when locked', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ name: 'Private Talk', mode: 'youtube', displayName: 'HostEve' });

      const roomId = res.body.data.room.id;
      const hostClient = createClient();

      await new Promise((resolve) => {
        hostClient.emit('room:join', { roomId, displayName: 'HostEveConnect' }, () => {
          const room = roomStorage.getRoom(roomId);
          const u = room.users.find((x) => x.displayName === 'HostEveConnect');
          roomStorage.updateRoom(roomId, (r) => {
            r.hostUserId = u.id;
            r.users.find((x) => x.id === u.id).role = 'host';
            return r;
          });

          hostClient.emit('room:lock', (lockRes) => {
            assert.equal(lockRes.success, true);
            assert.equal(lockRes.data.room.locked, true);

            const memberClient = createClient();
            memberClient.emit('room:join', { roomId, displayName: 'LateMember' }, (joinRes) => {
              assert.equal(joinRes.success, false);
              assert.equal(joinRes.error.code, ERROR_CODES.ROOM_LOCKED);

              hostClient.emit('room:unlock', (unlockRes) => {
                assert.equal(unlockRes.success, true);
                assert.equal(unlockRes.data.room.locked, false);

                memberClient.emit('room:join', { roomId, displayName: 'LateMember' }, (retryRes) => {
                  assert.equal(retryRes.success, true);
                  hostClient.disconnect();
                  memberClient.disconnect();
                  resolve();
                });
              });
            });
          });
        });
      });
    });

    it('prevents non-host from locking the room', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ name: 'Open Room', mode: 'youtube', displayName: 'RealHost' });

      const roomId = res.body.data.room.id;
      const memberClient = createClient();

      await new Promise((resolve) => {
        memberClient.emit('room:join', { roomId, displayName: 'SneakyMember' }, () => {
          memberClient.emit('room:lock', (lockRes) => {
            assert.equal(lockRes.success, false);
            assert.equal(lockRes.error.code, ERROR_CODES.FORBIDDEN);
            memberClient.disconnect();
            resolve();
          });
        });
      });
    });
  });

  describe('7. Manual Host Transfer', () => {
    it('allows host to transfer host role to an existing member', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ name: 'Leadership Room', mode: 'youtube', displayName: 'CreatorHost' });

      const roomId = res.body.data.room.id;
      const hostClient = createClient();
      const memberClient = createClient();

      await new Promise((resolve) => {
        hostClient.emit('room:join', { roomId, displayName: 'HostSocket' }, () => {
          const room = roomStorage.getRoom(roomId);
          const hostUser = room.users.find((x) => x.displayName === 'HostSocket');
          roomStorage.updateRoom(roomId, (r) => {
            r.hostUserId = hostUser.id;
            r.users.find((x) => x.id === hostUser.id).role = 'host';
            return r;
          });

          memberClient.emit('room:join', { roomId, displayName: 'NewHostCandidate' }, (memberJoinRes) => {
            assert.equal(memberJoinRes.success, true);
            const candidateUserId = memberJoinRes.data.user.id;

            hostClient.emit('room:transfer-host', { targetUserId: candidateUserId }, (transferRes) => {
              assert.equal(transferRes.success, true);
              assert.equal(transferRes.data.room.hostId, candidateUserId);

              const newHostUser = transferRes.data.room.users.find((u) => u.id === candidateUserId);
              assert.equal(newHostUser.role, 'host');

              hostClient.disconnect();
              memberClient.disconnect();
              resolve();
            });
          });
        });
      });
    });
  });

  describe('8. Room Leaving & Disconnect Lifecycle', () => {
    it('removes user cleanly on room:leave', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ name: 'Leave Room', mode: 'youtube', displayName: 'HostLeaver' });

      const roomId = res.body.data.room.id;
      const client = createClient();

      await new Promise((resolve) => {
        client.emit('room:join', { roomId, displayName: 'ShortStayUser' }, () => {
          client.emit('room:leave', (leaveRes) => {
            assert.equal(leaveRes.success, true);
            const roomInfo = roomStorage.getRoom(roomId);
            assert.equal(roomInfo.users.some((u) => u.displayName === 'ShortStayUser'), false);
            client.disconnect();
            resolve();
          });
        });
      });
    });

    it('updates room state on client disconnect', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ name: 'Disconnect Test', mode: 'youtube', displayName: 'HostDisconnect' });

      const roomId = res.body.data.room.id;
      const client = createClient();

      await new Promise((resolve) => {
        client.emit('room:join', { roomId, displayName: 'TempGuest' }, () => {
          client.disconnect();
          setTimeout(() => {
            const roomInfo = roomStorage.getRoom(roomId);
            assert.equal(roomInfo.users.some((u) => u.displayName === 'TempGuest'), false);
            resolve();
          }, 100);
        });
      });
    });
  });
});
