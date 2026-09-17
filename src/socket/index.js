import { Server } from 'socket.io';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { registerRoomHandlers } from './room.socket.js';
import { registerMediaHandlers } from './media.socket.js';
import { registerChatHandlers } from './chat.socket.js';
import { registerReactionHandlers } from './reaction.socket.js';
import { registerWebRTCHandlers } from './webrtc.socket.js';

export const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: config.CLIENT_URL,
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    logger.info('Client connected', { socketId: socket.id });

    // Register room lifecycle handlers
    registerRoomHandlers(io, socket);
    // Register media handlers
    registerMediaHandlers(io, socket);
    // Register chat handlers
    registerChatHandlers(io, socket);
    // Register reaction handlers
    registerReactionHandlers(io, socket);
    // Register WebRTC handlers
    registerWebRTCHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      logger.info('Client disconnected', { socketId: socket.id, reason });
    });
  });

  return io;
};

export default initSocket;
