process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { app, httpServer, io } from '../src/server.js';
import roomStorage from '../src/storage/room.storage.js';
import roomService from '../src/services/room.service.js';
import mediaService from '../src/services/media.service.js';
import permissionService from '../src/services/permission.service.js';
import { ERROR_CODES } from '../src/utils/errors.js';

describe('Phase B4 — Permissions & Host Management Tests', () => {
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

  describe('1. Centralized Permission Service & Role Evaluation', () => {
    it('assigns host role to room creator and member role to joining users', () => {
      const createRes = roomService.createRoom({ name: 'Perm Room', mode: 'youtube', displayName: 'Creator' });
      const roomId = createRes.room.id;
      const hostId = createRes.hostUserId;

      assert.strictEqual(permissionService.getUserRole(roomId, hostId), 'host');
      assert.strictEqual(permissionService.isHost(roomId, hostId), true);

      const perms = permissionService.getUserPermissions(roomId, hostId);
      assert.deepStrictEqual(perms, {
        roomManage: true,
        roomLock: true,
        hostTransfer: true,
        mediaControl: true
      });

      // Join a member
      const joinRes = roomService.joinRoom({ roomId, displayName: 'Joiner' });
      const memberId = joinRes.user.id;

      assert.strictEqual(permissionService.getUserRole(roomId, memberId), 'member');
      assert.strictEqual(permissionService.isHost(roomId, memberId), false);

      const memberPerms = permissionService.getUserPermissions(roomId, memberId);
      assert.deepStrictEqual(memberPerms, {
        roomManage: false,
        roomLock: false,
        hostTransfer: false,
        mediaControl: false
      });
    });

    it('assertPermission succeeds for host capabilities and throws clean 403 errors for non-hosts', () => {
      const createRes = roomService.createRoom({ name: 'Assert Room', mode: 'youtube', displayName: 'Host' });
      const roomId = createRes.room.id;
      const hostId = createRes.hostUserId;

      assert.strictEqual(permissionService.assertPermission(roomId, hostId, 'HOST_TRANSFER'), true);
      assert.strictEqual(permissionService.assertPermission(roomId, hostId, 'MEDIA_CONTROL'), true);
      assert.strictEqual(permissionService.assertPermission(roomId, hostId, 'ROOM_LOCK'), true);

      const joinRes = roomService.joinRoom({ roomId, displayName: 'Member' });
      const memberId = joinRes.user.id;

      assert.throws(
        () => permissionService.assertPermission(roomId, memberId, 'HOST_TRANSFER'),
        (err) => err.code === ERROR_CODES.HOST_TRANSFER_FORBIDDEN && err.statusCode === 403
      );

      assert.throws(
        () => permissionService.assertPermission(roomId, memberId, 'MEDIA_CONTROL'),
        (err) => err.code === ERROR_CODES.MEDIA_CONTROL_FORBIDDEN && err.statusCode === 403
      );

      assert.throws(
        () => permissionService.assertPermission(roomId, memberId, 'ROOM_LOCK'),
        (err) => err.code === ERROR_CODES.FORBIDDEN && err.statusCode === 403
      );
    });

    it('throws 400 INVALID_PERMISSION when asserting an unknown permission key', () => {
      const createRes = roomService.createRoom({ name: 'Invalid Perm Room', mode: 'youtube', displayName: 'Host' });
      const roomId = createRes.room.id;
      const hostId = createRes.hostUserId;

      assert.throws(
        () => permissionService.assertPermission(roomId, hostId, 'SUPER_ADMIN'),
        (err) => err.code === ERROR_CODES.INVALID_PERMISSION && err.statusCode === 400
      );
    });
  });

  describe('2. Host Management & Transfer Edge Cases', () => {
    it('atomic host transfer: exactly one host exists, privileges transfer instantly', () => {
      const createRes = roomService.createRoom({ name: 'Transfer Room', mode: 'youtube', displayName: 'HostA' });
      const roomId = createRes.room.id;
      const hostAId = createRes.hostUserId;

      const joinRes = roomService.joinRoom({ roomId, displayName: 'UserB' });
      const userBId = joinRes.user.id;

      const updatedState = roomService.transferHost({ roomId, actingUserId: hostAId, targetUserId: userBId });

      // Check single host in room state
      const hosts = updatedState.users.filter((u) => u.role === 'host');
      assert.strictEqual(hosts.length, 1);
      assert.strictEqual(hosts[0].id, userBId);
      assert.strictEqual(updatedState.hostId, userBId);

      // Verify PermissionService reports updated roles
      assert.strictEqual(permissionService.getUserRole(roomId, hostAId), 'member');
      assert.strictEqual(permissionService.getUserRole(roomId, userBId), 'host');
    });

    it('prevents non-host from performing host transfer', () => {
      const createRes = roomService.createRoom({ name: 'Illegal Transfer', mode: 'youtube', displayName: 'Host' });
      const roomId = createRes.room.id;

      const userB = roomService.joinRoom({ roomId, displayName: 'MemberB' }).user;
      const userC = roomService.joinRoom({ roomId, displayName: 'MemberC' }).user;

      assert.throws(
        () => roomService.transferHost({ roomId, actingUserId: userB.id, targetUserId: userC.id }),
        (err) => err.code === ERROR_CODES.HOST_TRANSFER_FORBIDDEN
      );
    });

    it('rejects transfer to non-existent user or user in another room', () => {
      const roomA = roomService.createRoom({ name: 'Room A', mode: 'youtube', displayName: 'HostA' });
      const roomB = roomService.createRoom({ name: 'Room B', mode: 'youtube', displayName: 'HostB' });

      const userInB = roomService.joinRoom({ roomId: roomB.room.id, displayName: 'UserInB' }).user;

      // Transfer to non-existent user ID
      assert.throws(
        () => roomService.transferHost({ roomId: roomA.room.id, actingUserId: roomA.hostUserId, targetUserId: 'fake-uuid' }),
        (err) => err.code === ERROR_CODES.USER_NOT_FOUND
      );

      // Transfer to user belonging to Room B
      assert.throws(
        () => roomService.transferHost({ roomId: roomA.room.id, actingUserId: roomA.hostUserId, targetUserId: userInB.id }),
        (err) => err.code === ERROR_CODES.USER_NOT_FOUND
      );
    });

    it('rejects transfer to a disconnected user', () => {
      const createRes = roomService.createRoom({ name: 'Disconnect Room', mode: 'youtube', displayName: 'Host' });
      const roomId = createRes.room.id;
      const hostId = createRes.hostUserId;

      const member = roomService.joinRoom({ roomId, displayName: 'Member' }).user;

      // Simulate disconnection of member
      roomStorage.updateRoom(roomId, (r) => {
        const u = r.users.find((x) => x.id === member.id);
        if (u) u.connected = false;
        return r;
      });

      assert.throws(
        () => roomService.transferHost({ roomId, actingUserId: hostId, targetUserId: member.id }),
        (err) => err.code === ERROR_CODES.HOST_TRANSFER_FORBIDDEN
      );
    });

    it('handles repeated host transfers consistently', () => {
      const createRes = roomService.createRoom({ name: 'Multi Transfer', mode: 'youtube', displayName: 'HostA' });
      const roomId = createRes.room.id;
      const userA = createRes.hostUserId;
      const userB = roomService.joinRoom({ roomId, displayName: 'UserB' }).user.id;
      const userC = roomService.joinRoom({ roomId, displayName: 'UserC' }).user.id;

      // A -> B
      roomService.transferHost({ roomId, actingUserId: userA, targetUserId: userB });
      assert.strictEqual(permissionService.isHost(roomId, userB), true);

      // B -> C
      roomService.transferHost({ roomId, actingUserId: userB, targetUserId: userC });
      assert.strictEqual(permissionService.isHost(roomId, userC), true);
      assert.strictEqual(permissionService.isHost(roomId, userB), false);

      // C -> A
      roomService.transferHost({ roomId, actingUserId: userC, targetUserId: userA });
      assert.strictEqual(permissionService.isHost(roomId, userA), true);
      assert.strictEqual(permissionService.isHost(roomId, userC), false);
    });
  });

  describe('3. Privilege Escalation & Spoofing Protection', () => {
    it('ignores client-supplied role, hostId, or fake userId in socket payloads', async () => {
      const { room } = roomService.createRoom({ name: 'Spoof Room', mode: 'youtube', displayName: 'InitHost' });

      const memberSocket = createClient();
      await new Promise((resolve) => memberSocket.on('connect', resolve));

      const memberJoinRes = await new Promise((resolve) => {
        memberSocket.emit('room:join', { roomId: room.id, displayName: 'Attacker' }, resolve);
      });
      assert.strictEqual(memberJoinRes.success, true);

      // Attacker socket attempts to call room:lock by spoofing role or hostId in payload
      const lockRes = await new Promise((resolve) => {
        memberSocket.emit('room:lock', { role: 'host', hostId: memberJoinRes.data.user.id }, resolve);
      });

      assert.strictEqual(lockRes.success, false);
      assert.strictEqual(lockRes.error.code, ERROR_CODES.FORBIDDEN);

      // Attacker attempts to call media:set by spoofing hostUserId
      const mediaRes = await new Promise((resolve) => {
        memberSocket.emit('media:set', { type: 'youtube', mediaId: 'dQw4w9WgXcQ', actingUserId: room.hostId }, resolve);
      });

      assert.strictEqual(mediaRes.success, false);
      assert.strictEqual(mediaRes.error.code, ERROR_CODES.MEDIA_CONTROL_FORBIDDEN);

      memberSocket.disconnect();
    });

    it('prevents horizontal authorization bypass across rooms', async () => {
      const roomA = roomService.createRoom({ name: 'Room A', mode: 'youtube', displayName: 'Host A' }).room;
      const roomB = roomService.createRoom({ name: 'Room B', mode: 'youtube', displayName: 'Host B' }).room;

      const hostASocket = createClient();
      await new Promise((resolve) => hostASocket.on('connect', resolve));
      const hostAId = await joinAsHost(hostASocket, roomA.id, 'HostASocket');

      // Host A attempts to lock Room B directly via roomService (using their hostId from Room A)
      assert.throws(
        () => roomService.setRoomLock({ roomId: roomB.id, actingUserId: hostAId, locked: true }),
        (err) => err.code === ERROR_CODES.USER_NOT_FOUND || err.code === ERROR_CODES.FORBIDDEN
      );

      // Host A attempts to set media in Room B
      assert.throws(
        () => mediaService.setMediaSource({ roomId: roomB.id, actingUserId: hostAId, type: 'youtube', mediaId: 'dQw4w9WgXcQ' }),
        (err) => err.code === ERROR_CODES.USER_NOT_FOUND || err.code === ERROR_CODES.MEDIA_CONTROL_FORBIDDEN
      );

      hostASocket.disconnect();
    });
  });

  describe('4. Failure Atomicity', () => {
    it('preserves room state, permissions, and media version on failed authorization', () => {
      const { room, hostUserId } = roomService.createRoom({ name: 'Atomicity Room', mode: 'youtube', displayName: 'Host' });
      mediaService.setMediaSource({ roomId: room.id, actingUserId: hostUserId, type: 'youtube', mediaId: 'dQw4w9WgXcQ' });

      const member = roomService.joinRoom({ roomId: room.id, displayName: 'Member' }).user;
      const initialVersion = mediaService.getMediaState(room.id).version;

      // Failed media action by member
      try {
        mediaService.playMedia({ roomId: room.id, actingUserId: member.id, position: 10 });
      } catch {
        // Expected
      }

      // Failed host transfer by member
      try {
        roomService.transferHost({ roomId: room.id, actingUserId: member.id, targetUserId: member.id });
      } catch {
        // Expected
      }

      const currentState = roomService.getPublicRoomState(room.id);
      assert.strictEqual(currentState.hostId, hostUserId);
      assert.strictEqual(currentState.media.version, initialVersion);
      assert.strictEqual(permissionService.getUserRole(room.id, hostUserId), 'host');
      assert.strictEqual(permissionService.getUserRole(room.id, member.id), 'member');
    });
  });
});
