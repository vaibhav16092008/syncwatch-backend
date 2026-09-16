import crypto from 'node:crypto';
import roomStorage from '../storage/room.storage.js';
import mediaService from './media.service.js';
import permissionService from './permission.service.js';
import generateRoomCode from '../utils/room-code.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';
import {
  createRoomSchema,
  joinRoomSchema,
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

    const hostUser = {
      id: hostUserId,
      userId: hostUserId,
      displayName: validatedData.displayName,
      role: 'host',
      socketId: null,
      joinedAt: Date.now(),
      connected: true
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
    const newUser = {
      id: userId,
      userId,
      displayName: validated.displayName,
      role: 'member',
      socketId,
      joinedAt: Date.now(),
      connected: true
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
        joinedAt: newUser.joinedAt,
        connected: true
      },
      room: this.getPublicRoomState(updatedRoom.id)
    };
  }

  leaveRoom({ roomId, userId, socketId }) {
    let targetRoomId = roomId;
    if (!targetRoomId && socketId) {
      const room = roomStorage.getRoomBySocketId(socketId);
      if (room) targetRoomId = room.id;
    }

    if (!targetRoomId) return null;

    const normalizedRoomId = roomStorage.normalizeRoomId(targetRoomId);
    const room = roomStorage.getRoom(normalizedRoomId);
    if (!room) return null;

    const updatedRoom = roomStorage.updateRoom(normalizedRoomId, (r) => {
      r.users = r.users.filter((u) => {
        if (userId && (u.userId === userId || u.id === userId)) return false;
        if (socketId && u.socketId === socketId) return false;
        return true;
      });

      const activeUsers = r.users.filter((u) => u.connected !== false);
      if (activeUsers.length === 0) {
        r.emptySince = Date.now();
      }

      return r;
    });

    return this.getPublicRoomState(updatedRoom.id);
  }

  handleDisconnect({ socketId }) {
    if (!socketId) return null;

    const found = roomStorage.findUserBySocketId(socketId);
    if (!found) return null;

    const { user, room } = found;

    const updatedRoom = roomStorage.updateRoom(room.id, (r) => {
      r.users = r.users.filter((u) => u.socketId !== socketId);
      const activeUsers = r.users.filter((u) => u.connected !== false);
      if (activeUsers.length === 0) {
        r.emptySince = Date.now();
      }
      return r;
    });

    return {
      userId: user.userId || user.id,
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
