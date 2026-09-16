import { z } from 'zod';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export const extractYouTubeVideoId = (input) => {
  if (typeof input !== 'string') {
    throw new AppError('Invalid YouTube media source', 400, ERROR_CODES.INVALID_MEDIA_SOURCE);
  }

  const trimmed = input.trim();
  if (!trimmed || trimmed.includes('<') || trimmed.includes('>') || trimmed.includes('script')) {
    throw new AppError('Invalid YouTube media source', 400, ERROR_CODES.INVALID_MEDIA_SOURCE);
  }

  // Directly an 11-character video ID
  if (YOUTUBE_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  // Parse YouTube URL patterns
  try {
    const urlObj = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
    const hostname = urlObj.hostname.toLowerCase();

    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      if (hostname.includes('youtu.be')) {
        const pathId = urlObj.pathname.slice(1);
        if (YOUTUBE_ID_REGEX.test(pathId)) return pathId;
      }

      if (urlObj.searchParams.has('v')) {
        const vParam = urlObj.searchParams.get('v');
        if (YOUTUBE_ID_REGEX.test(vParam)) return vParam;
      }

      // /embed/ID or /v/ID
      const parts = urlObj.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'embed' || parts[0] === 'v')) {
        if (YOUTUBE_ID_REGEX.test(parts[1])) return parts[1];
      }
    }
  } catch (err) {
    // URL parsing failed
  }

  throw new AppError('Invalid YouTube media source', 400, ERROR_CODES.INVALID_MEDIA_SOURCE);
};

export const setMediaSchema = z.object({
  type: z.literal('youtube', {
    errorMap: () => ({ message: 'Only "youtube" media type is supported' })
  }),
  mediaId: z.string({ required_error: 'Media ID or URL is required' })
    .transform((val) => extractYouTubeVideoId(val))
});

export const playMediaSchema = z.object({
  position: z.number({ required_error: 'Position is required' })
    .finite({ message: 'Position must be a finite number' })
    .min(0, { message: 'Position must be non-negative' })
});

export const pauseMediaSchema = z.object({
  position: z.number({ required_error: 'Position is required' })
    .finite({ message: 'Position must be a finite number' })
    .min(0, { message: 'Position must be non-negative' })
});

export const seekMediaSchema = z.object({
  position: z.number({ required_error: 'Position is required' })
    .finite({ message: 'Position must be a finite number' })
    .min(0, { message: 'Position must be non-negative' })
});

export const setRateSchema = z.object({
  playbackRate: z.number({ required_error: 'Playback rate is required' })
    .refine((val) => [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(val), {
      message: 'Invalid playback rate'
    })
});

export const validateMedia = (schema, data, customErrorCode = ERROR_CODES.VALIDATION_ERROR) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    let errorCode = customErrorCode;

    if (firstIssue.path.includes('mediaId') || firstIssue.path.includes('type')) {
      errorCode = ERROR_CODES.INVALID_MEDIA_SOURCE;
    } else if (firstIssue.path.includes('position')) {
      errorCode = ERROR_CODES.INVALID_MEDIA_POSITION;
    } else if (firstIssue.path.includes('playbackRate')) {
      errorCode = ERROR_CODES.INVALID_PLAYBACK_RATE;
    }

    throw new AppError(firstIssue.message, 400, errorCode, result.error.format());
  }
  return result.data;
};
