import crypto from 'node:crypto';
import roomStorage from '../storage/room.storage.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export class WebRTCService {
  validatePeerInRoom({ roomId, senderUserId, targetUserId }) {
    if (!roomId) {
      throw new AppError('Room ID is required', 400, ERROR_CODES.VALIDATION_ERROR);
    }
    if (!senderUserId) {
      throw new AppError('Sender User ID is required', 400, ERROR_CODES.VALIDATION_ERROR);
    }
    if (!targetUserId) {
      throw new AppError('Target User ID is required', 400, ERROR_CODES.PEER_NOT_FOUND);
    }

    const normalizedId = roomStorage.normalizeRoomId(roomId);
    const room = roomStorage.getRoom(normalizedId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    const senderUser = room.users.find((u) => (u.userId === senderUserId || u.id === senderUserId) && u.connected !== false);
    if (!senderUser) {
      throw new AppError('You must be a connected member of the room', 403, ERROR_CODES.NOT_ROOM_MEMBER);
    }

    const targetUser = room.users.find((u) => (u.userId === targetUserId || u.id === targetUserId) && u.connected !== false);
    if (!targetUser) {
      throw new AppError(`Target peer ${targetUserId} is not an active member of room ${roomId}`, 404, ERROR_CODES.PEER_NOT_IN_ROOM);
    }

    return {
      room,
      senderUser,
      targetUser
    };
  }

  setPeerReady({ roomId, userId, socketId }) {
    if (!roomId || !userId) {
      throw new AppError('Room ID and User ID are required', 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const normalizedId = roomStorage.normalizeRoomId(roomId);
    const room = roomStorage.getRoom(normalizedId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    const user = room.users.find((u) => (u.userId === userId || u.id === userId) && u.connected !== false);
    if (!user) {
      throw new AppError('You must be a connected member of the room', 403, ERROR_CODES.NOT_ROOM_MEMBER);
    }

    const peerInfo = {
      userId: user.userId || user.id,
      displayName: user.displayName,
      socketId,
      ready: true,
      updatedAt: Date.now()
    };

    roomStorage.updateRoom(normalizedId, (r) => {
      if (!r.webrtc) {
        r.webrtc = { peers: {} };
      }
      if (!r.webrtc.peers) {
        r.webrtc.peers = {};
      }
      r.webrtc.peers[user.userId || user.id] = peerInfo;
      return r;
    });

    return peerInfo;
  }

  getReadyPeers(roomId) {
    if (!roomId) return [];
    const normalizedId = roomStorage.normalizeRoomId(roomId);
    const room = roomStorage.getRoom(normalizedId);
    if (!room || !room.webrtc || !room.webrtc.peers) return [];

    return Object.values(room.webrtc.peers);
  }

  removePeerFromRoom({ roomId, userId }) {
    if (!roomId || !userId) return;
    const normalizedId = roomStorage.normalizeRoomId(roomId);
    roomStorage.updateRoom(normalizedId, (r) => {
      if (r.webrtc && r.webrtc.peers) {
        delete r.webrtc.peers[userId];
      }
      return r;
    });
  }
}

export const webrtcService = new WebRTCService();
export default webrtcService;
