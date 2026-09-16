import roomStorage from '../storage/room.storage.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export class PermissionService {
  normalizePermissionKey(permission) {
    if (typeof permission !== 'string') return '';
    const keyMap = {
      'ROOM_MANAGE': 'roomManage',
      'roomManage': 'roomManage',
      'ROOM_LOCK': 'roomLock',
      'roomLock': 'roomLock',
      'HOST_TRANSFER': 'hostTransfer',
      'hostTransfer': 'hostTransfer',
      'MEDIA_CONTROL': 'mediaControl',
      'mediaControl': 'mediaControl'
    };
    return keyMap[permission] || permission;
  }

  getRolePermissions(role) {
    if (role === 'host') {
      return {
        roomManage: true,
        roomLock: true,
        hostTransfer: true,
        mediaControl: true
      };
    }
    return {
      roomManage: false,
      roomLock: false,
      hostTransfer: false,
      mediaControl: false
    };
  }

  getUserRole(roomId, userId) {
    if (!roomId || !userId) {
      throw new AppError('Room ID and User ID are required', 400, ERROR_CODES.VALIDATION_ERROR);
    }
    const normalizedId = roomStorage.normalizeRoomId(roomId);
    const room = roomStorage.getRoom(normalizedId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }
    const user = room.users.find((u) => u.userId === userId || u.id === userId);
    if (!user) {
      throw new AppError('User not found in room', 404, ERROR_CODES.USER_NOT_FOUND);
    }
    const isHostUser = room.hostUserId === userId || room.hostUserId === user.id || user.role === 'host';
    return isHostUser ? 'host' : 'member';
  }

  getUserPermissions(roomId, userId) {
    const role = this.getUserRole(roomId, userId);
    return this.getRolePermissions(role);
  }

  isHost(roomId, userId) {
    try {
      return this.getUserRole(roomId, userId) === 'host';
    } catch {
      return false;
    }
  }

  hasPermission(roomId, userId, permission) {
    if (!roomId || !userId || !permission) return false;
    try {
      const perms = this.getUserPermissions(roomId, userId);
      const permKey = this.normalizePermissionKey(permission);
      return Boolean(perms[permKey]);
    } catch {
      return false;
    }
  }

  assertPermission(roomId, userId, permission) {
    if (!roomId) {
      throw new AppError('Room ID is required', 400, ERROR_CODES.VALIDATION_ERROR);
    }
    const normalizedId = roomStorage.normalizeRoomId(roomId);
    const room = roomStorage.getRoom(normalizedId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    if (!userId) {
      throw new AppError('User ID is required', 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const permKey = this.normalizePermissionKey(permission);
    const validKeys = ['roomManage', 'roomLock', 'hostTransfer', 'mediaControl'];
    if (!validKeys.includes(permKey)) {
      throw new AppError(`Invalid permission: ${permission}`, 400, ERROR_CODES.INVALID_PERMISSION);
    }

    if (!this.hasPermission(roomId, userId, permission)) {
      if (permKey === 'hostTransfer') {
        throw new AppError('Only the host can transfer host status', 403, ERROR_CODES.HOST_TRANSFER_FORBIDDEN);
      }
      if (permKey === 'mediaControl') {
        throw new AppError('Only the host can control media playback', 403, ERROR_CODES.MEDIA_CONTROL_FORBIDDEN);
      }
      if (permKey === 'roomLock' || permKey === 'roomManage') {
        throw new AppError('Only the host can lock or unlock the room', 403, ERROR_CODES.FORBIDDEN);
      }
      throw new AppError('Permission denied', 403, ERROR_CODES.PERMISSION_DENIED);
    }

    return true;
  }
}

export const permissionService = new PermissionService();
export default permissionService;
