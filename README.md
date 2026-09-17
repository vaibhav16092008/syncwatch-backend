# SyncWatch Backend

SyncWatch is a private real-time watch-party web application enabling users to create/join rooms and synchronize media playback (YouTube videos and P2P local video streaming).

## Current Phase

```text
Phase B8 — Production Hardening, Security Fixes & Missing Tests
```

## Tech Stack

* Node.js
* Express
* Socket.io
* Zod
* ES Modules

## Core Architecture & Design Decisions

> **Storage Architecture**: SyncWatch currently uses in-memory storage (`RoomStorage`) behind an abstraction layer and intentionally does not use a database or external cache like Redis. Room state is stored in memory and cleared on server restart.

> **Media & Synchronization Architecture**: Media state is server-authoritative and room-scoped. Playing media position is dynamically calculated from server time anchors (`updatedAt`) and playback rate (`playbackRate`).

> **Centralized Permission & Authorization Architecture**: Permissions are server-authoritative, room-scoped, explicit, and enforced via `permissionService`. Client role/permission claims in request payloads or sockets are strictly ignored in favor of trusted server socket data (`socket.data.roomId`, `socket.data.userId`). Capabilities (`ROOM_MANAGE`, `ROOM_LOCK`, `HOST_TRANSFER`, `MEDIA_CONTROL`) are dynamically derived from authoritative user roles (`host` vs `member`).

> **Chat, Reactions & Presence Architecture**:
> * **Chat**: Room-scoped and bounded in-memory to 100 messages per room max. Sent messages are validated (max 500 chars), HTML-sanitized, assigned server UUIDs and timestamps, and broadcasted via `chat:message`. Late joiners receive `chat:history` upon joining. Kept Socket.IO-only by default (no REST chat endpoint).
> * **Floating Reactions**: Purely ephemeral room-scoped events (`reaction:event`). Emojis are strictly whitelisted (`👍`, `❤️`, `😂`, `😮`, `😢`, `🔥`, `🎉`, `👏`). Reactions are unbuffered and not stored for late joiners.
> * **Presence System**: Server-authoritative and event-driven. Broadcasts updated connected user lists (`presence:state`) whenever a user joins, leaves, disconnects, or reconnects.

> **WebRTC Signaling & Local File/Media Architecture**:
> * **Signaling Control Plane**: Provides pure Socket.IO signaling (`webrtc:offer`, `webrtc:answer`, `webrtc:ice-candidate`, `webrtc:peer-ready`, `webrtc:file-metadata`). The backend does NOT relay media streams, host TURN/SFU infrastructure, or store file bytes.
> * **Peer-to-Peer Transfer**: WebRTC `MediaStream` (audio/video/screen-share) and `RTCDataChannel` (local file transfer) flow directly P2P between browser peers.
> * **Transient Peer State**: WebRTC peer readiness is tracked transiently in `room.webrtc.peers` and cleaned up when a user leaves or disconnects (`webrtc:peer-left`).

> **Reconnection & Room Cleanup Architecture**:
> * **Reconnection Token**: Server generates a cryptographically secure `reconnectToken` (`UUID`) on `room:join` / `POST /api/rooms`. Reconnecting clients must supply `{ roomId, userId, reconnectToken }`. Identity restoration is server-authoritative and protected against token forgery or cross-room session theft.
> * **30-Second Grace Period**: Unexpected socket disconnects trigger a 30-second bounded grace period managed by `reconnectionService`. During grace, the logical user identity, role, display name, and room membership are reserved. If the user reconnects within 30s, session state is fully restored without loss of host status or user ID change.
> * **Deterministic Cleanup**: If the grace period expires without reconnection, the user is permanently removed, host role auto-transferred (if host), WebRTC metadata cleaned up, and `room:user-left`, `webrtc:peer-left`, `room:state`, `presence:state` broadcasted.
> * **Explicit Leave**: `room:leave` immediately cancels any active grace period, invalidates the `reconnectToken`, performs permanent cleanup, and auto-transfers host role if necessary.

