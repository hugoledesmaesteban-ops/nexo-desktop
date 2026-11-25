import { DEFAULT_SIGNALING_URL, preferences } from "./preferences";
import type { ClientMessage, ServerMessage } from "./protocol";

export const SIGNALING_URL = DEFAULT_SIGNALING_URL;

export type ConnectionStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

type MessageHandler = (message: ServerMessage) => void;
type StatusHandler = (status: ConnectionStatus) => void;

const SERVER_MESSAGE_TYPES = new Set<string>([
  "joined",
  "peer-joined",
  "peer-left",
  "offer",
  "answer",
  "ice-candidate",
  "chat",
  "error",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (!SERVER_MESSAGE_TYPES.has(value.type)) return false;

  switch (value.type) {
    case "joined":
      return (
        typeof value.code === "string" &&
        typeof value.roomId === "string" &&
        typeof value.selfId === "string" &&
        Array.isArray(value.peerIds) &&
        Array.isArray(value.iceServers)
      );
    case "peer-joined":
    case "peer-left":
      return typeof value.peerId === "string";
    case "offer":
    case "answer":
      return typeof value.from === "string" && typeof value.sdp === "string";
    case "ice-candidate":
      return (
        typeof value.from === "string" && typeof value.candidate === "string"
      );
    case "chat":
      return (
        typeof value.from === "string" &&
        typeof value.text === "string" &&
        typeof value.sentAt === "number"
      );
    case "error":
      return (
        typeof value.code === "string" && typeof value.message === "string"
      );
    default:
      return false;
  }
}

export interface SignalingClientOptions {
  url?: string;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

class SignalingClient {
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = "closed";
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = true;
  private connectPromise: Promise<void> | null = null;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();

  constructor(private readonly options: SignalingClientOptions = {}) {}

  get url(): string {
    return this.options.url ?? preferences.getSnapshot().signalingUrl;
  }

  getStatus = (): ConnectionStatus => this.status;

  onMessage = (handler: MessageHandler): (() => void) => {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  };

  subscribeStatus = (handler: StatusHandler): (() => void) => {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => {
      this.statusHandlers.delete(handler);
    };
  };

  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.intentionallyClosed = false;
    const promise = this.openSocket();
    this.connectPromise = promise;
    const clear = (): void => {
      if (this.connectPromise === promise) this.connectPromise = null;
    };
    void promise.then(clear, clear);
    return promise;
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("El signaling no está conectado.");
    }
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.intentionallyClosed = true;
    this.clearReconnectTimer();
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "Client closed");
      }
    }
    this.setStatus("closed");
  }

  private openSocket(): Promise<void> {
    this.clearReconnectTimer();
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");

    return new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch (error) {
        reject(error);
        this.scheduleReconnect();
        return;
      }

      this.socket = socket;
      let settled = false;
      let opened = false;
      const fail = (error: Error): void => {
        if (!settled && !opened) {
          settled = true;
          reject(error);
        }
      };

      socket.onopen = () => {
        settled = true;
        opened = true;
        this.attempt = 0;
        this.setStatus("open");
        resolve();
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!isServerMessage(parsed)) return;
        for (const handler of [...this.messageHandlers]) handler(parsed);
      };

      socket.onerror = () => {
        fail(new Error(`No se pudo conectar al signaling (${this.url}).`));
      };

      socket.onclose = () => {
        fail(new Error("La conexión con el signaling se cerró antes de abrir."));
        if (this.socket === socket) this.socket = null;
        this.setStatus(this.intentionallyClosed ? "closed" : "reconnecting");
        if (!this.intentionallyClosed) this.scheduleReconnect();
      };
    });
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed || this.reconnectTimer) return;
    const base = this.options.reconnectBaseMs ?? 700;
    const max = this.options.reconnectMaxMs ?? 5_000;
    const delay = Math.min(base * 2 ** this.attempt, max);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionallyClosed) void this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of [...this.statusHandlers]) handler(status);
  }
}

export const signaling = new SignalingClient();
