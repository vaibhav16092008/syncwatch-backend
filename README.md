# SyncWatch Backend

SyncWatch is a private real-time watch-party web application enabling users to create/join rooms and synchronize media playback (YouTube videos and P2P local video streaming).

## Current Phase

```text
Phase B1 — Backend Foundation
```

## Tech Stack

* Node.js
* Express
* Socket.io
* Zod
* ES Modules

## Core Architecture & Design Decisions

> **Storage Architecture**: SyncWatch currently uses in-memory storage (`RoomStorage`) behind an abstraction layer and intentionally does not use a database or external cache like Redis for Phase B1.

> **Media & WebRTC Architecture**: Local video files are designed to be streamed directly between browsers using `captureStream()` and WebRTC. The backend only provides Socket.io signaling and will never receive, process, store, or stream actual video bytes.

### System Architecture Flow

```text
HTTP Request
  ↓
Express App (CORS, JSON, Rate Limiting)
  ↓
Services Layer (Future B2+)
  ↓
Storage Abstraction (RoomStorage)
  ↓
In-Memory Storage (Map)
```

```text
Socket.io Connection
  ↓
Event Router / Handlers
  ↓
Future Real-Time Modules (B2+ Rooms, Media, Chat, WebRTC)
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

## Health Check Endpoint

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