> **Production Hardening & Security Architecture**:
> * **HTTP Payload Limit**: Enforces `express.json({ limit: '10kb' })` to prevent JSON payload buffer exhaustion attacks on REST endpoints.
> * **Socket.IO Transport Buffer Limit**: Enforces `maxHttpBufferSize: 64 * 1024` (64KB) on Socket.IO server initialization to block memory abuse from oversized websocket frames.
> * **Lightweight HTTP Security Headers**: Custom lightweight header middleware sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin` without adding heavy third-party packages (e.g. Helmet).
> * **Rate Limiting & Proxy Trust**: Utilizes `getClientIp` helper to safely parse comma-separated `X-Forwarded-For` headers or `req.ip`. `app.set('trust proxy', 1)` is enabled dynamically via environment variable (`TRUST_PROXY=true`).

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
Socket Handlers (Room, Media, Chat, Reaction, WebRTC)
  ↓
Trusted Context (socket.data.roomId, socket.data.userId)
  ↓
Permission Service & Validators (Chat / Reaction / Room / WebRTC)
  ↓
Services (ReconnectionService, ChatService, ReactionService, PresenceService, WebRTCService, MediaService, RoomService)
  ↓
Room-Scoped Socket State Broadcasts (room:state, media:state, chat:message, reaction:event, presence:state, webrtc:*)
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
* `room:reconnect` — Reconnect to a room using `{ roomId, userId, reconnectToken }`
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
* `chat:send` — Send chat message `{ message: string }` (Room members only)
* `reaction:send` — Send floating reaction `{ emoji: string }` (Room members only)
* `webrtc:peer-ready` — Announce WebRTC peer readiness (Room members only)
* `webrtc:offer` — Send WebRTC SDP offer `{ targetUserId: string, sdp: { type: "offer", sdp: string } }` (Room members only)
* `webrtc:answer` — Send WebRTC SDP answer `{ targetUserId: string, sdp: { type: "answer", sdp: string } }` (Room members only)
* `webrtc:ice-candidate` — Relay ICE candidate `{ targetUserId: string, candidate: { candidate: string, sdpMid?, sdpMLineIndex? } }` (Room members only)
* `webrtc:file-metadata` — Offer local file metadata `{ targetUserId?, fileId?, name: string, size: number, mimeType: string }` (Room members only)

### Server → Client

* `room:state` — Broadcasts updated public room state
* `room:user-joined` — Emitted when a new user joins
* `room:user-left` — Emitted when a user leaves or disconnects permanently
* `media:state` — Emitted to room members on media mutation and upon late join or reconnect
* `chat:message` — Broadcasts new chat message to room members
* `chat:history` — Emitted to joining socket with bounded room chat history (max 100)
* `reaction:event` — Broadcasts ephemeral floating reaction to room members
* `presence:state` — Emitted to room members on join, leave, disconnect, or reconnect containing active connected users list
* `webrtc:peer-ready` — Broadcasts peer readiness to room members with `{ userId, displayName, socketId }`
* `webrtc:offer` — Relays SDP offer directly to target peer with trusted `{ senderUserId, senderDisplayName, sdp }`
* `webrtc:answer` — Relays SDP answer directly to target peer with trusted `{ senderUserId, senderDisplayName, sdp }`
* `webrtc:ice-candidate` — Relays ICE candidate directly to target peer with trusted `{ senderUserId, candidate }`
* `webrtc:file-offer` — Relays local file metadata offer to target peer or room with trusted `{ senderUserId, senderDisplayName, fileId, name, size, mimeType }`
* `webrtc:peer-left` — Broadcasts to room members when a WebRTC peer leaves or disconnects permanently `{ userId }`

## Permission & Security Model

1. **Server-Authoritative Authorization**: Centralized `permissionService` evaluates capabilities based on server state (`getUserRole(roomId, userId)`).
2. **Roles & Capabilities**:
   * `host`: Has `ROOM_MANAGE`, `ROOM_LOCK`, `HOST_TRANSFER`, `MEDIA_CONTROL`.
   * `member`: Standard room member without administrative or media control capabilities.
3. **Atomic Host Transfer**: Exactly one host exists per room. Upon transfer, old host loses host privileges immediately and new host receives host privileges immediately. Target must be an active connected user in the same room.
4. **Anti-Spoofing & Context Validation**: Client-supplied role, hostId, actingUserId, displayName, senderUserId, or roomId payloads in socket events (`chat:send`, `reaction:send`, `webrtc:*`, `media:*`, `room:*`) are strictly ignored. All socket authorization uses trusted `socket.data.roomId` and `socket.data.userId`.
5. **Chat Validation & Sanitization**: Chat messages must be non-empty strings (max 500 characters). HTML tags (`<`, `>`, `"`, `'`, `&`) are sanitized before broadcasting/storage.
6. **Reaction Whitelisting**: Reactions are strictly validated against an allowed set (`👍`, `❤️`, `😂`, `😮`, `😢`, `🔥`, `🎉`, `👏`). Invalid or arbitrary string payloads are rejected with `INVALID_REACTION`.
7. **WebRTC Target & Payload Validation**: WebRTC signaling (`offer`, `answer`, `ice-candidate`, `file-metadata`) requires both sender and target to be active connected members of the same room (`socket.data.roomId`). SDP strings are capped at 32KB (`INVALID_WEBRTC_SIGNAL`), ICE candidate strings capped at 8KB (`INVALID_WEBRTC_SIGNAL`), and file size declared limit is capped at 10GB (`INVALID_FILE_METADATA`).
8. **Reconnection Security & Token Validation**: Server issues UUID `reconnectToken` upon room join. Reconnections require matching `roomId`, `userId`, and `reconnectToken`. Forged or cross-room reconnection attempts fail cleanly with `INVALID_RECONNECT_TOKEN` / `SESSION_EXPIRED`.
9. **Room Isolation**: Users from Room A cannot inspect, manage, transfer host, lock/unlock, alter media, send chat, trigger reactions, relay WebRTC signals, target peers, or receive presence updates from Room B.
10. **Failure Atomicity**: Unauthorized or invalid operations fail cleanly with appropriate HTTP 403 / socket error codes without side-effects.

