import roomStorage from '../storage/room.storage.js';
import { AppError, ERROR_CODES } from '../utils/errors.js';
import {
  setMediaSchema,
  playMediaSchema,
  pauseMediaSchema,
  seekMediaSchema,
  setRateSchema,
  validateMedia
} from '../validators/media.validator.js';

export class MediaService {
  getMediaState(roomId) {
    const room = roomStorage.getRoom(roomId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    const media = room.media || {
      source: null,
      status: 'paused',
      position: 0,
      playbackRate: 1,
      updatedAt: 0,
      version: 0
    };

    let effectivePosition = media.position;

    if (media.source && media.status === 'playing' && media.updatedAt > 0) {
      const elapsedSeconds = (Date.now() - media.updatedAt) / 1000;
      const rawPos = media.position + elapsedSeconds * media.playbackRate;
      effectivePosition = Math.max(0, Math.round(rawPos * 100) / 100);
    } else {
      effectivePosition = Math.max(0, Math.round(media.position * 100) / 100);
    }

    return {
      source: media.source ? { type: media.source.type, mediaId: media.source.mediaId } : null,
      status: media.status,
      position: effectivePosition,
      playbackRate: media.playbackRate,
      updatedAt: media.updatedAt,
      version: media.version
    };
  }

  setMediaSource({ roomId, actingUserId, type, mediaId }) {
    const validated = validateMedia(setMediaSchema, { type, mediaId });
    const room = roomStorage.getRoom(roomId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    if (room.hostUserId !== actingUserId) {
      throw new AppError('Only the host can change the media source', 403, ERROR_CODES.MEDIA_CONTROL_FORBIDDEN);
    }

    const currentVersion = room.media ? room.media.version : 0;
    const now = Date.now();

    roomStorage.updateRoom(roomId, (r) => {
      r.media = {
        source: {
          type: validated.type,
          mediaId: validated.mediaId
        },
        status: 'paused',
        position: 0,
        playbackRate: 1,
        updatedAt: now,
        version: currentVersion + 1
      };
      return r;
    });

    return this.getMediaState(roomId);
  }

  playMedia({ roomId, actingUserId, position }) {
    const validated = validateMedia(playMediaSchema, { position });
    const room = roomStorage.getRoom(roomId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    if (room.hostUserId !== actingUserId) {
      throw new AppError('Only the host can control media playback', 403, ERROR_CODES.MEDIA_CONTROL_FORBIDDEN);
    }

    if (!room.media || !room.media.source) {
      throw new AppError('No media loaded in room', 404, ERROR_CODES.MEDIA_NOT_FOUND);
    }

    const now = Date.now();
    const currentVersion = room.media.version;

    roomStorage.updateRoom(roomId, (r) => {
      r.media = {
        ...r.media,
        status: 'playing',
        position: validated.position,
        updatedAt: now,
        version: currentVersion + 1
      };
      return r;
    });

    return this.getMediaState(roomId);
  }

  pauseMedia({ roomId, actingUserId, position }) {
    const validated = validateMedia(pauseMediaSchema, { position });
    const room = roomStorage.getRoom(roomId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    if (room.hostUserId !== actingUserId) {
      throw new AppError('Only the host can control media playback', 403, ERROR_CODES.MEDIA_CONTROL_FORBIDDEN);
    }

    if (!room.media || !room.media.source) {
      throw new AppError('No media loaded in room', 404, ERROR_CODES.MEDIA_NOT_FOUND);
    }

    const now = Date.now();
    const currentVersion = room.media.version;

    roomStorage.updateRoom(roomId, (r) => {
      r.media = {
        ...r.media,
        status: 'paused',
        position: validated.position,
        updatedAt: now,
        version: currentVersion + 1
      };
      return r;
    });

    return this.getMediaState(roomId);
  }

  seekMedia({ roomId, actingUserId, position }) {
    const validated = validateMedia(seekMediaSchema, { position });
    const room = roomStorage.getRoom(roomId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    if (room.hostUserId !== actingUserId) {
      throw new AppError('Only the host can control media playback', 403, ERROR_CODES.MEDIA_CONTROL_FORBIDDEN);
    }

    if (!room.media || !room.media.source) {
      throw new AppError('No media loaded in room', 404, ERROR_CODES.MEDIA_NOT_FOUND);
    }

    const now = Date.now();
    const currentVersion = room.media.version;

    roomStorage.updateRoom(roomId, (r) => {
      r.media = {
        ...r.media,
        position: validated.position,
        updatedAt: now,
        version: currentVersion + 1
      };
      return r;
    });

    return this.getMediaState(roomId);
  }

  setPlaybackRate({ roomId, actingUserId, playbackRate }) {
    const validated = validateMedia(setRateSchema, { playbackRate });
    const room = roomStorage.getRoom(roomId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    if (room.hostUserId !== actingUserId) {
      throw new AppError('Only the host can change playback rate', 403, ERROR_CODES.MEDIA_CONTROL_FORBIDDEN);
    }

    if (!room.media || !room.media.source) {
      throw new AppError('No media loaded in room', 404, ERROR_CODES.MEDIA_NOT_FOUND);
    }

    // If currently playing, calculate current effective position as new anchor
    const currentState = this.getMediaState(roomId);
    const newAnchorPosition = currentState.position;
    const now = Date.now();
    const currentVersion = room.media.version;

    roomStorage.updateRoom(roomId, (r) => {
      r.media = {
        ...r.media,
        position: newAnchorPosition,
        playbackRate: validated.playbackRate,
        updatedAt: now,
        version: currentVersion + 1
      };
      return r;
    });

    return this.getMediaState(roomId);
  }

  clearMedia({ roomId, actingUserId }) {
    const room = roomStorage.getRoom(roomId);
    if (!room) {
      throw new AppError('Room not found', 404, ERROR_CODES.ROOM_NOT_FOUND);
    }

    if (room.hostUserId !== actingUserId) {
      throw new AppError('Only the host can clear media', 403, ERROR_CODES.MEDIA_CONTROL_FORBIDDEN);
    }

    const now = Date.now();
    const currentVersion = room.media ? room.media.version : 0;

    roomStorage.updateRoom(roomId, (r) => {
      r.media = {
        source: null,
        status: 'paused',
        position: 0,
        playbackRate: 1,
        updatedAt: now,
        version: currentVersion + 1
      };
      return r;
    });

    return this.getMediaState(roomId);
  }
}

export const mediaService = new MediaService();
export default mediaService;
