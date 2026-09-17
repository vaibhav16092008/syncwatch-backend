import roomService from '../services/room.service.js';
import mediaService from '../services/media.service.js';
import chatService from '../services/chat.service.js';
import presenceService from '../services/presence.service.js';
import webrtcService from '../services/webrtc.service.js';
import logger from '../utils/logger.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export const registerRoomHandlers = (io, socket) => {
  // room:join
  socket.on('room:join', (payload = {}, callback = () => {}) => {
    try {
      const { roomId, displayName } = payload;
      const result = roomService.joinRoom({ roomId, displayName, socketId: socket.id });

      socket.data.roomId = result.room.id;
      socket.data.userId = result.user.id;

      socket.join(result.room.id);

      // Late Join Synchronization: send current authoritative media state to joining socket
      const mediaState = mediaService.getMediaState(result.room.id);
      socket.emit('media:state', mediaState);

      // Late Join Synchronization: send chat history to joining socket
      const chatHistory = chatService.getChatHistory(result.room.id, result.user.id);
      socket.emit('chat:history', { messages: chatHistory });

      // Presence state update broadcast
      const presenceUsers = presenceService.getPresenceState(result.room.id);
      io.to(result.room.id).emit('presence:state', { users: presenceUsers });

      // Broadcast to room
      socket.to(result.room.id).emit('room:user-joined', { user: result.user });
      io.to(result.room.id).emit('room:state', result.room);

      callback({
        success: true,
        data: {
          user: result.user,
          room: result.room
        }
      });
    } catch (error) {
      logger.warn('room:join failed', { socketId: socket.id, error: error.message });
      callback({
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || 'Failed to join room'
        }
      });
    }
  });

  // room:leave
  socket.on('room:leave', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback || (() => {});
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;

      if (!roomId || !userId) {
        cb({ success: true });
        return;
      }

      socket.leave(roomId);
      const updatedState = roomService.leaveRoom({ roomId, userId, socketId: socket.id });

      delete socket.data.roomId;
      delete socket.data.userId;

      if (updatedState) {
        webrtcService.removePeerFromRoom({ roomId, userId });
        socket.to(roomId).emit('room:user-left', { userId });
        socket.to(roomId).emit('webrtc:peer-left', { userId });
        io.to(roomId).emit('room:state', updatedState);

        const presenceUsers = presenceService.getPresenceState(roomId);
        io.to(roomId).emit('presence:state', { users: presenceUsers });
      }

      cb({ success: true });
    } catch (error) {
      logger.warn('room:leave failed', { socketId: socket.id, error: error.message });
      cb({
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message
        }
      });
    }
  });

  // room:lock
  socket.on('room:lock', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback || (() => {});
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;

      if (!roomId || !userId) {
        throw new AppError('You are not currently in a room', 403, ERROR_CODES.FORBIDDEN);
      }

      const updatedState = roomService.setRoomLock({ roomId, actingUserId: userId, locked: true });
      io.to(roomId).emit('room:state', updatedState);

      cb({
        success: true,
        data: { room: updatedState }
      });
    } catch (error) {
      logger.warn('room:lock failed', { socketId: socket.id, error: error.message });
      cb({
        success: false,
        error: {
          code: error.code || ERROR_CODES.FORBIDDEN,
          message: error.message
        }
      });
    }
  });

  // room:unlock
  socket.on('room:unlock', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback || (() => {});
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;

      if (!roomId || !userId) {
        throw new AppError('You are not currently in a room', 403, ERROR_CODES.FORBIDDEN);
      }

      const updatedState = roomService.setRoomLock({ roomId, actingUserId: userId, locked: false });
      io.to(roomId).emit('room:state', updatedState);

      cb({
        success: true,
        data: { room: updatedState }
      });
    } catch (error) {
      logger.warn('room:unlock failed', { socketId: socket.id, error: error.message });
      cb({
        success: false,
        error: {
          code: error.code || ERROR_CODES.FORBIDDEN,
          message: error.message
        }
      });
    }
  });

  // room:transfer-host
  socket.on('room:transfer-host', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback || (() => {});
    try {
      const roomId = socket.data.roomId;
      const actingUserId = socket.data.userId;
      const { targetUserId } = typeof payload === 'object' && payload !== null ? payload : {};

      if (!roomId || !actingUserId) {
        throw new AppError('You are not currently in a room', 403, ERROR_CODES.HOST_TRANSFER_FORBIDDEN);
      }

      const updatedState = roomService.transferHost({ roomId, actingUserId, targetUserId });
      io.to(roomId).emit('room:state', updatedState);

      cb({
        success: true,
        data: { room: updatedState }
      });
    } catch (error) {
      logger.warn('room:transfer-host failed', { socketId: socket.id, error: error.message });
      cb({
        success: false,
        error: {
          code: error.code || ERROR_CODES.HOST_TRANSFER_FORBIDDEN,
          message: error.message
        }
      });
    }
  });

  // disconnect
  socket.on('disconnect', () => {
    try {
      const result = roomService.handleDisconnect({ socketId: socket.id });
      if (result) {
        const { userId, room } = result;
        webrtcService.removePeerFromRoom({ roomId: room.id, userId });
        io.to(room.id).emit('room:user-left', { userId });
        io.to(room.id).emit('webrtc:peer-left', { userId });
        io.to(room.id).emit('room:state', room);

        const presenceUsers = presenceService.getPresenceState(room.id);
        io.to(room.id).emit('presence:state', { users: presenceUsers });
      }
    } catch (error) {
      logger.error('Disconnect error', { socketId: socket.id, error: error.message });
    }
  });
};

export default registerRoomHandlers;
