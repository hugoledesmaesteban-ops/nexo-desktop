import assert from "node:assert/strict";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "../src/protocol.js";

const url = process.env.SIGNALING_URL ?? "ws://localhost:8787";

type Predicate = (message: ServerMessage) => boolean;

interface Waiter {
  predicate: Predicate;
  label: string;
  resolve: (message: ServerMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

class TestClient {
  readonly socket = new WebSocket(url);
  private readonly messages: ServerMessage[] = [];
  private readonly waiters: Waiter[] = [];

  constructor() {
    this.socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(message);
      this.flush();
    });
    this.socket.on("error", (error) => {
      for (const waiter of [...this.waiters]) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      this.waiters.length = 0;
    });
  }

  open(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.once("open", () => resolve());
      this.socket.once("error", reject);
    });
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close(1000, "Test finished");
  }

  waitFor(predicate: Predicate, label: string, timeoutMs = 4_000): Promise<ServerMessage> {
    const queued = this.messages.find(predicate);
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((item) => item.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`Timeout esperando ${label}`));
      }, timeoutMs);
      this.waiters.push({ predicate, label, resolve, reject, timer });
    });
  }

  private flush(): void {
    for (const waiter of [...this.waiters]) {
      const index = this.messages.findIndex(waiter.predicate);
      if (index < 0) continue;
      const message = this.messages[index]!;
      clearTimeout(waiter.timer);
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  }
}

function isType<T extends ServerMessage["type"]>(type: T) {
  return (message: ServerMessage): message is Extract<ServerMessage, { type: T }> =>
    message.type === type;
}

async function main(): Promise<void> {
  console.log(`Probando signaling en ${url}`);
  const a = new TestClient();
  const b = new TestClient();
  await Promise.all([a.open(), b.open()]);

  a.send({ type: "join" });
  const joinedA = await a.waitFor(isType("joined"), "joined de A");
  if (joinedA.type !== "joined") throw new Error("joined inválido");
  const code = joinedA.code;
  assert.match(code, /^[A-Z]{4}-\d{4}$/);
  assert.equal(joinedA.peerIds.length, 0);
  console.log(`  sala creada: ${code}`);

  b.send({ type: "join", code });
  const joinedB = await b.waitFor(isType("joined"), "joined de B");
  if (joinedB.type !== "joined") throw new Error("joined inválido");
  assert.equal(joinedB.code, code);
  assert.deepEqual(joinedB.peerIds, [joinedA.selfId]);

  const peerJoined = await a.waitFor(isType("peer-joined"), "peer-joined en A");
  if (peerJoined.type !== "peer-joined") throw new Error("peer-joined inválido");
  assert.equal(peerJoined.peerId, joinedB.selfId);
  console.log("  join y peer-joined OK");

  a.send({ type: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" });
  const offer = await b.waitFor(isType("offer"), "offer en B");
  if (offer.type !== "offer") throw new Error("offer inválido");
  assert.equal(offer.from, joinedA.selfId);

  b.send({ type: "answer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n" });
  const answer = await a.waitFor(isType("answer"), "answer en A");
  if (answer.type !== "answer") throw new Error("answer inválido");
  assert.equal(answer.from, joinedB.selfId);

  a.send({ type: "ice-candidate", candidate: "candidate:1 1 udp 2130706431 127.0.0.1 5000 typ host" });
  const ice = await b.waitFor(isType("ice-candidate"), "ice-candidate en B");
  if (ice.type !== "ice-candidate") throw new Error("ice inválido");
  assert.equal(ice.from, joinedA.selfId);
  console.log("  offer / answer / ice-candidate OK");

  b.send({ type: "chat", text: "hola desde B" });
  const chat = await a.waitFor(isType("chat"), "chat en A");
  if (chat.type !== "chat") throw new Error("chat inválido");
  assert.equal(chat.text, "hola desde B");
  assert.equal(chat.from, joinedB.selfId);
  console.log("  chat OK (no persistido)");

  const c = new TestClient();
  await c.open();
  c.send({ type: "join", code });
  const full = await c.waitFor(isType("error"), "error ROOM_FULL");
  if (full.type !== "error") throw new Error("error inválido");
  assert.equal(full.code, "ROOM_FULL");
  console.log("  sala llena rechazada correctamente");

  a.send({ type: "leave" });
  const left = await b.waitFor(isType("peer-left"), "peer-left en B");
  if (left.type !== "peer-left") throw new Error("peer-left inválido");
  assert.equal(left.peerId, joinedA.selfId);
  console.log("  peer-left OK");

  a.close();
  b.close();
  c.close();
  console.log("PRUEBA OK");
}

main().catch((error) => {
  console.error("PRUEBA FALLIDA:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
