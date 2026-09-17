import roomStorage from '../storage/room.storage.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export class PresenceService {
  getPresenceState(roomId) {
    if (!roomId) {
      throw new AppError('Room ID is required', 400, ERROR_CODES.VALIDATION_ERROR);
    }
    const normalizedId = roomStorage.normalizeRoomId(roomId);
    const room = roomStorage.getRoom(normalizedId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    const activeUsers = room.users.filter((u) => u.connected !== false);

    return activeUsers.map((u) => ({
      id: u.id || u.userId,
      userId: u.userId || u.id,
      displayName: u.displayName,
      role: u.role,
      joinedAt: u.joinedAt,
      connected: true
    }));
  }
}

export const presenceService = new PresenceService();
export default presenceService;
