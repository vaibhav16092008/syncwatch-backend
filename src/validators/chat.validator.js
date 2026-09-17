import { z } from 'zod';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export const sendChatMessageSchema = z.object({
  message: z.string({
    required_error: 'Message is required',
    invalid_type_error: 'Message must be a string'
  })
});

export const validateChatMessage = (message) => {
  if (typeof message !== 'string') {
    throw new AppError('Message must be a string', 400, ERROR_CODES.INVALID_CHAT_MESSAGE);
  }

  const trimmed = message.trim();

  if (trimmed.length === 0) {
    throw new AppError('Message cannot be empty or whitespace-only', 400, ERROR_CODES.INVALID_CHAT_MESSAGE);
  }

  if (trimmed.length > 500) {
    throw new AppError('Message cannot exceed 500 characters', 400, ERROR_CODES.CHAT_MESSAGE_TOO_LONG);
  }

  // Sanitize basic HTML tags to prevent XSS
  const sanitized = trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  return sanitized;
};
