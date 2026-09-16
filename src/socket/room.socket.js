import roomService from '../services/room.service.js';
import mediaService from '../services/media.service.js';
import logger from '../utils/logger.js';

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
  socket.on('room:leave', (callback = () => {}) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;

      if (!roomId || !userId) {
        callback({ success: true });
        return;
      }

      socket.leave(roomId);
      const updatedState = roomService.leaveRoom({ roomId, userId, socketId: socket.id });

      delete socket.data.roomId;
      delete socket.data.userId;

      if (updatedState) {
        socket.to(roomId).emit('room:user-left', { userId });
        io.to(roomId).emit('room:state', updatedState);
      }

      callback({ success: true });
    } catch (error) {
      logger.warn('room:leave failed', { socketId: socket.id, error: error.message });
      callback({
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message
        }
      });
    }
  });

  // room:lock
  socket.on('room:lock', (callback = () => {}) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;

      if (!roomId || !userId) {
        throw new Error('You are not currently in a room');
      }

      const updatedState = roomService.setRoomLock({ roomId, actingUserId: userId, locked: true });
      io.to(roomId).emit('room:state', updatedState);

      callback({
        success: true,
        data: { room: updatedState }
      });
    } catch (error) {
      logger.warn('room:lock failed', { socketId: socket.id, error: error.message });
      callback({
        success: false,
        error: {
          code: error.code || 'FORBIDDEN',
          message: error.message
        }
      });
    }
  });

  // room:unlock
  socket.on('room:unlock', (callback = () => {}) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;

      if (!roomId || !userId) {
        throw new Error('You are not currently in a room');
      }

      const updatedState = roomService.setRoomLock({ roomId, actingUserId: userId, locked: false });
      io.to(roomId).emit('room:state', updatedState);

      callback({
        success: true,
        data: { room: updatedState }
      });
    } catch (error) {
      logger.warn('room:unlock failed', { socketId: socket.id, error: error.message });
      callback({
        success: false,
        error: {
          code: error.code || 'FORBIDDEN',
          message: error.message
        }
      });
    }
  });

  // room:transfer-host
  socket.on('room:transfer-host', (payload = {}, callback = () => {}) => {
    try {
      const roomId = socket.data.roomId;
      const actingUserId = socket.data.userId;
      const { targetUserId } = payload;

      if (!roomId || !actingUserId) {
        throw new Error('You are not currently in a room');
      }

      const updatedState = roomService.transferHost({ roomId, actingUserId, targetUserId });
      io.to(roomId).emit('room:state', updatedState);

      callback({
        success: true,
        data: { room: updatedState }
      });
    } catch (error) {
      logger.warn('room:transfer-host failed', { socketId: socket.id, error: error.message });
      callback({
        success: false,
        error: {
          code: error.code || 'FORBIDDEN',
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
        io.to(room.id).emit('room:user-left', { userId });
        io.to(room.id).emit('room:state', room);
      }
    } catch (error) {
      logger.error('Disconnect error', { socketId: socket.id, error: error.message });
    }
  });
};

export default registerRoomHandlers;
