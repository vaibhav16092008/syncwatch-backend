import crypto from 'node:crypto';
import roomStorage from '../storage/room.storage.js';
import { validateChatMessage } from '../validators/chat.validator.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export class ChatService {
  addMessage({ roomId, userId, message }) {
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
      throw new AppError('You must be a connected member of the room to send messages', 403, ERROR_CODES.NOT_ROOM_MEMBER);
    }

    const sanitizedText = validateChatMessage(message);
    const messageId = crypto.randomUUID();
    const createdAt = Date.now();

    const chatMessage = {
      id: messageId,
      roomId: room.id,
      userId: user.userId || user.id,
      displayName: user.displayName,
      message: sanitizedText,
      createdAt
    };

    roomStorage.updateRoom(normalizedId, (r) => {
      if (!Array.isArray(r.messages)) {
        r.messages = [];
      }
      r.messages.push(chatMessage);
      if (r.messages.length > 100) {
        r.messages.shift();
      }
      return r;
    });

    return chatMessage;
  }

  getChatHistory(roomId, userId) {
    if (!roomId) {
      throw new AppError('Room ID is required', 400, ERROR_CODES.VALIDATION_ERROR);
    }
    const normalizedId = roomStorage.normalizeRoomId(roomId);
    const room = roomStorage.getRoom(normalizedId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    if (userId) {
      const user = room.users.find((u) => (u.userId === userId || u.id === userId) && u.connected !== false);
      if (!user) {
        throw new AppError('You must be a member of the room to view chat history', 403, ERROR_CODES.NOT_ROOM_MEMBER);
      }
    }

    return room.messages || [];
  }
}

export const chatService = new ChatService();
export default chatService;
