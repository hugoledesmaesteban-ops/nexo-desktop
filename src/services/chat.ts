import { describeError } from "./protocol";
import { roomService, type RoomEvent } from "./room";
import { signaling, type ConnectionStatus } from "./websocket";
import { voice, type ChatChannelEvent } from "./webrtc";

export const CHAT_MAX_CHARS = 2000;

export type ChatTransport = "none" | "datachannel" | "websocket";
export type ChatMessageTransport = Exclude<ChatTransport, "none">;

export interface ChatMessage {
  id: string;
  text: string;
  own: boolean;
  sentAt: number;
  transport: ChatMessageTransport;
}

export interface ChatSnapshot {
  messages: ChatMessage[];
  transport: ChatTransport;
  canSend: boolean;
  error: string | null;
}

interface ChatPayload {
  type: "chat";
  id: string;
  text: string;
  sentAt: number;
}

interface DeletePayload {
  type: "delete";
  id: string;
}

type ChatWirePayload = ChatPayload | DeletePayload;

const INITIAL_CHAT: ChatSnapshot = {
  messages: [],
  transport: "none",
  canSend: false,
  error: null,
};

const MAX_MESSAGES_IN_MEMORY = 100;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidText(text: unknown): text is string {
  return (
    typeof text === "string" &&
    text.trim().length > 0 &&
    text.length <= CHAT_MAX_CHARS
  );
}

function isValidSentAt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_TIMESTAMP
  );
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function parsePayload(raw: string): ChatWirePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.type === "delete") {
    if (!isValidId(parsed.id)) return null;
    return { type: "delete", id: parsed.id };
  }
  if (parsed.type !== "chat") return null;
  if (
    !isValidId(parsed.id) ||
    !isValidText(parsed.text) ||
    !isValidSentAt(parsed.sentAt)
  ) {
    return null;
  }
  return {
    type: "chat",
    id: parsed.id,
    text: parsed.text,
    sentAt: parsed.sentAt,
  };
}

class ChatService {
  private readonly listeners = new Set<() => void>();
  private state: ChatSnapshot = INITIAL_CHAT;
  private detachRoom: (() => void) | null = null;
  private detachChannel: (() => void) | null = null;
  private detachStatus: (() => void) | null = null;
  private dataChannelOpen = false;

  getSnapshot = (): ChatSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  attach = (): (() => void) => {
    if (!this.detachRoom) {
      this.detachRoom = roomService.onEvent(this.handleRoomEvent);
      this.detachChannel = voice.onChatChannel(this.handleChannelEvent);
      this.detachStatus = signaling.subscribeStatus(this.handleStatus);
      this.refresh();
    }
    return () => {
      this.detachRoom?.();
      this.detachChannel?.();
      this.detachStatus?.();
      this.detachRoom = null;
      this.detachChannel = null;
      this.detachStatus = null;
    };
  };

  send = (rawText: string): void => {
    const text = rawText.trim();
    if (!isValidText(text)) {
      this.setState({
        error: `El mensaje debe tener entre 1 y ${CHAT_MAX_CHARS} caracteres.`,
      });
      return;
    }

    const room = roomService.getSnapshot();
    if (room.status !== "in-room" || room.peerIds.length === 0) {
      this.setState({ error: "No hay otro participante en la sala." });
      return;
    }

    const id = crypto.randomUUID();
    const sentAt = Date.now();
    const payload: ChatPayload = { type: "chat", id, text, sentAt };
    const encoded = JSON.stringify(payload);

    if (this.dataChannelOpen && voice.sendChatData(encoded)) {
      this.appendMessage({ id, text, own: true, sentAt, transport: "datachannel" });
      this.setState({ error: null });
      return;
    }

    if (this.dataChannelOpen) {
      this.dataChannelOpen = false;
      this.refresh();
    }

    if (new TextEncoder().encode(encoded).length > CHAT_MAX_CHARS) {
      this.setState({ error: "El mensaje supera el límite del canal WebSocket." });
      return;
    }

    try {
      roomService.sendChat(encoded);
      this.appendMessage({ id, text, own: true, sentAt, transport: "websocket" });
      this.setState({ error: null });
    } catch (error) {
      this.setState({
        error: describeError(error, "No se pudo enviar el mensaje."),
      });
    }
  };

  deleteMessage = (id: string): void => {
    this.removeMessage(id);
    const payload: DeletePayload = { type: "delete", id };
    const encoded = JSON.stringify(payload);

    if (this.dataChannelOpen && voice.sendChatData(encoded)) {
      this.setState({ error: null });
      return;
    }

    if (this.dataChannelOpen) {
      this.dataChannelOpen = false;
      this.refresh();
    }

    try {
      roomService.sendChat(encoded);
      this.setState({ error: null });
    } catch (error) {
      this.setState({
        error: describeError(error, "No se pudo eliminar el mensaje."),
      });
    }
  };

  private handleRoomEvent = (event: RoomEvent): void => {
    switch (event.type) {
      case "joined":
        this.reset();
        break;
      case "peer-joined":
      case "peer-left":
        this.refresh();
        break;
      case "chat": {
        const payload = parsePayload(event.text);
        if (payload?.type === "delete") {
          this.removeMessage(payload.id);
          break;
        }
        if (payload?.type === "chat") {
          this.appendMessage({
            id: payload.id,
            text: payload.text,
            own: false,
            sentAt: payload.sentAt,
            transport: "websocket",
          });
          break;
        }
        this.appendMessage({
          id: crypto.randomUUID(),
          text: event.text,
          own: false,
          sentAt: event.sentAt,
          transport: "websocket",
        });
        break;
      }
      case "reset":
        this.reset();
        break;
      case "error":
        if (
          event.error.code === "PEER_NOT_FOUND" ||
          event.error.code === "NOT_IN_ROOM"
        ) {
          this.setState({ error: event.error.message });
        }
        break;
    }
  };

  private handleChannelEvent = (event: ChatChannelEvent): void => {
    if (event.type === "open") {
      this.dataChannelOpen = true;
      this.refresh();
      return;
    }
    if (event.type === "close") {
      this.dataChannelOpen = false;
      this.refresh();
      return;
    }
    if (typeof event.data !== "string") return;
    const payload = parsePayload(event.data);
    if (!payload) return;
    if (payload.type === "delete") {
      this.removeMessage(payload.id);
      return;
    }
    this.appendMessage({
      id: payload.id,
      text: payload.text,
      own: false,
      sentAt: payload.sentAt,
      transport: "datachannel",
    });
  };

  private handleStatus = (_status: ConnectionStatus): void => {
    this.refresh();
  };

  private refresh(): void {
    const room = roomService.getSnapshot();
    const signalingOpen = signaling.getStatus() === "open";
    const hasPeer = room.status === "in-room" && room.peerIds.length > 0;
    let transport: ChatTransport = "none";
    if (hasPeer && this.dataChannelOpen) {
      transport = "datachannel";
    } else if (hasPeer && signalingOpen) {
      transport = "websocket";
    }
    this.setState({
      transport,
      canSend: hasPeer && (this.dataChannelOpen || signalingOpen),
    });
  }

  private reset(): void {
    this.dataChannelOpen = false;
    this.state = { ...INITIAL_CHAT };
    this.emit();
    this.refresh();
  }

  private appendMessage(message: ChatMessage): void {
    this.setState({
      messages: [...this.state.messages, message].slice(-MAX_MESSAGES_IN_MEMORY),
    });
  }

  private removeMessage(id: string): void {
    this.setState({
      messages: this.state.messages.filter((message) => message.id !== id),
    });
  }

  private setState(patch: Partial<ChatSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export const chat = new ChatService();
