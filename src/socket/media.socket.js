import mediaService from '../services/media.service.js';
import logger from '../utils/logger.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export const registerMediaHandlers = (io, socket) => {
  const getContext = () => {
    const roomId = socket.data.roomId;
    const userId = socket.data.userId;
    if (!roomId || !userId) {
      throw new AppError('You are not currently in a room', 403, ERROR_CODES.MEDIA_CONTROL_FORBIDDEN);
    }
    return { roomId, userId };
  };

  const handleCallback = (cb, payload) => {
    if (typeof cb === 'function') cb(payload);
  };

  // media:set
  socket.on('media:set', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    const data = typeof payload === 'object' && payload !== null ? payload : {};
    try {
      const { roomId, userId } = getContext();
      const mediaState = mediaService.setMediaSource({
        roomId,
        actingUserId: userId,
        type: data.type,
        mediaId: data.mediaId
      });
      io.to(roomId).emit('media:state', mediaState);
      handleCallback(cb, { success: true, data: { media: mediaState } });
    } catch (error) {
      logger.warn('media:set failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.MEDIA_CONTROL_FORBIDDEN,
          message: error.message
        }
      });
    }
  });

  // media:play
  socket.on('media:play', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    const data = typeof payload === 'object' && payload !== null ? payload : {};
    try {
      const { roomId, userId } = getContext();
      const mediaState = mediaService.playMedia({
        roomId,
        actingUserId: userId,
        position: data.position
      });
      io.to(roomId).emit('media:state', mediaState);
      handleCallback(cb, { success: true, data: { media: mediaState } });
    } catch (error) {
      logger.warn('media:play failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.MEDIA_CONTROL_FORBIDDEN,
          message: error.message
        }
      });
    }
  });

  // media:pause
  socket.on('media:pause', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    const data = typeof payload === 'object' && payload !== null ? payload : {};
    try {
      const { roomId, userId } = getContext();
      const mediaState = mediaService.pauseMedia({
        roomId,
        actingUserId: userId,
        position: data.position
      });
      io.to(roomId).emit('media:state', mediaState);
      handleCallback(cb, { success: true, data: { media: mediaState } });
    } catch (error) {
      logger.warn('media:pause failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.MEDIA_CONTROL_FORBIDDEN,
          message: error.message
        }
      });
    }
  });

  // media:seek
  socket.on('media:seek', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    const data = typeof payload === 'object' && payload !== null ? payload : {};
    try {
      const { roomId, userId } = getContext();
      const mediaState = mediaService.seekMedia({
        roomId,
        actingUserId: userId,
        position: data.position
      });
      io.to(roomId).emit('media:state', mediaState);
      handleCallback(cb, { success: true, data: { media: mediaState } });
    } catch (error) {
      logger.warn('media:seek failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.MEDIA_CONTROL_FORBIDDEN,
          message: error.message
        }
      });
    }
  });

  // media:rate
  socket.on('media:rate', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    const data = typeof payload === 'object' && payload !== null ? payload : {};
    try {
      const { roomId, userId } = getContext();
      const mediaState = mediaService.setPlaybackRate({
        roomId,
        actingUserId: userId,
        playbackRate: data.playbackRate
      });
      io.to(roomId).emit('media:state', mediaState);
      handleCallback(cb, { success: true, data: { media: mediaState } });
    } catch (error) {
      logger.warn('media:rate failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.MEDIA_CONTROL_FORBIDDEN,
          message: error.message
        }
      });
    }
  });

  // media:clear
  socket.on('media:clear', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    try {
      const { roomId, userId } = getContext();
      const mediaState = mediaService.clearMedia({
        roomId,
        actingUserId: userId
      });
      io.to(roomId).emit('media:state', mediaState);
      handleCallback(cb, { success: true, data: { media: mediaState } });
    } catch (error) {
      logger.warn('media:clear failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.MEDIA_CONTROL_FORBIDDEN,
          message: error.message
        }
      });
    }
  });
};

export default registerMediaHandlers;
