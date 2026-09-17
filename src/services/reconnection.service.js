import logger from '../utils/logger.js';

export const DEFAULT_RECONNECT_GRACE_PERIOD_MS = 30000;

export class ReconnectionService {
  constructor() {
    this.reservations = new Map(); // key: `${roomId}:${userId}` -> reservation
    this.tokenToKeyMap = new Map(); // key: reconnectToken -> `${roomId}:${userId}`
    this.gracePeriodMs = DEFAULT_RECONNECT_GRACE_PERIOD_MS;
  }

  setGracePeriodMs(ms) {
    if (typeof ms === 'number' && ms >= 0) {
      this.gracePeriodMs = ms;
    }
  }

  resetGracePeriodMs() {
    this.gracePeriodMs = DEFAULT_RECONNECT_GRACE_PERIOD_MS;
  }

  getReservationKey(roomId, userId) {
    if (!roomId || !userId) return '';
    return `${roomId.trim().toUpperCase()}:${userId}`;
  }

  startGracePeriod({ roomId, userId, reconnectToken, onExpire, gracePeriodMs }) {
    const key = this.getReservationKey(roomId, userId);
    if (!key) return null;

    // Cancel existing timer if present
    this.cancelGracePeriod({ roomId, userId });

    const duration = typeof gracePeriodMs === 'number' ? gracePeriodMs : this.gracePeriodMs;

    const timer = setTimeout(async () => {
      try {
        logger.info('Reconnection grace period expired', { roomId, userId });
        this.reservations.delete(key);
        if (reconnectToken) {
          this.tokenToKeyMap.delete(reconnectToken);
        }
        if (typeof onExpire === 'function') {
          await onExpire();
        }
      } catch (err) {
        logger.error('Error during grace period expiration callback', { roomId, userId, error: err.message });
      }
    }, duration);

    // Unref timer in node environment if available to prevent keeping process alive in tests
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }

    const reservation = {
      key,
      roomId,
      userId,
      reconnectToken,
      disconnectedAt: Date.now(),
      timer
    };

    this.reservations.set(key, reservation);
    if (reconnectToken) {
      this.tokenToKeyMap.set(reconnectToken, key);
    }

    return reservation;
  }

  cancelGracePeriod({ roomId, userId }) {
    const key = this.getReservationKey(roomId, userId);
    if (!key) return false;

    const reservation = this.reservations.get(key);
    if (reservation) {
      if (reservation.timer) {
        clearTimeout(reservation.timer);
      }
      if (reservation.reconnectToken) {
        this.tokenToKeyMap.delete(reservation.reconnectToken);
      }
      this.reservations.delete(key);
      return true;
    }
    return false;
  }

  cancelGracePeriodByToken(reconnectToken) {
    if (!reconnectToken) return false;
    const key = this.tokenToKeyMap.get(reconnectToken);
    if (key) {
      const reservation = this.reservations.get(key);
      if (reservation) {
        return this.cancelGracePeriod({ roomId: reservation.roomId, userId: reservation.userId });
      }
    }
    return false;
  }

  getReservation(reconnectToken) {
    if (!reconnectToken) return null;
    const key = this.tokenToKeyMap.get(reconnectToken);
    if (!key) return null;
    return this.reservations.get(key) || null;
  }

  getReservationByUser(roomId, userId) {
    const key = this.getReservationKey(roomId, userId);
    if (!key) return null;
    return this.reservations.get(key) || null;
  }

  hasReservation(reconnectToken) {
    if (!reconnectToken) return false;
    return this.tokenToKeyMap.has(reconnectToken);
  }

  clear() {
    for (const reservation of this.reservations.values()) {
      if (reservation.timer) {
        clearTimeout(reservation.timer);
      }
    }
    this.reservations.clear();
    this.tokenToKeyMap.clear();
  }
}

export const reconnectionService = new ReconnectionService();
export default reconnectionService;
