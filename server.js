const path = require("path");
const express = require("express");
const cors = require("cors");

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (allowedOrigins.length > 0) {
  app.use(
    cors({
      origin: allowedOrigins
    })
  );
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-memory room store for demo purposes.
// For production, replace with durable storage (DB/redis/etc.).
const rooms = new Map();
const sseClientsByRoom = new Map();

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      schema: { pages: [] },
      lastSaveNoByClient: new Map(),
      version: 0
    });
  }

  return rooms.get(roomId);
}

function toClientPayload(roomId) {
  const room = ensureRoom(roomId);
  return {
    roomId,
    schema: room.schema,
    version: room.version
  };
}

app.get("/api/survey/:roomId", (req, res) => {
  const { roomId } = req.params;
  const sinceVersion = Number(req.query.sinceVersion || 0);
  const payload = toClientPayload(roomId);

  if (sinceVersion > 0 && payload.version <= sinceVersion) {
    return res.json({
      roomId,
      hasUpdate: false,
      version: payload.version
    });
  }

  return res.json({
    ...payload,
    hasUpdate: true
  });
});

app.get("/api/stream/:roomId", (req, res) => {
  const { roomId } = req.params;
  const { clientId = "" } = req.query;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const entry = { res, clientId: String(clientId) };
  if (!sseClientsByRoom.has(roomId)) {
    sseClientsByRoom.set(roomId, new Set());
  }
  sseClientsByRoom.get(roomId).add(entry);

  const room = ensureRoom(roomId);
  res.write(
    `data: ${JSON.stringify({
      type: "room-state",
      roomId,
      version: room.version
    })}\n\n`
  );

  req.on("close", () => {
    const roomClients = sseClientsByRoom.get(roomId);
    if (!roomClients) {
      return;
    }
    roomClients.delete(entry);
    if (roomClients.size === 0) {
      sseClientsByRoom.delete(roomId);
    }
  });
});

// saveSurveyFunc target endpoint:
// Apply only updates with a strictly higher saveNo per client.
app.post("/api/survey/:roomId/save", (req, res) => {
  const { roomId } = req.params;
  const { clientId, saveNo, surveyJson } = req.body || {};

  if (!clientId || typeof saveNo !== "number" || !surveyJson) {
    return res.status(400).json({
      ok: false,
      reason: "Expected body: { clientId, saveNo, surveyJson }"
    });
  }

  const room = ensureRoom(roomId);
  const lastSaveNo = room.lastSaveNoByClient.get(clientId) ?? -1;

  if (saveNo <= lastSaveNo) {
    return res.json({
      ok: false,
      ignored: true,
      reason: `Out-of-order or duplicate update: saveNo=${saveNo}, lastSaveNo=${lastSaveNo}`,
      serverVersion: room.version
    });
  }

  room.lastSaveNoByClient.set(clientId, saveNo);
  room.schema = surveyJson;
  room.version += 1;

  broadcast(roomId, {
    type: "survey-updated",
    senderClientId: clientId,
    saveNo,
    serverVersion: room.version,
    surveyJson: room.schema
  });

  return res.json({
    ok: true,
    stored: true,
    serverVersion: room.version
  });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Demo running on http://localhost:${PORT}`);
});

function broadcast(roomId, payload) {
  const roomClients = sseClientsByRoom.get(roomId);
  if (!roomClients || roomClients.size === 0) {
    return;
  }

  const message = `data: ${JSON.stringify({ roomId, ...payload })}\n\n`;
  for (const entry of roomClients) {
    if (entry.clientId && entry.clientId === payload.senderClientId) {
      continue;
    }
    entry.res.write(message);
  }
}
