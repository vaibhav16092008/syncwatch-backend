import express from 'express';
import mediaService from '../services/media.service.js';
import { createApiResponse, ERROR_CODES } from '../utils/errors.js';
import { roomIdSchema, validate } from '../validators/room.validator.js';

const router = express.Router();

// GET /api/rooms/:roomId/media - Get public media state for a room
router.get('/:roomId/media', (req, res, next) => {
  try {
    const { roomId } = req.params;
    const normalizedRoomId = validate(roomIdSchema, roomId, ERROR_CODES.INVALID_ROOM_CODE);
    const mediaState = mediaService.getMediaState(normalizedRoomId);
    res.status(200).json(createApiResponse({
      media: mediaState
    }));
  } catch (error) {
    next(error);
  }
});

export default router;
