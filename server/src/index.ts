import "dotenv/config";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, IceServer, ServerMessage } from "./protocol.js";
import { errorEvent } from "./protocol.js";
import { RoomManager } from "./rooms.js";
import { LIMITS, parseClientMessage } from "./validate.js";

function log(message: string): void {
  console.log(`[signaling ${new Date().toISOString()}] ${message}`);
}

function readPort(): number {
  const raw = process.env.PORT ?? "8787";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT inválido: ${raw}`);
  }
  return port;
}

function readTtl(): number {
  const raw = process.env.ROOM_TTL_MS ?? "3600000";
  const ttl = Number(raw);
  if (!Number.isInteger(ttl) || ttl < 10_000) {
    throw new Error(`ROOM_TTL_MS inválido (mínimo 10000): ${raw}`);
  }
  return ttl;
}

function readAllowedOrigins(): string[] | undefined {
  const raw = process.env.ALLOWED_ORIGIN ?? "*";
  if (raw.trim() === "*") return undefined;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const port = readPort();
const ttlMs = readTtl();
const allowedOrigins = readAllowedOrigins();
const iceServers: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const rooms = new RoomManager(ttlMs, log);

const wss = new WebSocketServer({
  port,
  host: "0.0.0.0",
  maxPayload: LIMITS.messageBytes,
  verifyClient: (info, done) => {
    const origin = info.origin;
    if (!origin || !allowedOrigins || allowedOrigins.includes(origin)) {
      done(true);
      return;
    }
    log(`Origen rechazado: ${origin}`);
    done(false, 403, "Forbidden origin");
  },
});

function send(socket: WebSocket, message: ServerMessage): void {
  rooms.send(socket, message);
}

wss.on("listening", () => {
  log(`Servidor de signaling escuchando en ws://localhost:${port}`);
  log(`ALLOWED_ORIGIN=${allowedOrigins?.join(",") ?? "*"} ROOM_TTL_MS=${ttlMs}`);
});

wss.on("connection", (socket, request) => {
  const remote = request.socket.remoteAddress ?? "desconocido";
  log(`Cliente conectado: ${remote}`);

  socket.on("message", (raw, isBinary) => {
    if (isBinary) {
      rooms.sendError(socket, errorEvent("BAD_REQUEST", "Se esperaba un mensaje de texto JSON."));
      return;
    }

    const parsed = parseClientMessage(raw.toString("utf8"));
    if (!parsed.ok) {
      rooms.sendError(socket, parsed.error);
      return;
    }

    const message: ClientMessage = parsed.message;
    switch (message.type) {
      case "join": {
        const result = message.code ? rooms.join(message.code, socket) : rooms.create(socket);
        if (!result.ok) {
          rooms.sendError(socket, result.error);
          return;
        }
        send(socket, {
          type: "joined",
          code: result.room.code,
          roomId: result.room.roomId,
          selfId: result.room.selfId,
          peerIds: result.room.peerIds,
          iceServers,
        });
        for (const peerId of result.room.peerIds) {
          send(socket, { type: "peer-joined", peerId });
        }
        for (const peer of rooms.getOtherPeers(socket)) {
          rooms.send(peer.socket, { type: "peer-joined", peerId: result.room.selfId });
        }
        return;
      }
      case "leave": {
        rooms.leave(socket);
        socket.close(1000, "Left room");
        return;
      }
      case "offer":
      case "answer":
      case "ice-candidate":
      case "chat": {
        const peer = rooms.getPeer(socket);
        if (!peer) {
          rooms.sendError(socket, errorEvent("NOT_IN_ROOM", "Debes unirte a una sala primero."));
          return;
        }
        const others = rooms.getOtherPeers(socket);
        if (others.length === 0) {
          rooms.sendError(socket, errorEvent("PEER_NOT_FOUND", "No hay otro participante en la sala."));
          return;
        }
        const target = others[0]!;
        switch (message.type) {
          case "offer":
            rooms.send(target.socket, { type: "offer", from: peer.id, sdp: message.sdp });
            break;
          case "answer":
            rooms.send(target.socket, { type: "answer", from: peer.id, sdp: message.sdp });
            break;
          case "ice-candidate":
            rooms.send(target.socket, {
              type: "ice-candidate",
              from: peer.id,
              candidate: message.candidate,
            });
            break;
          case "chat":
            rooms.send(target.socket, {
              type: "chat",
              from: peer.id,
              text: message.text,
              sentAt: Date.now(),
            });
            break;
        }
        return;
      }
    }
  });

  socket.on("close", () => {
    rooms.leave(socket);
    log("Cliente desconectado");
  });

  socket.on("error", (error) => {
    log(`Error de socket: ${error.message}`);
  });
});

wss.on("error", (error) => {
  log(`Error del servidor: ${error.message}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Senal ${signal} recibida, cerrando...`);
  rooms.stop();
  for (const client of wss.clients) {
    client.close(1001, "Server shutting down");
  }
  wss.close(() => {
    log("Servidor detenido");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
