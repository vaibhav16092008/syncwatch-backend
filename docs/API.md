# SyncWatch Backend — API Documentation

> **Version**: 1.0.0  
> **Transport**: HTTP (REST) + Socket.IO (WebSocket)  
> **Base URL**: `http://localhost:5000` (default)  
> **Source of truth**: Current `main` branch

---

## Table of Contents

1. [Overview](#1-overview)
2. [Connection](#2-connection)
3. [Authentication & Identity Model](#3-authentication--identity-model)
4. [REST API Endpoints](#4-rest-api-endpoints)
5. [Socket.IO Events — Room Lifecycle](#5-socketio-events--room-lifecycle)
6. [Socket.IO Events — Media Synchronization](#6-socketio-events--media-synchronization)
7. [Socket.IO Events — Chat](#7-socketio-events--chat)
8. [Socket.IO Events — Reactions](#8-socketio-events--reactions)
9. [Socket.IO Events — Presence](#9-socketio-events--presence)
10. [Socket.IO Events — WebRTC Signaling](#10-socketio-events--webrtc-signaling)
11. [Socket.IO Events — Reconnection](#11-socketio-events--reconnection)
12. [Server-Broadcast Events (Server → All)](#12-server-broadcast-events-server--all)
13. [Data Models](#13-data-models)
14. [Error Codes](#14-error-codes)
15. [Validation Rules](#15-validation-rules)
16. [Permissions & Role System](#16-permissions--role-system)
17. [Rate Limiting](#17-rate-limiting)
18. [Security Headers](#18-security-headers)
19. [System Limits & Constraints](#19-system-limits--constraints)
20. [Environment Configuration](#20-environment-configuration)

---

## 1. Overview

SyncWatch is a real-time watch-party backend that lets users create rooms, synchronize media playback (YouTube), chat, react, coordinate local file sharing via WebRTC signaling, and reconnect after unexpected disconnects.

**Architecture highlights**:

- **In-memory state** — No database. All room, user, media, chat, and WebRTC state is stored in memory. State is lost on server restart.
- **Server-authoritative** — The server generates all IDs, timestamps, roles, and tokens. Client-supplied identity fields (userId, roomId, role) in payloads are ignored; the server uses the trusted `socket.data` context instead.
- **Socket.IO as primary transport** — All real-time operations use Socket.IO. REST endpoints are used only for room creation, room lookup, and media state retrieval.

---

## 2. Connection

### 2.1 Socket.IO Connection

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  transports: ['websocket', 'polling']
});
```

| Parameter | Value |
|---|---|
| Default port | `5000` |
| CORS origin | Value of `CLIENT_URL` env var (default `http://localhost:3000`) |
| Max HTTP buffer size | 64 KB |
| Allowed methods | `GET`, `POST` |

### 2.2 REST Base URL

All REST endpoints are prefixed with `/api`.

```
http://localhost:5000/api
```

---

## 3. Authentication & Identity Model

SyncWatch does **not** use traditional authentication (no JWT, no sessions, no login).

### How identity works:

1. **Room creation** (`POST /api/rooms`) returns a `hostUserId` and a `user` object.
2. **Joining a room** (`room:join`) returns a `user` object with `userId` and `reconnectToken`.
3. After joining, the server stores `socket.data.roomId` and `socket.data.userId` on the socket connection. **All subsequent events use this trusted server-side context.**
4. The `reconnectToken` (server-generated UUID) is used only for reconnection after unexpected disconnects.

### Anti-spoofing guarantees:

- Client cannot choose or override their `userId`, `roomId`, or `role`.
- Payloads containing `userId`, `roomId`, or `role` fields are **ignored** by all socket handlers. The server always reads from `socket.data`.

---

## 4. REST API Endpoints

### 4.1 Health Check

```
GET /api/health
```

**Response** `200 OK`:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "syncwatch-server"
  }
}
```

---

### 4.2 Create Room

```
POST /api/rooms
```

Creates a new room and assigns the creator as host.

**Request body** (`application/json`):

| Field | Type | Required | Constraints |
|---|---|---|---|
| `name` | `string` | Yes | 1–50 characters after trim |
| `mode` | `string` | Yes | `"youtube"` or `"local"` |
| `displayName` | `string` | Yes | 2–24 characters after trim |

**Response** `201 Created`:

```json
{
  "success": true,
  "data": {
    "room": {
      "id": "SYNC-A1B2C",
      "roomId": "SYNC-A1B2C",
      "name": "Movie Night",
      "mode": "youtube",
      "locked": false,
      "maxUsers": 10,
      "hostId": "uuid-host-id",
      "users": [
        {
          "id": "uuid-host-id",
          "userId": "uuid-host-id",
          "name": "Alice",
          "displayName": "Alice",
          "role": "host",
          "reconnectToken": "uuid-reconnect-token",
          "joinedAt": 1700000000000,
          "connected": true
        }
      ],
      "userCount": 1,
      "media": {
        "source": null,
        "status": "paused",
        "position": 0,
        "playbackRate": 1,
        "updatedAt": 0,
        "version": 0
      },
      "emptySince": null
    },
    "hostUserId": "uuid-host-id",
    "user": {
      "id": "uuid-host-id",
      "userId": "uuid-host-id",
      "displayName": "Alice",
      "role": "host",
      "socketId": null,
      "reconnectToken": "uuid-reconnect-token",
      "joinedAt": 1700000000000,
      "connected": true,
      "disconnectedAt": null
    }
  }
}
```

**Error responses**:

| Code | Error Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing/invalid `name` or `mode` |
| 400 | `INVALID_DISPLAY_NAME` | Missing/invalid `displayName` |

---

### 4.3 Get Room Info

```
GET /api/rooms/:roomId
```

Returns public room information (no user list, no media details).

**Path parameters**:

| Parameter | Type | Format |
|---|---|---|
| `roomId` | `string` | `SYNC-XXXXX` (case-insensitive) |

**Response** `200 OK`:

```json
{
  "success": true,
  "data": {
    "room": {
      "id": "SYNC-A1B2C",
      "roomId": "SYNC-A1B2C",
      "name": "Movie Night",
      "mode": "youtube",
      "locked": false,
      "maxUsers": 10,
      "userCount": 3
    }
  }
}
```

**Error responses**:

| Code | Error Code | Condition |
|---|---|---|
| 400 | `INVALID_ROOM_CODE` | Invalid room code format |
| 404 | `ROOM_NOT_FOUND` | Room does not exist |

---

### 4.4 Get Media State

```
GET /api/rooms/:roomId/media
```

Returns the current media playback state for a room.

**Path parameters**:

| Parameter | Type | Format |
|---|---|---|
| `roomId` | `string` | `SYNC-XXXXX` (case-insensitive) |

**Response** `200 OK`:

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
      "position": 42.5,
      "playbackRate": 1,
      "updatedAt": 1700000010000,
      "version": 3
    }
  }
}
```

> **Note**: When `status` is `"playing"`, the `position` returned is the server-computed effective position accounting for elapsed time since `updatedAt`.

**Error responses**:

| Code | Error Code | Condition |
|---|---|---|
| 400 | `INVALID_ROOM_CODE` | Invalid room code format |
| 404 | `ROOM_NOT_FOUND` | Room does not exist |

---

### 4.5 404 Handler

Any request to an undefined route returns:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found"
  }
}
```

---

### 4.6 REST Response Envelope

All REST responses use a consistent envelope:

**Success**:
```json
{
  "success": true,
  "data": { ... }
}
```

**Error**:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": null
  }
}
```

The `details` field is present only when the server provides additional error context (e.g., Zod validation details).

---

## 5. Socket.IO Events — Room Lifecycle

All Socket.IO event callbacks use the ack pattern:

```js
socket.emit('event:name', payload, (response) => {
  if (response.success) {
    // response.data
  } else {
    // response.error.code, response.error.message
  }
});
```

---

### 5.1 `room:join`

**Direction**: Client → Server

Join an existing room. After the REST `POST /api/rooms` creates the room and returns the host user, the host must also call `room:join` is **not** needed for the host — the host's `socketId` is set to `null` on creation. The host should emit `room:join` after connecting via Socket.IO.

> **Important**: The room creator (host) receives their `userId` and `reconnectToken` from the `POST /api/rooms` response. They must then connect via Socket.IO and emit `room:join` to bind their socket to the room.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `roomId` | `string` | Yes | `SYNC-XXXXX` format, case-insensitive |
| `displayName` | `string` | Yes | 2–24 characters after trim |

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-user-id",
      "userId": "uuid-user-id",
      "displayName": "Bob",
      "role": "member",
      "reconnectToken": "uuid-reconnect-token",
      "joinedAt": 1700000005000,
      "connected": true
    },
    "room": { }
  }
}
```

> The `room` field contains the full [PublicRoomState](#131-publicroomstate) object.

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `media:state` | Joining socket only | Current [MediaState](#133-mediastate) |
| `chat:history` | Joining socket only | `{ messages: ChatMessage[] }` |
| `presence:state` | Entire room | `{ users: PresenceUser[] }` |
| `room:user-joined` | Room (excluding joiner) | `{ user: User }` |
| `room:state` | Entire room | [PublicRoomState](#131-publicroomstate) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `INVALID_ROOM_CODE` | Invalid room code format |
| `INVALID_DISPLAY_NAME` | Display name too short/long |
| `ROOM_NOT_FOUND` | Room does not exist |
| `ROOM_LOCKED` | Room is locked |
| `ROOM_FULL` | Room has reached max capacity (10 users) |
| `INVALID_DISPLAY_NAME` | Display name already in use in this room (case-insensitive) |

---

### 5.2 `room:leave`

**Direction**: Client → Server

Explicitly leave the current room. This is a **permanent** departure — the user is fully removed, and their `reconnectToken` is invalidated.

**Payload**: None required (can be omitted or `{}`).

**Success response** (ack callback):

```json
{
  "success": true
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `room:user-left` | Room (excluding leaver) | `{ userId: string }` |
| `webrtc:peer-left` | Room (excluding leaver) | `{ userId: string }` |
| `room:state` | Entire room | Updated [PublicRoomState](#131-publicroomstate) |
| `presence:state` | Entire room | `{ users: PresenceUser[] }` |

**Host departure behavior**: If the host leaves, the server automatically transfers host to the next connected user (by join order). If no connected users remain, `hostUserId` is set to `null`.

---

### 5.3 `room:lock`

**Direction**: Client → Server  
**Permission**: Host only

Lock the room to prevent new users from joining.

**Payload**: None required.

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "room": { }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `room:state` | Entire room | Updated [PublicRoomState](#131-publicroomstate) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `FORBIDDEN` | Caller is not the host |

---

### 5.4 `room:unlock`

**Direction**: Client → Server  
**Permission**: Host only

Unlock the room to allow new users to join.

**Payload**: None required.

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "room": { }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `room:state` | Entire room | Updated [PublicRoomState](#131-publicroomstate) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `FORBIDDEN` | Caller is not the host |

---

### 5.5 `room:transfer-host`

**Direction**: Client → Server  
**Permission**: Host only

Transfer host privileges to another connected user.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `targetUserId` | `string` | Yes | Non-empty string after trim |

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "room": { }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `room:state` | Entire room | Updated [PublicRoomState](#131-publicroomstate) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `HOST_TRANSFER_FORBIDDEN` | Caller is not the host |
| `USER_NOT_FOUND` | Target user not found in room |
| `HOST_TRANSFER_FORBIDDEN` | Target user is disconnected |

---

## 6. Socket.IO Events — Media Synchronization

All media events require the caller to be:
1. A connected member of the room (`socket.data.roomId` and `socket.data.userId` must be set).
2. The room host (permission: `MEDIA_CONTROL`).

---

### 6.1 `media:set`

**Direction**: Client → Server  
**Permission**: Host only

Set the media source for the room. Resets playback to position 0, paused state, and playback rate 1.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `type` | `string` | Yes | Must be `"youtube"` |
| `mediaId` | `string` | Yes | Valid YouTube video ID or URL |

> The server accepts YouTube video IDs (11-character alphanumeric strings) and full YouTube URLs in these formats:
> - `dQw4w9WgXcQ` (raw ID)
> - `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
> - `https://youtu.be/dQw4w9WgXcQ`
> - `https://www.youtube.com/embed/dQw4w9WgXcQ`
>
> The server extracts and normalizes the 11-character video ID.

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "media": { }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `media:state` | Entire room | Updated [MediaState](#133-mediastate) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `MEDIA_CONTROL_FORBIDDEN` | Caller is not the host |
| `INVALID_MEDIA_SOURCE` | Invalid YouTube ID/URL or `type` is not `"youtube"` |

---

### 6.2 `media:play`

**Direction**: Client → Server  
**Permission**: Host only

Start or resume media playback at a given position.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `position` | `number` | Yes | Finite, ≥ 0 (seconds) |

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "media": { }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `media:state` | Entire room | Updated [MediaState](#133-mediastate) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `MEDIA_CONTROL_FORBIDDEN` | Caller is not the host |
| `MEDIA_NOT_FOUND` | No media source is loaded |
| `INVALID_MEDIA_POSITION` | Invalid position value |

---

### 6.3 `media:pause`

**Direction**: Client → Server  
**Permission**: Host only

Pause media playback at a given position.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `position` | `number` | Yes | Finite, ≥ 0 (seconds) |

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "media": { }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `media:state` | Entire room | Updated [MediaState](#133-mediastate) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `MEDIA_CONTROL_FORBIDDEN` | Caller is not the host |
| `MEDIA_NOT_FOUND` | No media source is loaded |
| `INVALID_MEDIA_POSITION` | Invalid position value |

---

### 6.4 `media:seek`

**Direction**: Client → Server  
**Permission**: Host only

Seek to a specific position without changing play/pause state.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `position` | `number` | Yes | Finite, ≥ 0 (seconds) |

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "media": { }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `media:state` | Entire room | Updated [MediaState](#133-mediastate) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `MEDIA_CONTROL_FORBIDDEN` | Caller is not the host |
| `MEDIA_NOT_FOUND` | No media source is loaded |
| `INVALID_MEDIA_POSITION` | Invalid position value |

---

### 6.5 `media:rate`

**Direction**: Client → Server  
**Permission**: Host only

Change the playback speed.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `playbackRate` | `number` | Yes | One of: `0.25`, `0.5`, `0.75`, `1`, `1.25`, `1.5`, `1.75`, `2` |

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "media": { }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `media:state` | Entire room | Updated [MediaState](#133-mediastate) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `MEDIA_CONTROL_FORBIDDEN` | Caller is not the host |
| `MEDIA_NOT_FOUND` | No media source is loaded |
| `INVALID_PLAYBACK_RATE` | Invalid playback rate value |

---

### 6.6 `media:clear`

**Direction**: Client → Server  
**Permission**: Host only

Clear the current media source. Resets to no media loaded.

**Payload**: None required.

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "media": { }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `media:state` | Entire room | Updated [MediaState](#133-mediastate) with `source: null` |

**Error responses**:

| Error Code | Condition |
|---|---|
| `MEDIA_CONTROL_FORBIDDEN` | Caller is not the host |

---

## 7. Socket.IO Events — Chat

### 7.1 `chat:send`

**Direction**: Client → Server

Send a chat message to the current room.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `message` | `string` | Yes | Non-empty after trim, max 500 characters |

> Messages are HTML-sanitized server-side: `&`, `<`, `>`, `"`, `'` are escaped to prevent XSS.

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "message": {
      "id": "uuid-message-id",
      "roomId": "SYNC-A1B2C",
      "userId": "uuid-user-id",
      "displayName": "Bob",
      "message": "Hello everyone!",
      "createdAt": 1700000010000
    }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `chat:message` | Entire room | [ChatMessage](#134-chatmessage) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `NOT_ROOM_MEMBER` | Caller is not in a room |
| `INVALID_CHAT_MESSAGE` | Message is empty, whitespace-only, or not a string |
| `CHAT_MESSAGE_TOO_LONG` | Message exceeds 500 characters |

---

### 7.2 `chat:message` (Server → Client)

**Direction**: Server → Client

Broadcast to the entire room when a new chat message is sent.

**Payload**: [ChatMessage](#134-chatmessage)

```json
{
  "id": "uuid-message-id",
  "roomId": "SYNC-A1B2C",
  "userId": "uuid-user-id",
  "displayName": "Bob",
  "message": "Hello everyone!",
  "createdAt": 1700000010000
}
```

---

### 7.3 `chat:history` (Server → Client)

**Direction**: Server → Client (sent on `room:join` and `room:reconnect`)

Delivers the room's chat history to the joining/reconnecting client.

**Payload**:

```json
{
  "messages": [
    {
      "id": "uuid-message-id",
      "roomId": "SYNC-A1B2C",
      "userId": "uuid-user-id",
      "displayName": "Bob",
      "message": "Hello!",
      "createdAt": 1700000010000
    }
  ]
}
```

> Maximum 100 messages are stored per room (FIFO eviction). History is in-memory only.

---

## 8. Socket.IO Events — Reactions

### 8.1 `reaction:send`

**Direction**: Client → Server

Send a floating reaction to the room.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `emoji` | `string` | Yes | Must be one of the allowed emojis |

**Allowed emojis**: `👍` `❤️` `😂` `😮` `😢` `🔥` `🎉` `👏`

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "reaction": {
      "id": "uuid-reaction-id",
      "roomId": "SYNC-A1B2C",
      "userId": "uuid-user-id",
      "displayName": "Bob",
      "emoji": "🔥",
      "createdAt": 1700000010000
    }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `reaction:event` | Entire room | [ReactionEvent](#135-reactionevent) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `NOT_ROOM_MEMBER` | Caller is not in a room |
| `INVALID_REACTION` | Emoji is not in the allowed set |

---

### 8.2 `reaction:event` (Server → Client)

**Direction**: Server → Client

Broadcast to the entire room when a reaction is sent.

**Payload**: [ReactionEvent](#135-reactionevent)

```json
{
  "id": "uuid-reaction-id",
  "roomId": "SYNC-A1B2C",
  "userId": "uuid-user-id",
  "displayName": "Bob",
  "emoji": "🔥",
  "createdAt": 1700000010000
}
```

> Reactions are ephemeral — they are not persisted in room state.

---

## 9. Socket.IO Events — Presence

### 9.1 `presence:state` (Server → Client)

**Direction**: Server → Client (broadcast only, no client-initiated event)

Emitted to the entire room whenever the room's membership changes:
- A user joins
- A user leaves (explicitly)
- A user disconnects
- A user reconnects
- A user's grace period expires

**Payload**:

```json
{
  "users": [
    {
      "id": "uuid-user-id",
      "userId": "uuid-user-id",
      "displayName": "Alice",
      "role": "host",
      "joinedAt": 1700000000000,
      "connected": true
    },
    {
      "id": "uuid-user-id-2",
      "userId": "uuid-user-id-2",
      "displayName": "Bob",
      "role": "member",
      "joinedAt": 1700000005000,
      "connected": true
    }
  ]
}
```

> Only **connected** users (`connected === true`) are included in the presence list.

---

## 10. Socket.IO Events — WebRTC Signaling

WebRTC signaling is used for peer-to-peer coordination (e.g., local file sharing). The server acts as a signaling relay — it does **not** process media streams.

All WebRTC events require the caller to be a connected room member.

---

### 10.1 `webrtc:peer-ready`

**Direction**: Client → Server

Declare this client as ready for WebRTC peer connections.

**Payload**: None required.

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "readyPeers": [
      {
        "userId": "uuid-user-id",
        "displayName": "Alice",
        "socketId": "socket-id-string",
        "ready": true,
        "updatedAt": 1700000000000
      }
    ]
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `webrtc:peer-ready` | Room (excluding sender) | `{ userId, displayName, socketId }` |

**Error responses**:

| Error Code | Condition |
|---|---|
| `NOT_ROOM_MEMBER` | Caller is not in a room |

---

### 10.2 `webrtc:offer`

**Direction**: Client → Server → Target peer

Send an SDP offer to a specific peer in the same room.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `targetUserId` | `string` | Yes | Non-empty string |
| `sdp` | `object` | Yes | SDP object (see below) |
| `sdp.type` | `string` | Yes | Must be `"offer"` |
| `sdp.sdp` | `string` | Yes | Non-empty, max 32 KB |

**Success response** (ack callback):

```json
{
  "success": true
}
```

**Side effects on success**:

The target peer receives:

```json
// Event: webrtc:offer
{
  "senderUserId": "uuid-sender-id",
  "senderDisplayName": "Alice",
  "sdp": {
    "type": "offer",
    "sdp": "v=0\r\n..."
  }
}
```

**Error responses**:

| Error Code | Condition |
|---|---|
| `NOT_ROOM_MEMBER` | Caller is not in a room |
| `INVALID_WEBRTC_SIGNAL` | Invalid payload structure, missing fields, or SDP too large |
| `PEER_NOT_IN_ROOM` | Target user is not a connected member of the same room |

---

### 10.3 `webrtc:answer`

**Direction**: Client → Server → Target peer

Send an SDP answer to a specific peer in the same room.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `targetUserId` | `string` | Yes | Non-empty string |
| `sdp` | `object` | Yes | SDP object (see below) |
| `sdp.type` | `string` | Yes | Must be `"answer"` |
| `sdp.sdp` | `string` | Yes | Non-empty, max 32 KB |

**Success response** (ack callback):

```json
{
  "success": true
}
```

**Side effects on success**:

The target peer receives:

```json
// Event: webrtc:answer
{
  "senderUserId": "uuid-sender-id",
  "senderDisplayName": "Alice",
  "sdp": {
    "type": "answer",
    "sdp": "v=0\r\n..."
  }
}
```

**Error responses**:

| Error Code | Condition |
|---|---|
| `NOT_ROOM_MEMBER` | Caller is not in a room |
| `INVALID_WEBRTC_SIGNAL` | Invalid payload structure |
| `PEER_NOT_IN_ROOM` | Target user not in the same room |

---

### 10.4 `webrtc:ice-candidate`

**Direction**: Client → Server → Target peer

Relay an ICE candidate to a specific peer in the same room.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `targetUserId` | `string` | Yes | Non-empty string |
| `candidate` | `object` | Yes | ICE candidate object |
| `candidate.candidate` | `string` | Yes | Non-empty, max 8 KB |
| `candidate.sdpMid` | `string` | No | Optional |
| `candidate.sdpMLineIndex` | `number` | No | Optional |

**Success response** (ack callback):

```json
{
  "success": true
}
```

**Side effects on success**:

The target peer receives:

```json
// Event: webrtc:ice-candidate
{
  "senderUserId": "uuid-sender-id",
  "candidate": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

**Error responses**:

| Error Code | Condition |
|---|---|
| `NOT_ROOM_MEMBER` | Caller is not in a room |
| `INVALID_WEBRTC_SIGNAL` | Invalid payload structure or candidate too large |
| `PEER_NOT_IN_ROOM` | Target user not in the same room |

---

### 10.5 `webrtc:file-metadata`

**Direction**: Client → Server

Announce a file available for sharing. Can target a specific peer or broadcast to the room.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `targetUserId` | `string` | No | If omitted, broadcasts to entire room |
| `fileId` | `string` | No | If omitted, server generates a UUID |
| `name` | `string` | Yes | Non-empty, max 255 characters |
| `size` | `number` | Yes | Positive integer, max 10 GB (10,737,418,240 bytes) |
| `mimeType` | `string` | Yes | Non-empty, max 128 characters |

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "fileId": "uuid-file-id",
    "metadata": {
      "fileId": "uuid-file-id",
      "senderUserId": "uuid-sender-id",
      "senderDisplayName": "Alice",
      "name": "movie.mp4",
      "size": 1048576,
      "mimeType": "video/mp4"
    }
  }
}
```

**Side effects on success**:

| Scenario | Event | Target |
|---|---|---|
| `targetUserId` provided | `webrtc:file-offer` | Target peer only |
| `targetUserId` omitted | `webrtc:file-offer` | Room (excluding sender) |

**`webrtc:file-offer` payload**:

```json
{
  "fileId": "uuid-file-id",
  "senderUserId": "uuid-sender-id",
  "senderDisplayName": "Alice",
  "name": "movie.mp4",
  "size": 1048576,
  "mimeType": "video/mp4"
}
```

**Error responses**:

| Error Code | Condition |
|---|---|
| `NOT_ROOM_MEMBER` | Caller is not in a room |
| `INVALID_FILE_METADATA` | Missing/invalid file metadata fields |
| `PEER_NOT_IN_ROOM` | Target user not in the same room |

---

### 10.6 `webrtc:peer-left` (Server → Client)

**Direction**: Server → Client

Broadcast when a user leaves or is disconnected/expired.

**Payload**:

```json
{
  "userId": "uuid-user-id"
}
```

---

## 11. Socket.IO Events — Reconnection

### 11.1 `room:reconnect`

**Direction**: Client → Server

Reconnect to a room after an unexpected disconnect, within the 30-second grace period.

**Payload**:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `roomId` | `string` | Yes | `SYNC-XXXXX` format |
| `userId` | `string` | Yes | Non-empty string |
| `reconnectToken` | `string` | Yes | Non-empty string |

**Success response** (ack callback):

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-user-id",
      "userId": "uuid-user-id",
      "displayName": "Alice",
      "role": "host",
      "reconnectToken": "uuid-reconnect-token",
      "joinedAt": 1700000000000,
      "connected": true
    },
    "room": { }
  }
}
```

**Side effects on success**:

| Event | Target | Payload |
|---|---|---|
| `media:state` | Reconnecting socket only | Current [MediaState](#133-mediastate) |
| `chat:history` | Reconnecting socket only | `{ messages: ChatMessage[] }` |
| `presence:state` | Entire room | `{ users: PresenceUser[] }` |
| `room:state` | Entire room | [PublicRoomState](#131-publicroomstate) |

**Error responses**:

| Error Code | Condition |
|---|---|
| `INVALID_ROOM_CODE` | Invalid room code format |
| `ROOM_NOT_FOUND` | Room no longer exists |
| `SESSION_EXPIRED` | User not found in room (grace period may have expired) |
| `INVALID_RECONNECT_TOKEN` | Token mismatch or identity mismatch |

### 11.2 Disconnect & Grace Period Behavior

When a Socket.IO connection drops unexpectedly:

1. The server marks the user as `connected: false` with a `disconnectedAt` timestamp.
2. A **30-second grace period** timer starts.
3. During the grace period, the user's slot is preserved — they can reconnect via `room:reconnect` with their `reconnectToken`.
4. `presence:state` and `room:state` are broadcast to the room (showing the user as disconnected).

**If the grace period expires** (user does not reconnect):

1. The user is permanently removed from the room.
2. WebRTC peer state for the user is cleaned up.
3. The following events are broadcast:
   - `room:user-left` — `{ userId }`
   - `webrtc:peer-left` — `{ userId }`
   - `room:state` — Updated state
   - `presence:state` — Updated presence

**Stale disconnect protection**: If a user reconnects with a new socket and the old socket then fires a `disconnect` event, the stale disconnect is ignored (the stored `socketId` no longer matches).

---

## 12. Server-Broadcast Events (Server → All)

These events are emitted by the server — clients should listen for them but never emit them.

| Event | Payload | When emitted |
|---|---|---|
| `room:state` | [PublicRoomState](#131-publicroomstate) | Any room state change (join, leave, lock, transfer, media change, reconnect, grace expiry) |
| `room:user-joined` | `{ user: User }` | A new user joins the room |
| `room:user-left` | `{ userId: string }` | A user permanently leaves (explicit leave or grace expiry) |
| `media:state` | [MediaState](#133-mediastate) | Any media change (set, play, pause, seek, rate, clear) and on join/reconnect (to joining socket only) |
| `chat:message` | [ChatMessage](#134-chatmessage) | A new chat message is sent |
| `chat:history` | `{ messages: ChatMessage[] }` | Sent to joining/reconnecting socket only |
| `presence:state` | `{ users: PresenceUser[] }` | Any membership change |
| `reaction:event` | [ReactionEvent](#135-reactionevent) | A reaction is sent |
| `webrtc:peer-ready` | `{ userId, displayName, socketId }` | A peer declares WebRTC readiness |
| `webrtc:peer-left` | `{ userId: string }` | A peer leaves or is expired |
| `webrtc:offer` | `{ senderUserId, senderDisplayName, sdp }` | SDP offer relayed to target |
| `webrtc:answer` | `{ senderUserId, senderDisplayName, sdp }` | SDP answer relayed to target |
| `webrtc:ice-candidate` | `{ senderUserId, candidate }` | ICE candidate relayed to target |
| `webrtc:file-offer` | `{ fileId, senderUserId, senderDisplayName, name, size, mimeType }` | File metadata shared with target(s) |

---

## 13. Data Models

### 13.1 PublicRoomState

Returned in `room:state` broadcasts and ack `data.room` fields.

```json
{
  "id": "SYNC-A1B2C",
  "roomId": "SYNC-A1B2C",
  "name": "Movie Night",
  "mode": "youtube",
  "locked": false,
  "maxUsers": 10,
  "hostId": "uuid-host-id",
  "users": [
    {
      "id": "uuid-user-id",
      "userId": "uuid-user-id",
      "name": "Alice",
      "displayName": "Alice",
      "role": "host",
      "reconnectToken": "uuid-reconnect-token",
      "joinedAt": 1700000000000,
      "connected": true
    }
  ],
  "userCount": 1,
  "media": { },
  "emptySince": null
}
```

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Room code (`SYNC-XXXXX`) |
| `roomId` | `string` | Same as `id` |
| `name` | `string` | Room display name |
| `mode` | `string` | `"youtube"` or `"local"` |
| `locked` | `boolean` | Whether the room is locked |
| `maxUsers` | `number` | Maximum users allowed (always 10) |
| `hostId` | `string \| null` | Current host's user ID |
| `users` | `User[]` | All users (connected and disconnected) |
| `userCount` | `number` | Count of connected users only |
| `media` | `MediaState` | Current media state |
| `emptySince` | `number \| null` | Timestamp when room became empty, or `null` |

---

### 13.2 User

```json
{
  "id": "uuid-user-id",
  "userId": "uuid-user-id",
  "name": "Alice",
  "displayName": "Alice",
  "role": "host",
  "reconnectToken": "uuid-reconnect-token",
  "joinedAt": 1700000000000,
  "connected": true
}
```

| Field | Type | Description |
|---|---|---|
| `id` | `string` | User UUID |
| `userId` | `string` | Same as `id` |
| `name` | `string` | Same as `displayName` |
| `displayName` | `string` | User's display name |
| `role` | `string` | `"host"` or `"member"` |
| `reconnectToken` | `string` | Server-generated reconnection token |
| `joinedAt` | `number` | Unix timestamp (ms) when user joined |
| `connected` | `boolean` | Whether user is currently connected |

> **Security note**: `reconnectToken` is included in the `PublicRoomState` broadcast. Clients should treat it as sensitive and store it securely for reconnection.

---

### 13.3 MediaState

```json
{
  "source": {
    "type": "youtube",
    "mediaId": "dQw4w9WgXcQ"
  },
  "status": "playing",
  "position": 42.5,
  "playbackRate": 1,
  "updatedAt": 1700000010000,
  "version": 3
}
```

| Field | Type | Description |
|---|---|---|
| `source` | `object \| null` | Media source, `null` if no media loaded |
| `source.type` | `string` | `"youtube"` |
| `source.mediaId` | `string` | YouTube video ID (11 characters) |
| `status` | `string` | `"playing"` or `"paused"` |
| `position` | `number` | Current playback position in seconds |
| `playbackRate` | `number` | Current playback speed multiplier |
| `updatedAt` | `number` | Unix timestamp (ms) of last state change |
| `version` | `number` | Monotonically increasing version counter |

> **Position computation**: When `status` is `"playing"`, the server computes the effective position as:
> `position + ((Date.now() - updatedAt) / 1000) * playbackRate`
> This allows late-joining clients to sync accurately.

---

### 13.4 ChatMessage

```json
{
  "id": "uuid-message-id",
  "roomId": "SYNC-A1B2C",
  "userId": "uuid-user-id",
  "displayName": "Bob",
  "message": "Hello everyone!",
  "createdAt": 1700000010000
}
```

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Server-generated UUID |
| `roomId` | `string` | Room the message belongs to |
| `userId` | `string` | Sender's user ID |
| `displayName` | `string` | Sender's display name at time of sending |
| `message` | `string` | HTML-sanitized message text |
| `createdAt` | `number` | Unix timestamp (ms) |

---

### 13.5 ReactionEvent

```json
{
  "id": "uuid-reaction-id",
  "roomId": "SYNC-A1B2C",
  "userId": "uuid-user-id",
  "displayName": "Bob",
  "emoji": "🔥",
  "createdAt": 1700000010000
}
```

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Server-generated UUID |
| `roomId` | `string` | Room the reaction belongs to |
| `userId` | `string` | Sender's user ID |
| `displayName` | `string` | Sender's display name |
| `emoji` | `string` | One of the allowed emoji values |
| `createdAt` | `number` | Unix timestamp (ms) |

---

### 13.6 PresenceUser

```json
{
  "id": "uuid-user-id",
  "userId": "uuid-user-id",
  "displayName": "Alice",
  "role": "host",
  "joinedAt": 1700000000000,
  "connected": true
}
```

| Field | Type | Description |
|---|---|---|
| `id` | `string` | User UUID |
| `userId` | `string` | Same as `id` |
| `displayName` | `string` | Display name |
| `role` | `string` | `"host"` or `"member"` |
| `joinedAt` | `number` | Unix timestamp (ms) |
| `connected` | `boolean` | Always `true` (only connected users are included) |

---

### 13.7 WebRTC Peer

```json
{
  "userId": "uuid-user-id",
  "displayName": "Alice",
  "socketId": "socket-id-string",
  "ready": true,
  "updatedAt": 1700000000000
}
```

| Field | Type | Description |
|---|---|---|
| `userId` | `string` | Peer's user ID |
| `displayName` | `string` | Peer's display name |
| `socketId` | `string` | Peer's Socket.IO socket ID |
| `ready` | `boolean` | Always `true` for ready peers |
| `updatedAt` | `number` | Unix timestamp (ms) |

---

## 14. Error Codes

All error responses (REST and Socket.IO) use the following error codes:

| Error Code | Description |
|---|---|
| `VALIDATION_ERROR` | Generic payload validation failure |
| `NOT_FOUND` | Route or resource not found |
| `UNAUTHORIZED` | Authentication required (reserved) |
| `FORBIDDEN` | Action not allowed for current user |
| `RATE_LIMITED` | Too many requests |
| `INTERNAL_ERROR` | Unexpected server error |
| `ROOM_NOT_FOUND` | Room with given ID does not exist |
| `ROOM_FULL` | Room has reached maximum capacity (10 users) |
| `ROOM_LOCKED` | Room is locked, new joins are blocked |
| `INVALID_ROOM_CODE` | Room code does not match `SYNC-XXXXX` format |
| `INVALID_DISPLAY_NAME` | Display name fails validation (length, duplicates) |
| `USER_NOT_FOUND` | User not found in the specified room |
| `MEDIA_NOT_FOUND` | No media source loaded in room |
| `INVALID_MEDIA_SOURCE` | Invalid YouTube URL/ID or unsupported media type |
| `INVALID_MEDIA_POSITION` | Position is not a valid non-negative finite number |
| `INVALID_PLAYBACK_RATE` | Playback rate is not one of the allowed values |
| `MEDIA_CONTROL_FORBIDDEN` | Non-host user attempted media control |
| `PERMISSION_DENIED` | Generic permission denial |
| `INVALID_PERMISSION` | Requested capability does not exist |
| `HOST_TRANSFER_FORBIDDEN` | Non-host attempted host transfer, or target is invalid |
| `INVALID_CHAT_MESSAGE` | Chat message is empty, not a string, or fails validation |
| `CHAT_MESSAGE_TOO_LONG` | Chat message exceeds 500 characters |
| `INVALID_REACTION` | Emoji is not in the allowed set |
| `NOT_ROOM_MEMBER` | User is not a connected member of a room |
| `PEER_NOT_FOUND` | WebRTC peer user ID is missing |
| `PEER_NOT_IN_ROOM` | Target WebRTC peer is not in the same room |
| `INVALID_WEBRTC_SIGNAL` | WebRTC signaling payload is invalid |
| `INVALID_FILE_METADATA` | File metadata fails validation |
| `WEBRTC_SIGNAL_FAILED` | WebRTC signaling operation failed |
| `SESSION_EXPIRED` | Reconnection session has expired or user was removed |
| `INVALID_RECONNECT_TOKEN` | Reconnect token does not match or identity mismatch |
| `RECONNECT_FAILED` | Reconnection attempt failed |

---

## 15. Validation Rules

### 15.1 Room

| Field | Rules |
|---|---|
| Room name | String, trimmed, 1–50 characters |
| Room mode | Enum: `"youtube"`, `"local"` |
| Room code | Format: `SYNC-XXXXX` where X is alphanumeric (case-insensitive on input, normalized to uppercase) |
| Room capacity | Fixed at 10 users |

### 15.2 Display Name

| Rule | Value |
|---|---|
| Type | String |
| Length | 2–24 characters (after trim) |
| Uniqueness | Case-insensitive unique within the room (among connected users) |

### 15.3 Chat Message

| Rule | Value |
|---|---|
| Type | String |
| Length | 1–500 characters (after trim) |
| Sanitization | HTML entities escaped: `& < > " '` |
| Empty/whitespace | Rejected |

### 15.4 Reaction Emoji

| Rule | Value |
|---|---|
| Type | String |
| Allowed values | `👍` `❤️` `😂` `😮` `😢` `🔥` `🎉` `👏` |

### 15.5 Media

| Field | Rules |
|---|---|
| `type` | Must be `"youtube"` |
| `mediaId` | Valid YouTube 11-char ID or parseable YouTube URL |
| `position` | Finite number, ≥ 0 |
| `playbackRate` | One of: `0.25`, `0.5`, `0.75`, `1`, `1.25`, `1.5`, `1.75`, `2` |

### 15.6 WebRTC Signaling

| Field | Rules |
|---|---|
| `targetUserId` | Non-empty string |
| `sdp.type` | `"offer"` for offers, `"answer"` for answers |
| `sdp.sdp` | Non-empty string, max 32,768 characters (32 KB) |
| `candidate.candidate` | Non-empty string, max 8,192 characters (8 KB) |
| `candidate.sdpMid` | Optional string |
| `candidate.sdpMLineIndex` | Optional number |

### 15.7 File Metadata

| Field | Rules |
|---|---|
| `name` | Non-empty string, max 255 characters |
| `size` | Positive integer, max 10,737,418,240 (10 GB) |
| `mimeType` | Non-empty string, max 128 characters |
| `targetUserId` | Optional; non-empty string if provided |
| `fileId` | Optional; server generates UUID if omitted |

### 15.8 Reconnection

| Field | Rules |
|---|---|
| `roomId` | Valid `SYNC-XXXXX` format |
| `userId` | Non-empty string |
| `reconnectToken` | Non-empty string |

---

## 16. Permissions & Role System

### 16.1 Roles

| Role | Description |
|---|---|
| `host` | Room creator or transferred host. Has all permissions. |
| `member` | Regular room participant. No management permissions. |

### 16.2 Capabilities

| Capability | Host | Member | Used by |
|---|---|---|---|
| `roomManage` | ✅ | ❌ | Room management operations |
| `roomLock` | ✅ | ❌ | `room:lock`, `room:unlock` |
| `hostTransfer` | ✅ | ❌ | `room:transfer-host` |
| `mediaControl` | ✅ | ❌ | `media:set`, `media:play`, `media:pause`, `media:seek`, `media:rate`, `media:clear` |

### 16.3 Universal Permissions (No Role Required)

These actions are available to any connected room member:

- `chat:send`
- `reaction:send`
- `webrtc:peer-ready`
- `webrtc:offer`
- `webrtc:answer`
- `webrtc:ice-candidate`
- `webrtc:file-metadata`
- `room:leave`

### 16.4 Host Auto-Transfer

When the host leaves (explicit `room:leave`) or their grace period expires:
- The server automatically promotes the **next connected user** (by join order) to host.
- If no connected users remain, `hostUserId` is set to `null`.

---

## 17. Rate Limiting

Rate limiting applies to **REST API routes** (`/api/*`) only. Socket.IO events are not rate-limited.

| Parameter | Default Value | Configurable via |
|---|---|---|
| Window | 60,000 ms (1 minute) | `RATE_LIMIT_WINDOW_MS` |
| Max requests per window | 100 | `RATE_LIMIT_MAX_REQUESTS` |

**Response headers** (always present on `/api` responses):

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum requests per window |
| `X-RateLimit-Remaining` | Remaining requests in current window |

**When rate limited** — HTTP `429` response:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests, please try again later."
  }
}
```

**Client identification**: Uses IP address. When `TRUST_PROXY=true`, respects `X-Forwarded-For` header.

---

## 18. Security Headers

The following HTTP security headers are set on all responses:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

---

## 19. System Limits & Constraints

| Resource | Limit |
|---|---|
| Max users per room | 10 |
| Max chat messages stored per room | 100 (FIFO eviction) |
| Max chat message length | 500 characters |
| Max display name length | 24 characters |
| Min display name length | 2 characters |
| Max room name length | 50 characters |
| Allowed playback rates | 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2 |
| Allowed emojis | 👍 ❤️ 😂 😮 😢 🔥 🎉 👏 |
| REST request body size limit | 10 KB |
| Socket.IO max HTTP buffer size | 64 KB |
| SDP payload max size | 32 KB |
| ICE candidate max size | 8 KB |
| File name max length | 255 characters |
| File size max (declared) | 10 GB |
| MIME type max length | 128 characters |
| Reconnection grace period | 30 seconds |
| Room code format | `SYNC-XXXXX` (alphanumeric, uppercase) |
| State persistence | None (in-memory, lost on restart) |
| Allowed media types | `youtube` only (for `media:set`) |

---

## 20. Environment Configuration

Environment variables can be set in a `.env` file or as system environment variables.

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | `number` | `5000` | Server listen port |
| `NODE_ENV` | `string` | `development` | `development`, `production`, or `test` |
| `CLIENT_URL` | `string` | `http://localhost:3000` | CORS allowed origin |
| `LOG_LEVEL` | `string` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `RATE_LIMIT_WINDOW_MS` | `number` | `60000` | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `number` | `100` | Max requests per window |
| `TRUST_PROXY` | `boolean` | `false` | Enable Express trust proxy for reverse proxy setups |

---

## Appendix: Quick Start Integration Example

```js
// 1. Create a room (REST)
const res = await fetch('http://localhost:5000/api/rooms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Movie Night',
    mode: 'youtube',
    displayName: 'Alice'
  })
});
const { data } = await res.json();
const { room, user } = data;
// Save: room.id, user.userId, user.reconnectToken

// 2. Connect via Socket.IO
const socket = io('http://localhost:5000');

// 3. Join the room (host binds their socket)
socket.emit('room:join', {
  roomId: room.id,
  displayName: 'Alice'
}, (response) => {
  if (response.success) {
    console.log('Joined as:', response.data.user);
  }
});

// 4. Listen for events
socket.on('room:state', (state) => { /* ... */ });
socket.on('media:state', (media) => { /* ... */ });
socket.on('chat:message', (msg) => { /* ... */ });
socket.on('chat:history', ({ messages }) => { /* ... */ });
socket.on('presence:state', ({ users }) => { /* ... */ });
socket.on('reaction:event', (reaction) => { /* ... */ });
socket.on('room:user-joined', ({ user }) => { /* ... */ });
socket.on('room:user-left', ({ userId }) => { /* ... */ });
socket.on('webrtc:peer-ready', (peer) => { /* ... */ });
socket.on('webrtc:offer', (offer) => { /* ... */ });
socket.on('webrtc:answer', (answer) => { /* ... */ });
socket.on('webrtc:ice-candidate', (candidate) => { /* ... */ });
socket.on('webrtc:file-offer', (fileOffer) => { /* ... */ });
socket.on('webrtc:peer-left', ({ userId }) => { /* ... */ });

// 5. Set media (host only)
socket.emit('media:set', {
  type: 'youtube',
  mediaId: 'dQw4w9WgXcQ'
}, (res) => { /* ... */ });

// 6. Send a chat message
socket.emit('chat:send', {
  message: 'Hello everyone!'
}, (res) => { /* ... */ });

// 7. Send a reaction
socket.emit('reaction:send', {
  emoji: '🔥'
}, (res) => { /* ... */ });

// 8. Reconnect after disconnect
socket.emit('room:reconnect', {
  roomId: room.id,
  userId: user.userId,
  reconnectToken: user.reconnectToken
}, (res) => { /* ... */ });
```
