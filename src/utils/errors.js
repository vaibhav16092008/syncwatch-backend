export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_LOCKED: 'ROOM_LOCKED',
  INVALID_ROOM_CODE: 'INVALID_ROOM_CODE',
  INVALID_DISPLAY_NAME: 'INVALID_DISPLAY_NAME',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  INVALID_MEDIA_SOURCE: 'INVALID_MEDIA_SOURCE',
  INVALID_MEDIA_POSITION: 'INVALID_MEDIA_POSITION',
  INVALID_PLAYBACK_RATE: 'INVALID_PLAYBACK_RATE',
  MEDIA_CONTROL_FORBIDDEN: 'MEDIA_CONTROL_FORBIDDEN'
};

export const createApiResponse = (data) => ({
  success: true,
  data
});

export const createErrorResponse = (code, message, details = null) => {
  const response = {
    success: false,
    error: {
      code,
      message
    }
  };
  if (details) {
    response.error.details = details;
  }
  return response;
};
