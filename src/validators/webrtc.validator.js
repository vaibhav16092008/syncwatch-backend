import { z } from 'zod';
import { AppError, ERROR_CODES } from '../utils/errors.js';

export const validateWebRTCOffer = (payload) => {
  if (typeof payload !== 'object' || payload === null) {
    throw new AppError('Payload must be an object', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  const { targetUserId, sdp } = payload;

  if (typeof targetUserId !== 'string' || targetUserId.trim() === '') {
    throw new AppError('targetUserId is required and must be a non-empty string', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  if (typeof sdp !== 'object' || sdp === null) {
    throw new AppError('sdp is required and must be an object', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  if (sdp.type !== 'offer') {
    throw new AppError('sdp.type must be "offer"', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  if (typeof sdp.sdp !== 'string' || sdp.sdp.trim() === '') {
    throw new AppError('sdp.sdp must be a non-empty string', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  if (sdp.sdp.length > 32768) {
    throw new AppError('SDP payload exceeds maximum size limit of 32KB', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  return {
    targetUserId: targetUserId.trim(),
    sdp: {
      type: 'offer',
      sdp: sdp.sdp
    }
  };
};

export const validateWebRTCAnswer = (payload) => {
  if (typeof payload !== 'object' || payload === null) {
    throw new AppError('Payload must be an object', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  const { targetUserId, sdp } = payload;

  if (typeof targetUserId !== 'string' || targetUserId.trim() === '') {
    throw new AppError('targetUserId is required and must be a non-empty string', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  if (typeof sdp !== 'object' || sdp === null) {
    throw new AppError('sdp is required and must be an object', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  if (sdp.type !== 'answer') {
    throw new AppError('sdp.type must be "answer"', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  if (typeof sdp.sdp !== 'string' || sdp.sdp.trim() === '') {
    throw new AppError('sdp.sdp must be a non-empty string', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  if (sdp.sdp.length > 32768) {
    throw new AppError('SDP payload exceeds maximum size limit of 32KB', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  return {
    targetUserId: targetUserId.trim(),
    sdp: {
      type: 'answer',
      sdp: sdp.sdp
    }
  };
};

export const validateWebRTCICECandidate = (payload) => {
  if (typeof payload !== 'object' || payload === null) {
    throw new AppError('Payload must be an object', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  const { targetUserId, candidate } = payload;

  if (typeof targetUserId !== 'string' || targetUserId.trim() === '') {
    throw new AppError('targetUserId is required and must be a non-empty string', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  if (typeof candidate !== 'object' || candidate === null) {
    throw new AppError('candidate is required and must be an object', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  if (typeof candidate.candidate !== 'string' || candidate.candidate.trim() === '') {
    throw new AppError('candidate.candidate must be a non-empty string', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  if (candidate.candidate.length > 8192) {
    throw new AppError('ICE candidate string exceeds maximum size limit of 8KB', 400, ERROR_CODES.INVALID_WEBRTC_SIGNAL);
  }

  return {
    targetUserId: targetUserId.trim(),
    candidate: {
      candidate: candidate.candidate,
      sdpMid: typeof candidate.sdpMid === 'string' ? candidate.sdpMid : null,
      sdpMLineIndex: typeof candidate.sdpMLineIndex === 'number' ? candidate.sdpMLineIndex : null
    }
  };
};

export const validateFileMetadata = (payload) => {
  if (typeof payload !== 'object' || payload === null) {
    throw new AppError('Payload must be an object', 400, ERROR_CODES.INVALID_FILE_METADATA);
  }

  const { targetUserId, fileId, name, size, mimeType } = payload;

  if (targetUserId !== undefined && targetUserId !== null && (typeof targetUserId !== 'string' || targetUserId.trim() === '')) {
    throw new AppError('targetUserId must be a non-empty string if provided', 400, ERROR_CODES.INVALID_FILE_METADATA);
  }

  if (typeof name !== 'string' || name.trim() === '') {
    throw new AppError('File name is required and must be a non-empty string', 400, ERROR_CODES.INVALID_FILE_METADATA);
  }

  const trimmedName = name.trim();
  if (trimmedName.length > 255) {
    throw new AppError('File name cannot exceed 255 characters', 400, ERROR_CODES.INVALID_FILE_METADATA);
  }

  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    throw new AppError('File size must be a positive integer', 400, ERROR_CODES.INVALID_FILE_METADATA);
  }

  // Max 10GB limit (10,737,418,240 bytes)
  if (size > 10737418240) {
    throw new AppError('Declared file size exceeds maximum limit of 10GB', 400, ERROR_CODES.INVALID_FILE_METADATA);
  }

  if (typeof mimeType !== 'string' || mimeType.trim() === '') {
    throw new AppError('MIME type is required and must be a non-empty string', 400, ERROR_CODES.INVALID_FILE_METADATA);
  }

  const trimmedMime = mimeType.trim();
  if (trimmedMime.length > 128) {
    throw new AppError('MIME type cannot exceed 128 characters', 400, ERROR_CODES.INVALID_FILE_METADATA);
  }

  const sanitizedFileId = typeof fileId === 'string' && fileId.trim() !== '' ? fileId.trim() : null;

  return {
    targetUserId: targetUserId ? targetUserId.trim() : null,
    fileId: sanitizedFileId,
    name: trimmedName,
    size,
    mimeType: trimmedMime
  };
};
