# SyncWatch Backend

SyncWatch is a private real-time watch-party web application enabling users to create/join rooms and synchronize media playback (YouTube videos and P2P local video streaming).

## Current Phase

```text
Phase B2 — Room Management
```

## Tech Stack

* Node.js
* Express
* Socket.io
* Zod
* ES Modules

## Core Architecture & Design Decisions

> **Storage Architecture**: SyncWatch currently uses in-memory storage (`RoomStorage`) behind an abstraction layer and intentionally does not use a database or external cache like Redis. Room state is stored in memory and cleared on server restart.

> **Media & WebRTC Architecture**: Local video files are designed to be streamed directly between browsers using `captureStream()` and WebRTC. The backend only provides Socket.io signaling and will never receive, process, store, or stream actual video bytes.

### System Architecture Flow

```text
HTTP Request (REST)
  ↓
Express App (CORS, JSON, Rate Limiting)
  ↓
Room Routes (/api/rooms)
  ↓
Room Service (Validation & Business Rules)
  ↓
Storage Abstraction (RoomStorage)
  ↓
In-Memory Storage (Map)
```

```text
Socket.io Connection
  ↓
Room Socket Handlers (room:join, room:leave, room:lock, room:unlock, room:transfer-host)
  ↓
Room Service
  ↓
Socket Room State Broadcasts
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

Example Response (`HTTP 201 Created`):

```json
{
  "success": true,
  "data": {
    "room": {
      "id": "SYNC-7K9P2",
      "roomId": "SYNC-7K9P2",
      "name": "Friday Movie Night",
      "mode": "youtube",
      "locked": false,
      "maxUsers": 10,
      "hostId": "host-uuid",
      "users": [
        {
          "id": "host-uuid",
          "userId": "host-uuid",
          "name": "Alice",
          "displayName": "Alice",
          "role": "host",
          "joinedAt": 1730000000000,
          "connected": true
        }
      ],
      "userCount": 1,
      "emptySince": null
    },
    "hostUserId": "host-uuid",
    "user": {
      "id": "host-uuid",
      "displayName": "Alice",
      "role": "host"
    }
  }
}
```

### Get Public Room Info

```text
GET /api/rooms/:roomId
```

Example Response (`HTTP 200 OK`):

```json
{
  "success": true,
  "data": {
    "room": {
      "id": "SYNC-7K9P2",
      "roomId": "SYNC-7K9P2",
      "name": "Friday Movie Night",
      "mode": "youtube",
      "locked": false,
      "maxUsers": 10,
      "userCount": 1
    }
  }
}
```

## Socket.io Events

### Client → Server

* `room:join` — Join a room using `{ roomId, displayName }`
* `room:leave` — Leave current room
* `room:lock` — Lock room (Host only)
* `room:unlock` — Unlock room (Host only)
* `room:transfer-host` — Transfer host role using `{ targetUserId }` (Host only)
* `disconnect` — Socket disconnection handling

### Server → Client

* `room:state` — Broadcasts updated public room state
* `room:user-joined` — Emitted when a new user joins
* `room:user-left` — Emitted when a user leaves or disconnects

## Key Rules & Rules Engine

1. **Room Codes**: Unique `SYNC-XXXXX` format (5 uppercase alphanumeric characters).
2. **Capacity Limit**: Maximum 10 connected users per room (including the host).
3. **Roles**: Creator is `host`. Other users are `member`. Only host can lock/unlock or transfer host.
4. **Display Names**: Must be 2–24 characters. Duplicate display names are prohibited inside the *same* room, but allowed across different rooms.
5. **Locking**: Locked rooms reject new join attempts with `ROOM_LOCKED`. Existing connected members remain.
6. **Host Departure**: When a host leaves, host role is not automatically re-assigned in B2.
