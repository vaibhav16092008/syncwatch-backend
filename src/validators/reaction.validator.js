import { AppError, ERROR_CODES } from '../utils/errors.js';

export const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👏'];

export const validateReactionEmoji = (emoji) => {
  if (typeof emoji !== 'string') {
    throw new AppError('Emoji must be a string', 400, ERROR_CODES.INVALID_REACTION);
  }

  const trimmed = emoji.trim();

  if (!ALLOWED_EMOJIS.includes(trimmed)) {
    throw new AppError(`Invalid reaction emoji: ${emoji}`, 400, ERROR_CODES.INVALID_REACTION);
  }

  return trimmed;
};
