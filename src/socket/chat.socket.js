import chatService from '../services/chat.service.js';
import logger from '../utils/logger.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export const registerChatHandlers = (io, socket) => {
  const getContext = () => {
    const roomId = socket.data.roomId;
    const userId = socket.data.userId;
    if (!roomId || !userId) {
      throw new AppError('You must be in a room to send chat messages', 403, ERROR_CODES.NOT_ROOM_MEMBER);
    }
    return { roomId, userId };
  };

  const handleCallback = (cb, payload) => {
    if (typeof cb === 'function') cb(payload);
  };

  socket.on('chat:send', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    const data = typeof payload === 'object' && payload !== null ? payload : {};
    try {
      const { roomId, userId } = getContext();
      const message = chatService.addMessage({
        roomId,
        userId,
        message: data.message
      });

      io.to(roomId).emit('chat:message', message);
      handleCallback(cb, { success: true, data: { message } });
    } catch (error) {
      logger.warn('chat:send failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.INVALID_CHAT_MESSAGE,
          message: error.message
        }
      });
    }
  });
};

export default registerChatHandlers;
