import express from 'express';
import roomService from '../services/room.service.js';
import { createApiResponse } from '../utils/errors.js';

const router = express.Router();

// POST /api/rooms - Create a room
router.post('/', (req, res, next) => {
  try {
    const { name, mode, displayName } = req.body || {};
    const result = roomService.createRoom({ name, mode, displayName });
    res.status(201).json(createApiResponse({
      room: result.room,
      hostUserId: result.hostUserId,
      user: result.user
    }));
  } catch (error) {
    next(error);
  }
});

// GET /api/rooms/:roomId - Public room lookup
router.get('/:roomId', (req, res, next) => {
  try {
    const { roomId } = req.params;
    const roomInfo = roomService.getPublicRoomInfo(roomId);
    res.status(200).json(createApiResponse({
      room: roomInfo
    }));
  } catch (error) {
    next(error);
  }
});

export default router;
