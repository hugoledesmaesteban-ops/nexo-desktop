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
  text: string;
  sentAt: number;
}

const INITIAL_CHAT: ChatSnapshot = {
  messages: [],
  transport: "none",
  canSend: false,
  error: null,
};

const MAX_MESSAGES_IN_MEMORY = 100;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
let nextMessageId = 0;

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

function parsePayload(raw: string): ChatPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.type !== "chat") return null;
  if (!isValidText(parsed.text) || !isValidSentAt(parsed.sentAt)) return null;
  return { type: "chat", text: parsed.text, sentAt: parsed.sentAt };
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

    const sentAt = Date.now();
    const payload: ChatPayload = { type: "chat", text, sentAt };

    if (this.dataChannelOpen && voice.sendChatData(JSON.stringify(payload))) {
      this.appendMessage({ text, own: true, sentAt, transport: "datachannel" });
      this.setState({ error: null });
      return;
    }

    if (this.dataChannelOpen) {
      this.dataChannelOpen = false;
      this.refresh();
    }

    try {
      roomService.sendChat(text);
      this.appendMessage({ text, own: true, sentAt, transport: "websocket" });
      this.setState({ error: null });
    } catch (error) {
      this.setState({
        error: describeError(error, "No se pudo enviar el mensaje."),
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
      case "chat":
        this.appendMessage({
          text: event.text,
          own: false,
          sentAt: event.sentAt,
          transport: "websocket",
        });
        break;
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
    this.appendMessage({
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

  private appendMessage(message: Omit<ChatMessage, "id">): void {
    const next: ChatMessage = { id: `chat-${++nextMessageId}`, ...message };
    this.setState({
      messages: [...this.state.messages, next].slice(-MAX_MESSAGES_IN_MEMORY),
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
