import { Server } from 'socket.io';
import config from '../config/env.js';
import logger from '../utils/logger.js';

export const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: config.CLIENT_URL,
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    logger.info('Client connected', { socketId: socket.id });

    socket.on('disconnect', (reason) => {
      logger.info('Client disconnected', { socketId: socket.id, reason });
    });
  });

  return io;
};

export default initSocket;
