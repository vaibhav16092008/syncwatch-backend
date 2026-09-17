import crypto from 'node:crypto';
import webrtcService from '../services/webrtc.service.js';
import {
  validateWebRTCOffer,
  validateWebRTCAnswer,
  validateWebRTCICECandidate,
  validateFileMetadata
} from '../validators/webrtc.validator.js';
import logger from '../utils/logger.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export const registerWebRTCHandlers = (io, socket) => {
  const getContext = () => {
    const roomId = socket.data.roomId;
    const userId = socket.data.userId;
    if (!roomId || !userId) {
      throw new AppError('You must be in a room to perform WebRTC signaling', 403, ERROR_CODES.NOT_ROOM_MEMBER);
    }
    return { roomId, userId };
  };

  const handleCallback = (cb, payload) => {
    if (typeof cb === 'function') cb(payload);
  };

  // webrtc:peer-ready
  socket.on('webrtc:peer-ready', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    try {
      const { roomId, userId } = getContext();
      const peerInfo = webrtcService.setPeerReady({ roomId, userId, socketId: socket.id });

      socket.to(roomId).emit('webrtc:peer-ready', {
        userId: peerInfo.userId,
        displayName: peerInfo.displayName,
        socketId: socket.id
      });

      const readyPeers = webrtcService.getReadyPeers(roomId);
      handleCallback(cb, { success: true, data: { readyPeers } });
    } catch (error) {
      logger.warn('webrtc:peer-ready failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.WEBRTC_SIGNAL_FAILED,
          message: error.message
        }
      });
    }
  });

  // webrtc:offer
  socket.on('webrtc:offer', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    const data = typeof payload === 'object' && payload !== null ? payload : {};
    try {
      const { roomId, userId } = getContext();
      const validated = validateWebRTCOffer(data);

      const { senderUser, targetUser } = webrtcService.validatePeerInRoom({
        roomId,
        senderUserId: userId,
        targetUserId: validated.targetUserId
      });

      io.to(targetUser.socketId).emit('webrtc:offer', {
        senderUserId: senderUser.userId || senderUser.id,
        senderDisplayName: senderUser.displayName,
        sdp: validated.sdp
      });

      handleCallback(cb, { success: true });
    } catch (error) {
      logger.warn('webrtc:offer failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.INVALID_WEBRTC_SIGNAL,
          message: error.message
        }
      });
    }
  });

  // webrtc:answer
  socket.on('webrtc:answer', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    const data = typeof payload === 'object' && payload !== null ? payload : {};
    try {
      const { roomId, userId } = getContext();
      const validated = validateWebRTCAnswer(data);

      const { senderUser, targetUser } = webrtcService.validatePeerInRoom({
        roomId,
        senderUserId: userId,
        targetUserId: validated.targetUserId
      });

      io.to(targetUser.socketId).emit('webrtc:answer', {
        senderUserId: senderUser.userId || senderUser.id,
        senderDisplayName: senderUser.displayName,
        sdp: validated.sdp
      });

      handleCallback(cb, { success: true });
    } catch (error) {
      logger.warn('webrtc:answer failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.INVALID_WEBRTC_SIGNAL,
          message: error.message
        }
      });
    }
  });

  // webrtc:ice-candidate
  socket.on('webrtc:ice-candidate', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    const data = typeof payload === 'object' && payload !== null ? payload : {};
    try {
      const { roomId, userId } = getContext();
      const validated = validateWebRTCICECandidate(data);

      const { senderUser, targetUser } = webrtcService.validatePeerInRoom({
        roomId,
        senderUserId: userId,
        targetUserId: validated.targetUserId
      });

      io.to(targetUser.socketId).emit('webrtc:ice-candidate', {
        senderUserId: senderUser.userId || senderUser.id,
        candidate: validated.candidate
      });

      handleCallback(cb, { success: true });
    } catch (error) {
      logger.warn('webrtc:ice-candidate failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.INVALID_WEBRTC_SIGNAL,
          message: error.message
        }
      });
    }
  });

  // webrtc:file-metadata
  socket.on('webrtc:file-metadata', (payload = {}, callback) => {
    const cb = typeof payload === 'function' ? payload : callback;
    const data = typeof payload === 'object' && payload !== null ? payload : {};
    try {
      const { roomId, userId } = getContext();
      const validated = validateFileMetadata(data);
      const fileId = validated.fileId || crypto.randomUUID();

      const fileOfferPayload = {
        fileId,
        senderUserId: userId,
        name: validated.name,
        size: validated.size,
        mimeType: validated.mimeType
      };

      if (validated.targetUserId) {
        const { senderUser, targetUser } = webrtcService.validatePeerInRoom({
          roomId,
          senderUserId: userId,
          targetUserId: validated.targetUserId
        });
        fileOfferPayload.senderDisplayName = senderUser.displayName;

        io.to(targetUser.socketId).emit('webrtc:file-offer', fileOfferPayload);
      } else {
        const { senderUser } = webrtcService.validatePeerInRoom({
          roomId,
          senderUserId: userId,
          targetUserId: userId
        });
        fileOfferPayload.senderDisplayName = senderUser.displayName;

        socket.to(roomId).emit('webrtc:file-offer', fileOfferPayload);
      }

      handleCallback(cb, {
        success: true,
        data: {
          fileId,
          metadata: fileOfferPayload
        }
      });
    } catch (error) {
      logger.warn('webrtc:file-metadata failed', { socketId: socket.id, error: error.message });
      handleCallback(cb, {
        success: false,
        error: {
          code: error.code || ERROR_CODES.INVALID_FILE_METADATA,
          message: error.message
        }
      });
    }
  });
};

export default registerWebRTCHandlers;
