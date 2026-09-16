export class RoomStorage {
  constructor() {
    this.rooms = new Map();
  }

  normalizeRoomId(roomId) {
    if (typeof roomId !== 'string') return '';
    return roomId.trim().toUpperCase();
  }

  createRoom(roomId, roomData = {}) {
    const key = this.normalizeRoomId(roomId);
    if (this.rooms.has(key)) {
      throw new Error(`Room ${roomId} already exists`);
    }
    const room = {
      id: roomId,
      roomId: roomId,
      name: roomData.name || 'Watch Party',
      mode: roomData.mode || 'youtube',
      locked: false,
      maxUsers: 10,
      hostUserId: roomData.hostUserId || null,
      users: roomData.users ? [...roomData.users] : [],
      media: null,
      messages: [],
      createdAt: roomData.createdAt || Date.now(),
      emptySince: null,
      ...roomData
    };
    this.rooms.set(key, room);
    return structuredClone(room);
  }

  getRoom(roomId) {
    const key = this.normalizeRoomId(roomId);
    const room = this.rooms.get(key);
    if (!room) {
      return null;
    }
    return structuredClone(room);
  }

  hasRoom(roomId) {
    const key = this.normalizeRoomId(roomId);
    return this.rooms.has(key);
  }

  updateRoom(roomId, updater) {
    const key = this.normalizeRoomId(roomId);
    const existing = this.rooms.get(key);
    if (!existing) {
      return null;
    }

    let updated;
    if (typeof updater === 'function') {
      const cloned = structuredClone(existing);
      updated = updater(cloned);
    } else {
      updated = {
        ...existing,
        ...updater,
        updatedAt: Date.now()
      };
    }

    this.rooms.set(key, updated);
    return structuredClone(updated);
  }

  deleteRoom(roomId) {
    const key = this.normalizeRoomId(roomId);
    return this.rooms.delete(key);
  }

  getRoomBySocketId(socketId) {
    for (const room of this.rooms.values()) {
      if (room.users.some((user) => user.socketId === socketId)) {
        return structuredClone(room);
      }
    }
    return null;
  }

  findUserBySocketId(socketId) {
    for (const room of this.rooms.values()) {
      const user = room.users.find((u) => u.socketId === socketId);
      if (user) {
        return { user: structuredClone(user), room: structuredClone(room) };
      }
    }
    return null;
  }

  listRooms() {
    return Array.from(this.rooms.values()).map((r) => structuredClone(r));
  }

  clear() {
    this.rooms.clear();
  }
}

export const roomStorage = new RoomStorage();
export default roomStorage;