## Key Rules & Synchronization Rules Engine

1. **Room Codes**: Unique `SYNC-XXXXX` format (5 uppercase alphanumeric characters).
2. **Capacity Limit**: Maximum 10 connected users per room (including the host).
3. **Roles & Host-Only Controls**: Only the host can lock/unlock, transfer host, and execute media controls (`media:set`, `media:play`, `media:pause`, `media:seek`, `media:rate`, `media:clear`). Non-hosts receive `403` error (`HOST_TRANSFER_FORBIDDEN`, `MEDIA_CONTROL_FORBIDDEN`, `FORBIDDEN`).
4. **YouTube Source Validation**: Accepts 11-char video IDs and standard YouTube URLs. Rejects HTML/script/iframe payloads.
5. **Server-Authoritative Time**: Playback `position` and `updatedAt` are anchored by the server. When `status === "playing"`, effective position is computed as `position + ((serverNow - updatedAt) / 1000) * playbackRate`.
6. **Playback Rates**: Supported rates are `0.25`, `0.5`, `0.75`, `1`, `1.25`, `1.5`, `1.75`, `2`.
7. **Versioning**: Every successful media mutation increments `version` by 1. Failed operations do not increment `version`.
8. **Late Join & Reconnect Synchronization**: Upon joining or reconnecting to a room, clients immediately receive current authoritative `media:state` and bounded `chat:history`.
9. **Ephemeral Floating Reactions**: Reactions are real-time room events (`reaction:event`) that are not persisted for late joiners.
10. **Server-Authoritative Presence**: Presence state (`presence:state`) is computed from active connected room members and broadcasted on room join, leave, disconnect, or reconnect.
11. **WebRTC P2P Signaling & File Coordination**: Pure Socket.IO signaling control plane. Zero server media relaying or file storage. File bytes travel directly peer-to-peer via WebRTC `RTCDataChannel`.
12. **30-Second Disconnect Grace Period**: Unexpected socket drops preserve logical user state, host status, and WebRTC peer binding for 30 seconds. On reconnect, full session state is restored.
13. **Room Isolation**: Media state, chat messages, reactions, presence state, WebRTC signals, socket events, and permissions are strictly isolated per room.

## Deferred Scope (Future Phases)

* **B8**: Production audit & deployment readiness
