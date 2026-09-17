import reactionService from '../services/reaction.service.js';
import logger from '../utils/logger.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export const registerReactionHandlers = (io, socket) => {
  const getContext = () => {
    const roomId = socket.data.roomId;
    const userId = socket.data.userId;
    if (!roomId || !userId) {
      throw new AppError('You must be in a room to send reactions', 403, ERROR_CODES.NOT_ROOM_MEMBER);
    }
    return { roomId, userId };
  };

  const handleCallback = (cb, payload) => {
    if (typeof cb === 'function') cb(payload);
  };

  socket.on('reaction:send', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    const data = typeof payload === 'object' && payload !== null ? payload : {};
    try {
      const { roomId, userId } = getContext();
      const reaction = reactionService.createReaction({
        roomId,
        userId,
        emoji: data.emoji
      });

      io.to(roomId).emit('reaction:event', reaction);
      handleCallback(cb, { success: true, data: { reaction } });
    } catch (error) {
      logger.warn('reaction:send failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.INVALID_REACTION,
          message: error.message
        }
      });
    }
  });
};

export default registerReactionHandlers;
