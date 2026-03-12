#!/usr/bin/env node

/**
 * Y.js WebSocket server for real-time collaborative editing.
 *
 * Each file gets its own Y.js document room: `{repoId}:{filePath}`
 * Y.js handles CRDT conflict resolution automatically.
 *
 * Start: `node server/ws-server.mjs` or `bun server/ws-server.mjs`
 */

import { WebSocketServer } from "ws";
import { setupWSConnection } from "y-websocket/bin/utils";

const PORT = parseInt(process.env.WS_PORT || "1234", 10);
const HOST = process.env.WS_HOST || "0.0.0.0";

const ALLOWED_ORIGINS = (process.env.WS_ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*");
}

const wss = new WebSocketServer({
  port: PORT,
  host: HOST,
  verifyClient: ({ origin }, cb) => {
    if (process.env.NODE_ENV === "development") {
      cb(true);
      return;
    }
    cb(isOriginAllowed(origin));
  },
});

wss.on("connection", (ws, req) => {
  const room = req.url?.slice(1) ?? "default";
  setupWSConnection(ws, req, { docName: room });
});

wss.on("listening", () => {
  console.log(`Y.js WebSocket server running on ws://${HOST}:${PORT}`);
});

wss.on("error", (err) => {
  console.error("WS Server error:", err.message);
});
