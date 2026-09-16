import crypto from 'node:crypto';

const CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Human-readable uppercase alphanumeric

export const generateRawCode = (length = 5) => {
  let code = '';
  const charLength = CHARACTERS.length;
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += CHARACTERS[randomBytes[i] % charLength];
  }
  return `SYNC-${code}`;
};

export const generateRoomCode = (isCodeUniqueFn) => {
  let attempts = 0;
  const maxAttempts = 100;

  while (attempts < maxAttempts) {
    const candidate = generateRawCode(5);
    if (!isCodeUniqueFn || isCodeUniqueFn(candidate)) {
      return candidate;
    }
    attempts += 1;
  }

  throw new Error('Failed to generate a unique room code after maximum attempts');
};

export default generateRoomCode;
