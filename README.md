# SurveyJS Creator Collaborative Editing Demo (Node.js)

This repository contains a minimal full-stack demo that shows how to implement near real-time collaboration with SurveyJS Creator using:

- Incremental saves via `saveSurveyFunc(saveNo, callback)`
- Server-side ordering protection with `saveNo`
- Server-Sent Events (SSE) broadcast so connected clients see updates quickly
- Polling fallback if live stream is interrupted

SurveyJS Creator does not include Google-Docs-style cursor collaboration out of the box, but this pattern enables practical multi-user synchronization of survey JSON.

## Stack

- **Server:** Node.js, Express, SSE
- **Client:** Plain HTML + SurveyJS Creator (CDN scripts)
- **Storage in demo:** In-memory room state (for simplicity)

## Project Structure

- `server.js`  
  Express API + SSE stream endpoint + in-memory room/version state.

- `public/index.html`  
  SurveyJS Creator UI and client sync logic:
  - Loads initial survey JSON from server
  - Sends incremental saves with `saveNo`
  - Applies remote updates received over SSE
  - Falls back to polling when stream disconnects

- `package.json`  
  App metadata and start script.

## How It Works

### 1) Incremental save from Survey Creator

The client uses the callback-style hook:

`creator.saveSurveyFunc = (saveNo, callback) => { ... }`

`saveSurveyFunc` is callback-based. The save operation can still be asynchronous (for example `fetch(...).then(...).catch(...)`), and `callback(saveNo, true|false)` is called when the operation completes.

On each change:
- Survey Creator provides a monotonically increasing `saveNo`
- Client posts `{ clientId, saveNo, surveyJson }` to `POST /api/survey/:roomId/save`
- Server returns whether the change was stored
- Client calls `callback(saveNo, true|false)` to acknowledge result

### 2) Out-of-order update protection

For each client, server tracks `lastSaveNo`.

Rule:
- Accept only `saveNo > lastSaveNo`
- Ignore duplicate/late updates (`saveNo <= lastSaveNo`)

This prevents stale updates from overwriting newer state when requests arrive out of order.

### 3) Near real-time sync (SSE + polling fallback)

When server accepts an update:
- It stores the latest survey JSON
- Increments room `version`
- Broadcasts update over SSE to other clients in the same room

Each receiving client applies the incoming JSON to Survey Creator.

If SSE is interrupted, the client starts polling:

- `GET /api/survey/:roomId?sinceVersion=<lastKnownVersion>`
- If no changes are available, server responds with `hasUpdate: false`
- If changed, server returns latest schema and version

## Run Locally

```bash
npm install
npm start
```

App runs at:

- `http://localhost:3000`

Optional env var for cross-origin local testing:

- `CORS_ORIGIN=http://localhost:3000,http://localhost:5173`

## Test Collaboration

Open two browser windows/tabs:

1. `http://localhost:3000/?room=demo-room&client=alice`
2. `http://localhost:3000/?room=demo-room&client=bob`

Then:
- Edit survey structure/properties in one client
- Changes auto-save and broadcast
- Second client receives and applies updates quickly

## Notes and Limitations

- This demo is intentionally simple and uses in-memory storage.
- Restarting server resets all room data.
- No cursor-level collaboration/selection tracking is implemented.
- For production, add persistent storage, authentication, authorization, and conflict strategy (e.g., base version checks or merge rules).
- This demo keeps state in memory; serverless cold starts or scale-out instances can reset or isolate state.

## Deploy

### Option A: Vercel frontend + separate Node backend (recommended)

- **Frontend** on Vercel
- **Backend** on a Node host (Render / Railway / Fly.io / VM)

### 1) Deploy backend

Deploy this repo as a Node service and set:

- Start command: `npm start`
- Port: use platform-provided `PORT` (already supported in `server.js`)
- Env var `CORS_ORIGIN` to your Vercel site URL (or comma-separated list)

Example:

- `CORS_ORIGIN=https://your-app.vercel.app`

### 2) Deploy frontend to Vercel

You can deploy the same repo, then open the app using query params to point to backend:

- `apiBase`: backend HTTP URL

Example URL:

- `https://your-app.vercel.app/?room=demo-room&client=alice&apiBase=https://your-backend.onrender.com`

Open a second client:

- `https://your-app.vercel.app/?room=demo-room&client=bob&apiBase=https://your-backend.onrender.com`

### 3) Verify

- Edit survey on client A
- Confirm save status updates
- Confirm client B receives the change in near real time

### Option B: temporary free demo with tunnel

If you cannot deploy backend hosting yet:

1. Run backend locally: `npm start`
2. Expose it with tunnel tooling (for example `cloudflared tunnel --url http://localhost:3000`)
3. Use the tunnel URL in `apiBase` when opening your Vercel frontend
