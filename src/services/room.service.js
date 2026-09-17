import crypto from 'node:crypto';
import roomStorage from '../storage/room.storage.js';
import mediaService from './media.service.js';
import permissionService from './permission.service.js';
import webrtcService from './webrtc.service.js';
import reconnectionService from './reconnection.service.js';
import generateRoomCode from '../utils/room-code.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';
import {
  createRoomSchema,
  joinRoomSchema,
  reconnectRoomSchema,
  transferHostSchema,
  lockRoomSchema,
  roomIdSchema,
  validate
} from '../validators/room.validator.js';

export class RoomService {
  createRoom({ name, mode, displayName }) {
    const validatedData = validate(createRoomSchema, { name, mode, displayName });

    const roomId = generateRoomCode((code) => !roomStorage.hasRoom(code));
    const hostUserId = crypto.randomUUID();
    const reconnectToken = crypto.randomUUID();

    const hostUser = {
      id: hostUserId,
      userId: hostUserId,
      displayName: validatedData.displayName,
      role: 'host',
      socketId: null,
      reconnectToken,
      joinedAt: Date.now(),
      connected: true,
      disconnectedAt: null
    };

    const room = roomStorage.createRoom(roomId, {
      name: validatedData.name,
      mode: validatedData.mode,
      locked: false,
      maxUsers: 10,
      hostUserId,
      users: [hostUser],
      media: null,
      messages: [],
      createdAt: Date.now(),
      emptySince: null
    });

    return {
      room: this.getPublicRoomState(room.id),
      hostUserId,
      user: hostUser
    };
  }

  getPublicRoomInfo(roomId) {
    const normalizedRoomId = validate(roomIdSchema, roomId, ERROR_CODES.INVALID_ROOM_CODE);
    const room = roomStorage.getRoom(normalizedRoomId);

    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    const connectedUsers = room.users.filter((u) => u.connected !== false);

    return {
      id: room.id,
      roomId: room.id,
      name: room.name,
      mode: room.mode,
      locked: room.locked,
      maxUsers: room.maxUsers,
      userCount: connectedUsers.length
    };
  }

  getPublicRoomState(roomId) {
    const normalizedId = roomStorage.normalizeRoomId(roomId);
    const room = roomStorage.getRoom(normalizedId);

    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    const connectedUsers = room.users.filter((u) => u.connected !== false);

    return {
      id: room.id,
      roomId: room.id,
      name: room.name,
      mode: room.mode,
      locked: room.locked,
      maxUsers: room.maxUsers,
      hostId: room.hostUserId,
      users: room.users.map((u) => ({
        id: u.id || u.userId,
        userId: u.userId || u.id,
        name: u.displayName,
        displayName: u.displayName,
        role: u.role,
        reconnectToken: u.reconnectToken,
        joinedAt: u.joinedAt,
        connected: u.connected !== false
      })),
      userCount: connectedUsers.length,
      media: mediaService.getMediaState(room.id),
      emptySince: room.emptySince
    };
  }

