import crypto from 'node:crypto';
import roomStorage from '../storage/room.storage.js';
import { validateReactionEmoji } from '../validators/reaction.validator.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export class ReactionService {
  createReaction({ roomId, userId, emoji }) {
    if (!roomId) {
      throw new AppError('Room ID is required', 400, ERROR_CODES.VALIDATION_ERROR);
    }
    if (!userId) {
      throw new AppError('User ID is required', 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const normalizedId = roomStorage.normalizeRoomId(roomId);
    const room = roomStorage.getRoom(normalizedId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    const user = room.users.find((u) => (u.userId === userId || u.id === userId) && u.connected !== false);
    if (!user) {
      throw new AppError('You must be a connected member of the room to send reactions', 403, ERROR_CODES.NOT_ROOM_MEMBER);
    }

    const validatedEmoji = validateReactionEmoji(emoji);

    return {
      id: crypto.randomUUID(),
      roomId: room.id,
      userId: user.userId || user.id,
      displayName: user.displayName,
      emoji: validatedEmoji,
      createdAt: Date.now()
    };
  }
}

export const reactionService = new ReactionService();
export default reactionService;
