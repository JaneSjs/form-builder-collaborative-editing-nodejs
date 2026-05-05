const path = require("path");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

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
  res.json(toClientPayload(roomId));
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
const server = app.listen(PORT, () => {
  console.log(`Demo running on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

function broadcast(roomId, payload, excludeWs = null) {
  const message = JSON.stringify({ roomId, ...payload });
  for (const client of wss.clients) {
    if (client === excludeWs || client.readyState !== 1) {
      continue;
    }
    if (client.roomId !== roomId) {
      continue;
    }
    client.send(message);
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join-room" && msg.roomId) {
      ws.roomId = msg.roomId;
      ws.clientId = msg.clientId || null;

      ws.send(
        JSON.stringify({
          type: "room-state",
          ...toClientPayload(msg.roomId)
        })
      );
    }
  });

  ws.on("close", () => {
    // noop for this demo
  });
});