  joinRoom({ roomId, displayName, socketId }) {
    const validated = validate(joinRoomSchema, { roomId, displayName });
    const normalizedRoomId = validated.roomId;

    const room = roomStorage.getRoom(normalizedRoomId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    if (room.locked) {
      throw new AppError('Room is locked', 403, ERROR_CODES.ROOM_LOCKED);
    }

    const activeUsers = room.users.filter((u) => u.connected !== false);
    if (activeUsers.length >= room.maxUsers) {
      throw new AppError('Room is full', 400, ERROR_CODES.ROOM_FULL);
    }

    // Check duplicate display name within this room
    const isDuplicate = activeUsers.some(
      (u) => u.displayName.toLowerCase() === validated.displayName.toLowerCase()
    );
    if (isDuplicate) {
      throw new AppError('Display name is already taken in this room', 400, ERROR_CODES.INVALID_DISPLAY_NAME);
    }

    const userId = crypto.randomUUID();
    const reconnectToken = crypto.randomUUID();

    const newUser = {
      id: userId,
      userId,
      displayName: validated.displayName,
      role: 'member',
      socketId,
      reconnectToken,
      joinedAt: Date.now(),
      connected: true,
      disconnectedAt: null
    };

    const updatedRoom = roomStorage.updateRoom(normalizedRoomId, (r) => {
      r.users.push(newUser);
      r.emptySince = null;
      return r;
    });

    return {
      user: {
        id: userId,
        userId,
        displayName: newUser.displayName,
        role: newUser.role,
        reconnectToken: newUser.reconnectToken,
        joinedAt: newUser.joinedAt,
        connected: true
      },
      room: this.getPublicRoomState(updatedRoom.id)
    };
  }

  reconnectUser({ roomId, userId, reconnectToken, newSocketId }) {
    const validated = validate(reconnectRoomSchema, { roomId, userId, reconnectToken });
    const normalizedRoomId = validated.roomId;

    const room = roomStorage.getRoom(normalizedRoomId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    const user = room.users.find((u) => (u.userId === validated.userId || u.id === validated.userId));
    if (!user) {
      throw new AppError('Session expired or user not in room', 400, ERROR_CODES.SESSION_EXPIRED);
    }

    // Token & identity anti-spoofing security checks:
    if (user.reconnectToken !== validated.reconnectToken) {
      throw new AppError('Invalid reconnect token', 403, ERROR_CODES.INVALID_RECONNECT_TOKEN);
    }

    if ((user.userId || user.id) !== validated.userId) {
      throw new AppError('User ID mismatch', 403, ERROR_CODES.INVALID_RECONNECT_TOKEN);
    }

    if (room.id !== normalizedRoomId) {
      throw new AppError('Room ID mismatch', 403, ERROR_CODES.INVALID_RECONNECT_TOKEN);
    }

    // Cancel grace period timer
    reconnectionService.cancelGracePeriod({ roomId: room.id, userId: user.userId || user.id });

    // Update user state to connected
    const updatedRoom = roomStorage.updateRoom(normalizedRoomId, (r) => {
      const u = r.users.find((usr) => (usr.userId === validated.userId || usr.id === validated.userId));
      if (u) {
        u.socketId = newSocketId;
        u.connected = true;
        u.disconnectedAt = null;
      }
      r.emptySince = null;
      return r;
    });

    const targetUser = updatedRoom.users.find((u) => (u.userId === validated.userId || u.id === validated.userId));

    return {
      user: {
        id: targetUser.id || targetUser.userId,
        userId: targetUser.userId || targetUser.id,
        displayName: targetUser.displayName,
        role: targetUser.role,
        reconnectToken: targetUser.reconnectToken,
        joinedAt: targetUser.joinedAt,
        connected: true
      },
      room: this.getPublicRoomState(updatedRoom.id)
    };
  }

  leaveRoom({ roomId, userId, socketId }) {
    let targetRoomId = roomId;
    let targetUserId = userId;

    if ((!targetRoomId || !targetUserId) && socketId) {
      const found = roomStorage.findUserBySocketId(socketId);
      if (found) {
        targetRoomId = targetRoomId || found.room.id;
        targetUserId = targetUserId || found.user.userId || found.user.id;
      }
    }

    if (!targetRoomId) return null;

    const normalizedRoomId = roomStorage.normalizeRoomId(targetRoomId);
    const room = roomStorage.getRoom(normalizedRoomId);
    if (!room) return null;

    if (targetUserId) {
      reconnectionService.cancelGracePeriod({ roomId: room.id, userId: targetUserId });
    }

    let leavingUserWasHost = false;

    const updatedRoom = roomStorage.updateRoom(normalizedRoomId, (r) => {
      const leavingUser = r.users.find((u) => {
        if (targetUserId && (u.userId === targetUserId || u.id === targetUserId)) return true;
        if (socketId && u.socketId === socketId) return true;
        return false;
      });

      if (leavingUser) {
        if (leavingUser.role === 'host' || r.hostUserId === leavingUser.userId || r.hostUserId === leavingUser.id) {
          leavingUserWasHost = true;
        }
        if (leavingUser.reconnectToken) {
          reconnectionService.cancelGracePeriodByToken(leavingUser.reconnectToken);
        }
      }

      r.users = r.users.filter((u) => {
        if (targetUserId && (u.userId === targetUserId || u.id === targetUserId)) return false;
        if (socketId && u.socketId === socketId) return false;
        return true;
      });

      const activeUsers = r.users.filter((u) => u.connected !== false);

      // Auto-transfer host if host leaves explicitly
      if (leavingUserWasHost) {
        if (activeUsers.length > 0) {
          const nextHost = activeUsers[0];
          const nextHostId = nextHost.userId || nextHost.id;
          r.hostUserId = nextHostId;
          r.users.forEach((u) => {
            const uId = u.userId || u.id;
            u.role = uId === nextHostId ? 'host' : 'member';
          });
        } else {
          r.hostUserId = null;
        }
      }

      if (activeUsers.length === 0) {
        r.emptySince = Date.now();
      }

      return r;
    });

    return this.getPublicRoomState(updatedRoom.id);
  }

  handleDisconnect({ socketId, onExpire }) {
    if (!socketId) return null;

    const found = roomStorage.findUserBySocketId(socketId);
    if (!found) return null;

    const { user, room } = found;
    const userId = user.userId || user.id;

    // Stale Disconnect Protection:
    // If the socketId on the stored user does not match the disconnecting socketId
    // (e.g. user already reconnected with a new socketId), ignore the stale disconnect event.
    if (user.socketId !== socketId) {
      return null;
    }

    // Mark user disconnected & set timestamp
    const updatedRoom = roomStorage.updateRoom(room.id, (r) => {
      const u = r.users.find((usr) => (usr.userId === userId || usr.id === userId));
      if (u) {
        u.connected = false;
        u.disconnectedAt = Date.now();
      }
      const activeUsers = r.users.filter((usr) => usr.connected !== false);
      if (activeUsers.length === 0) {
        r.emptySince = Date.now();
      }
      return r;
    });

    // Start 30s grace period timer
    reconnectionService.startGracePeriod({
      roomId: room.id,
      userId,
      reconnectToken: user.reconnectToken,
      onExpire: async () => {
        if (typeof onExpire === 'function') {
          await onExpire({ roomId: room.id, userId, reconnectToken: user.reconnectToken });
        }
      }
    });

    return {
      userId,
      reconnectToken: user.reconnectToken,
      room: this.getPublicRoomState(updatedRoom.id)
    };
  }

  expireUser({ roomId, userId, reconnectToken }) {
    const normalizedId = roomStorage.normalizeRoomId(roomId);
    const room = roomStorage.getRoom(normalizedId);
    if (!room) return null;

    const user = room.users.find((u) => (u.userId === userId || u.id === userId));
    if (!user) return null;

    // If user reconnected or token mismatch, ignore expiration
    if (user.connected === true || (reconnectToken && user.reconnectToken !== reconnectToken)) {
      return null;
    }

    let wasHost = user.role === 'host' || room.hostUserId === userId || room.hostUserId === user.id;

    const updatedRoom = roomStorage.updateRoom(normalizedId, (r) => {
      r.users = r.users.filter((u) => !(u.userId === userId || u.id === userId));

      const activeUsers = r.users.filter((u) => u.connected !== false);

      if (wasHost) {
        if (activeUsers.length > 0) {
          const nextHost = activeUsers[0];
          const nextHostId = nextHost.userId || nextHost.id;
          r.hostUserId = nextHostId;
          r.users.forEach((u) => {
            const uId = u.userId || u.id;
            u.role = uId === nextHostId ? 'host' : 'member';
          });
        } else {
          r.hostUserId = null;
        }
      }

      if (activeUsers.length === 0) {
        r.emptySince = Date.now();
      }

      return r;
    });

    // Clean WebRTC peer state on grace expiration
    webrtcService.removePeerFromRoom({ roomId: normalizedId, userId });

    return {
      userId,
      room: this.getPublicRoomState(updatedRoom.id)
    };
  }

  transferHost({ roomId, actingUserId, targetUserId }) {
    const validatedTarget = validate(transferHostSchema, { targetUserId });
    const normalizedRoomId = validate(roomIdSchema, roomId, ERROR_CODES.INVALID_ROOM_CODE);

    permissionService.assertPermission(normalizedRoomId, actingUserId, 'HOST_TRANSFER');

    const room = roomStorage.getRoom(normalizedRoomId);
    const targetUser = room.users.find(
      (u) => u.userId === validatedTarget.targetUserId || u.id === validatedTarget.targetUserId
    );

    if (!targetUser) {
      throw new AppError('Target user not found in room', 404, ERROR_CODES.USER_NOT_FOUND);
    }

    if (targetUser.connected === false) {
      throw new AppError('Target user is disconnected', 403, ERROR_CODES.HOST_TRANSFER_FORBIDDEN);
    }

    const updatedRoom = roomStorage.updateRoom(normalizedRoomId, (r) => {
      const targetId = targetUser.userId || targetUser.id;
      r.users.forEach((u) => {
        const uId = u.userId || u.id;
        if (uId === targetId) {
          u.role = 'host';
        } else {
          u.role = 'member';
        }
      });
      r.hostUserId = targetId;
      return r;
    });

    return this.getPublicRoomState(updatedRoom.id);
  }

  setRoomLock({ roomId, actingUserId, locked }) {
    validate(lockRoomSchema, { locked });
    const normalizedRoomId = validate(roomIdSchema, roomId, ERROR_CODES.INVALID_ROOM_CODE);

    permissionService.assertPermission(normalizedRoomId, actingUserId, 'ROOM_LOCK');

    const updatedRoom = roomStorage.updateRoom(normalizedRoomId, (r) => {
      r.locked = Boolean(locked);
      return r;
    });

    return this.getPublicRoomState(updatedRoom.id);
  }
}

export const roomService = new RoomService();
export default roomService;
