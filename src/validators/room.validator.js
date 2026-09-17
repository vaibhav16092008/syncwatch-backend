import { z } from 'zod';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export const ROOM_CODE_REGEX = /^SYNC-[A-Z0-9]{5}$/i;

export const createRoomSchema = z.object({
  name: z.string({ required_error: 'Room name is required' })
    .transform((val) => val.trim())
    .refine((val) => val.length > 0 && val.length <= 50, {
      message: 'Room name must be between 1 and 50 characters'
    }),
  mode: z.enum(['youtube', 'local'], {
    errorMap: () => ({ message: 'Mode must be either "youtube" or "local"' })
  }),
  displayName: z.string({ required_error: 'Display name is required' })
    .transform((val) => val.trim())
    .refine((val) => val.length >= 2 && val.length <= 24, {
      message: 'Display name must be between 2 and 24 characters'
    })
});

export const joinRoomSchema = z.object({
  roomId: z.string({ required_error: 'Room ID is required' })
    .transform((val) => val.trim().toUpperCase())
    .refine((val) => ROOM_CODE_REGEX.test(val), {
      message: 'Invalid room code format'
    }),
  displayName: z.string({ required_error: 'Display name is required' })
    .transform((val) => val.trim())
    .refine((val) => val.length >= 2 && val.length <= 24, {
      message: 'Display name must be between 2 and 24 characters'
    })
});

export const transferHostSchema = z.object({
  targetUserId: z.string({ required_error: 'Target user ID is required' })
    .transform((val) => val.trim())
    .refine((val) => val.length > 0, {
      message: 'Target user ID cannot be empty'
    })
});

export const lockRoomSchema = z.object({
  locked: z.boolean({ required_error: 'Locked flag must be a boolean' })
});

export const roomIdSchema = z.string({ required_error: 'Room ID is required' })
  .transform((val) => val.trim().toUpperCase())
  .refine((val) => ROOM_CODE_REGEX.test(val), {
    message: 'Invalid room code format'
  });

export const reconnectRoomSchema = z.object({
  roomId: z.string({ required_error: 'Room ID is required' })
    .transform((val) => val.trim().toUpperCase())
    .refine((val) => ROOM_CODE_REGEX.test(val), {
      message: 'Invalid room code format'
    }),
  userId: z.string({ required_error: 'User ID is required' })
    .transform((val) => val.trim())
    .refine((val) => val.length > 0, {
      message: 'User ID cannot be empty'
    }),
  reconnectToken: z.string({ required_error: 'Reconnect token is required' })
    .transform((val) => val.trim())
    .refine((val) => val.length > 0, {
      message: 'Reconnect token cannot be empty'
    })
});

export const validate = (schema, data, customErrorCode = ERROR_CODES.VALIDATION_ERROR) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    let errorCode = customErrorCode;
    
    // Assign specific error codes if error relates to display name or room code
    if (firstIssue.path.includes('displayName')) {
      errorCode = ERROR_CODES.INVALID_DISPLAY_NAME;
    } else if (firstIssue.path.includes('roomId')) {
      errorCode = ERROR_CODES.INVALID_ROOM_CODE;
    }

    throw new AppError(firstIssue.message, 400, errorCode, result.error.format());
  }
  return result.data;
};
