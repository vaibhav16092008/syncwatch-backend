export class RoomStorage {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(roomId, roomData = {}) {
    if (this.rooms.has(roomId)) {
      throw new Error(`Room ${roomId} already exists`);
    }
    const room = {
      id: roomId,
      createdAt: new Date().toISOString(),
      ...roomData
    };
    this.rooms.set(roomId, room);
    return { ...room };
  }

  getRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }
    return { ...room };
  }

  hasRoom(roomId) {
    return this.rooms.has(roomId);
  }

  updateRoom(roomId, updates = {}) {
    const existing = this.rooms.get(roomId);
    if (!existing) {
      return null;
    }
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.rooms.set(roomId, updated);
    return { ...updated };
  }

  deleteRoom(roomId) {
    return this.rooms.delete(roomId);
  }

  clear() {
    this.rooms.clear();
  }
}

export const roomStorage = new RoomStorage();
export default roomStorage;
