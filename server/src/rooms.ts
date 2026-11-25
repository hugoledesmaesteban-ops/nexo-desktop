import { randomInt, randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { errorEvent, type ErrorEvent, type ServerMessage } from "./protocol.js";
import { normalizeRoomCode, ROOM_CODE_PATTERN } from "./validate.js";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_PEERS_PER_ROOM = 2;
const CODE_ATTEMPTS = 20;

interface Peer {
  id: string;
  roomId: string;
  roomCode: string;
  socket: WebSocket;
}

interface Room {
  id: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  peers: Map<string, Peer>;
}

export interface RoomView {
  code: string;
  roomId: string;
  selfId: string;
  peerIds: string[];
}

export type JoinResult =
  | { ok: true; room: RoomView }
  | { ok: false; error: ErrorEvent };

export interface LeaveResult {
  code: string;
  selfId: string;
  remainingPeerIds: string[];
}

function generateCode(): string {
  let prefix = "";
  for (let i = 0; i < 4; i += 1) {
    prefix += LETTERS[randomInt(LETTERS.length)];
  }
  const suffix = String(randomInt(0, 10_000)).padStart(4, "0");
  return `${prefix}-${suffix}`;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly peerBySocket = new WeakMap<WebSocket, Peer>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly ttlMs: number,
    private readonly log: (message: string) => void,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.min(ttlMs, 60_000));
    this.cleanupTimer.unref();
  }

  stop(): void {
    clearInterval(this.cleanupTimer);
  }

  create(socket: WebSocket): JoinResult {
    this.leave(socket);

    let code = "";
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const candidate = generateCode();
      if (!this.rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      return {
        ok: false,
        error: errorEvent("BAD_REQUEST", "No se pudo generar un codigo de sala unico."),
      };
    }

    const now = Date.now();
    const room: Room = {
      id: randomUUID(),
      code,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      peers: new Map(),
    };
    this.rooms.set(code, room);

    const peer = this.addPeer(room, socket);
    this.log(`Sala ${code} creada (${room.id})`);
    return {
      ok: true,
      room: {
        code,
        roomId: room.id,
        selfId: peer.id,
        peerIds: [],
      },
    };
  }

  join(rawCode: string, socket: WebSocket): JoinResult {
    this.leave(socket);
    const code = normalizeRoomCode(rawCode);
    if (!ROOM_CODE_PATTERN.test(code)) {
      return {
        ok: false,
        error: errorEvent("BAD_REQUEST", "El codigo de sala debe tener el formato ABCD-1234."),
      };
    }

    const room = this.rooms.get(code);
    if (!room || room.expiresAt <= Date.now()) {
      if (room) this.dropRoom(room);
      return {
        ok: false,
        error: errorEvent("ROOM_NOT_FOUND", `No existe la sala ${code} o expiro.`),
      };
    }

    if (room.peers.size >= MAX_PEERS_PER_ROOM) {
      return {
        ok: false,
        error: errorEvent("ROOM_FULL", `La sala ${code} ya tiene ${MAX_PEERS_PER_ROOM} participantes.`),
      };
    }

    const peerIds = [...room.peers.keys()];
    const peer = this.addPeer(room, socket);
    room.expiresAt = Date.now() + this.ttlMs;
    this.log(`Peer ${peer.id} se uno a ${code}`);
    return {
      ok: true,
      room: {
        code,
        roomId: room.id,
        selfId: peer.id,
        peerIds,
      },
    };
  }

  leave(socket: WebSocket): LeaveResult | undefined {
    const peer = this.peerBySocket.get(socket);
    if (!peer) return undefined;

    const room = this.rooms.get(peer.roomCode);
    this.peerBySocket.delete(socket);
    if (!room) return undefined;

    room.peers.delete(peer.id);
    const remaining = [...room.peers.values()];
    for (const other of remaining) {
      this.send(other.socket, { type: "peer-left", peerId: peer.id });
    }
    if (room.peers.size === 0) {
      this.rooms.delete(room.code);
      this.log(`Sala ${room.code} eliminada (vacia)`);
    }
    this.log(`Peer ${peer.id} salio de ${room.code}`);
    return {
      code: room.code,
      selfId: peer.id,
      remainingPeerIds: remaining.map((item) => item.id),
    };
  }

  getPeer(socket: WebSocket): Peer | undefined {
    return this.peerBySocket.get(socket);
  }

  getOtherPeers(socket: WebSocket): Peer[] {
    const peer = this.peerBySocket.get(socket);
    if (!peer) return [];
    const room = this.rooms.get(peer.roomCode);
    if (!room) return [];
    return [...room.peers.values()].filter((item) => item.id !== peer.id);
  }

  send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  sendError(socket: WebSocket, error: ErrorEvent): void {
    this.send(socket, error);
  }

  private addPeer(room: Room, socket: WebSocket): Peer {
    const peer: Peer = { id: randomUUID(), roomId: room.id, roomCode: room.code, socket };
    room.peers.set(peer.id, peer);
    this.peerBySocket.set(socket, peer);
    return peer;
  }

  private dropRoom(room: Room): void {
    for (const peer of room.peers.values()) {
      this.peerBySocket.delete(peer.socket);
      this.sendError(
        peer.socket,
        errorEvent("ROOM_NOT_FOUND", `La sala ${room.code} expiro.`),
      );
      peer.socket.close(1000, "Room expired");
    }
    room.peers.clear();
    this.rooms.delete(room.code);
    this.log(`Sala ${room.code} eliminada (expiro)`);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.peers.size === 0 || room.expiresAt <= now) {
        this.dropRoom(room);
      }
    }
  }
}
