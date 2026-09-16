# SyncWatch Backend

SyncWatch is a private real-time watch-party web application enabling users to create/join rooms and synchronize media playback (YouTube videos and P2P local video streaming).

## Current Phase

```text
Phase B4 — Permissions + Host Management
```

## Tech Stack

* Node.js
* Express
* Socket.io
* Zod
* ES Modules

## Core Architecture & Design Decisions

> **Storage Architecture**: SyncWatch currently uses in-memory storage (`RoomStorage`) behind an abstraction layer and intentionally does not use a database or external cache like Redis. Room state is stored in memory and cleared on server restart.

> **Media & Synchronization Architecture**: Media state is server-authoritative and room-scoped. Playing media position is dynamically calculated from server time anchors (`updatedAt`) and playback rate (`playbackRate`). Local video files will be handled via WebRTC in Phase B6.

> **Centralized Permission & Authorization Architecture**: Permissions are server-authoritative, room-scoped, explicit, and enforced via `permissionService`. Client role/permission claims in request payloads or sockets are strictly ignored in favor of trusted server socket data (`socket.data.roomId`, `socket.data.userId`). Capabilities (`ROOM_MANAGE`, `ROOM_LOCK`, `HOST_TRANSFER`, `MEDIA_CONTROL`) are dynamically derived from authoritative user roles (`host` vs `member`).

### System Architecture Flow

```text
HTTP Request (REST)
  ↓
Express App (CORS, JSON, Rate Limiting)
  ↓
Room & Media Routes (/api/rooms)
  ↓
Permission Service Check (assertPermission)
  ↓
Media Service & Room Service
  ↓
Storage Abstraction (RoomStorage)
  ↓
In-Memory Storage (Map)
```

```text
Socket.io Connection
  ↓
Socket Handlers (Room & Media)
  ↓
Trusted Context (socket.data.roomId, socket.data.userId)
  ↓
Permission Service Check (assertPermission)
  ↓
Media Service / Room Service
  ↓
Room-Scoped Socket State Broadcasts (room:state, media:state)
```

## Setup & Installation

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

## Running the Application

* Development mode (with auto-reload):

```bash
npm run dev
```

* Production mode:

```bash
npm start
```

* Run test suite:

```bash
npm test
```

## REST API Endpoints

### Health Check

```text
GET /api/health
```

Example Response (`HTTP 200 OK`):

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "syncwatch-server"
  }
}
```

### Create Room

```text
POST /api/rooms
```

Request Body:

```json
{
  "name": "Friday Movie Night",
  "mode": "youtube",
  "displayName": "Alice"
}
```

### Get Public Room Info

```text
GET /api/rooms/:roomId
```

### Get Public Media State

```text
GET /api/rooms/:roomId/media
```

Example Response (`HTTP 200 OK`):

```json
{
  "success": true,
  "data": {
    "media": {
      "source": {
        "type": "youtube",
        "mediaId": "dQw4w9WgXcQ"
      },
      "status": "playing",
      "position": 42.35,
      "playbackRate": 1,
      "updatedAt": 1730000000000,
      "version": 3
    }
  }
}
```

## Socket.io Events

### Client → Server

* `room:join` — Join a room using `{ roomId, displayName }`
* `room:leave` — Leave current room
* `room:lock` — Lock room (Host only, enforced via `assertPermission(roomId, userId, 'ROOM_LOCK')`)
* `room:unlock` — Unlock room (Host only, enforced via `assertPermission(roomId, userId, 'ROOM_LOCK')`)
* `room:transfer-host` — Transfer host role using `{ targetUserId }` (Host only, enforced via `assertPermission(roomId, userId, 'HOST_TRANSFER')`)
* `media:set` — Set media source `{ type: "youtube", mediaId: "VIDEO_ID_OR_URL" }` (Host only, enforced via `MEDIA_CONTROL`)
* `media:play` — Start playback `{ position: number }` (Host only, enforced via `MEDIA_CONTROL`)
* `media:pause` — Pause playback `{ position: number }` (Host only, enforced via `MEDIA_CONTROL`)
* `media:seek` — Seek to position `{ position: number }` (Host only, enforced via `MEDIA_CONTROL`)
* `media:rate` — Change playback rate `{ playbackRate: number }` (Host only, enforced via `MEDIA_CONTROL`)
* `media:clear` — Clear current media (Host only, enforced via `MEDIA_CONTROL`)

### Server → Client

* `room:state` — Broadcasts updated public room state
* `room:user-joined` — Emitted when a new user joins
* `room:user-left` — Emitted when a user leaves or disconnects
* `media:state` — Emitted to room members on media mutation and upon late join

## Permission & Security Model

1. **Server-Authoritative Authorization**: Centralized `permissionService` evaluates capabilities based on server state (`getUserRole(roomId, userId)`).
2. **Roles & Capabilities**:
   * `host`: Has `ROOM_MANAGE`, `ROOM_LOCK`, `HOST_TRANSFER`, `MEDIA_CONTROL`.
   * `member`: Standard room member without administrative or media control capabilities.
3. **Atomic Host Transfer**: Exactly one host exists per room. Upon transfer, old host loses host privileges immediately and new host receives host privileges immediately. Target must be an active connected user in the same room.
4. **Anti-Spoofing & Context Validation**: Client-supplied role, hostId, or actingUserId payloads are strictly ignored. All socket authorization uses trusted `socket.data.roomId` and `socket.data.userId`.
5. **Room Isolation**: Users from Room A cannot inspect, manage, transfer host, lock/unlock, or alter media in Room B.
6. **Failure Atomicity**: Unauthorized operations fail cleanly with appropriate HTTP 403 / socket error codes without side-effects (room state, permissions, and media version remain unchanged).

## Key Rules & Synchronization Rules Engine

1. **Room Codes**: Unique `SYNC-XXXXX` format (5 uppercase alphanumeric characters).
2. **Capacity Limit**: Maximum 10 connected users per room (including the host).
3. **Roles & Host-Only Controls**: Only the host can lock/unlock, transfer host, and execute media controls (`media:set`, `media:play`, `media:pause`, `media:seek`, `media:rate`, `media:clear`). Non-hosts receive `403` error (`HOST_TRANSFER_FORBIDDEN`, `MEDIA_CONTROL_FORBIDDEN`, `FORBIDDEN`).
4. **YouTube Source Validation**: Accepts 11-char video IDs and standard YouTube URLs. Rejects HTML/script/iframe payloads.
5. **Server-Authoritative Time**: Playback `position` and `updatedAt` are anchored by the server. When `status === "playing"`, effective position is computed as `position + ((serverNow - updatedAt) / 1000) * playbackRate`.
6. **Playback Rates**: Supported rates are `0.25`, `0.5`, `0.75`, `1`, `1.25`, `1.5`, `1.75`, `2`.
7. **Versioning**: Every successful media mutation increments `version` by 1. Failed operations do not increment `version`.
8. **Late Join Synchronization**: Upon joining a room (`room:join`), late-joining clients immediately receive the current authoritative `media:state`.
9. **Room Isolation**: Media state, socket events, and permissions are strictly isolated per room.

## Deferred Scope (Future Phases)

* **B5**: Chat, reactions, presence system
* **B6**: WebRTC signaling & local-file streaming
* **B7**: Reconnection handling & room cleanup timers
* **B8**: Production audit & deployment readiness


