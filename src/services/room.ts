import {
  ROOM_CODE_PATTERN,
  SignalingError,
  describeError,
  normalizeRoomCode,
  type ClientMessage,
  type IceServer,
  type ServerMessage,
} from "./protocol";
import { signaling, type ConnectionStatus } from "./websocket";

export type RoomStatus = "disconnected" | "connecting" | "in-room";

export interface RoomSnapshot {
  signaling: ConnectionStatus;
  status: RoomStatus;
  code: string | null;
  roomId: string | null;
  selfId: string | null;
  peerIds: string[];
  iceServers: IceServer[];
  error: string | null;
  busy: boolean;
}

export type RoomEvent =
  | {
      type: "joined";
      selfId: string;
      peerIds: string[];
      iceServers: IceServer[];
    }
  | { type: "peer-joined"; peerId: string }
  | { type: "peer-left"; peerId: string }
  | { type: "offer"; from: string; sdp: string }
  | { type: "answer"; from: string; sdp: string }
  | { type: "ice-candidate"; from: string; candidate: string }
  | { type: "chat"; from: string; text: string; sentAt: number }
  | { type: "reset" }
  | { type: "error"; error: SignalingError };

interface PendingJoin {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const EMPTY_ROOM: RoomSnapshot = {
  signaling: "closed",
  status: "disconnected",
  code: null,
  roomId: null,
  selfId: null,
  peerIds: [],
  iceServers: [],
  error: null,
  busy: false,
};

class RoomService {
  private readonly joinTimeoutMs = 8_000;
  private readonly listeners = new Set<() => void>();
  private readonly eventHandlers = new Set<(event: RoomEvent) => void>();
  private state: RoomSnapshot = EMPTY_ROOM;
  private pendingJoin: PendingJoin | null = null;
  private wired = false;

  getSnapshot = (): RoomSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onEvent = (handler: (event: RoomEvent) => void): (() => void) => {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  };

  getIceServers = (): IceServer[] => this.state.iceServers;

  createRoom = async (): Promise<void> => {
    await this.joinInternal();
  };

  joinRoom = async (rawCode: string): Promise<void> => {
    const code = normalizeRoomCode(rawCode);
    if (!ROOM_CODE_PATTERN.test(code)) {
      const error = new SignalingError(
        "BAD_REQUEST",
        "El código debe tener el formato ABCD-1234.",
      );
      this.setState({ error: error.message });
      throw error;
    }
    await this.joinInternal(code);
  };

  leaveRoom = async (): Promise<void> => {
    this.clearPendingJoin();
    const wasInRoom = this.state.status === "in-room";
    this.emit({ type: "reset" });
    this.setState({ ...EMPTY_ROOM, signaling: this.state.signaling });
    if (wasInRoom && signaling.getStatus() === "open") {
      try {
        signaling.send({ type: "leave" });
      } catch {}
    }
    signaling.close();
  };

  sendOffer = (sdp: string): void => this.send({ type: "offer", sdp });

  sendAnswer = (sdp: string): void => this.send({ type: "answer", sdp });

  sendIceCandidate = (candidate: string): void =>
    this.send({ type: "ice-candidate", candidate });

  sendChat = (text: string): void => this.send({ type: "chat", text });

  private async joinInternal(code?: string): Promise<void> {
    this.ensureWired();
    if (this.state.busy) {
      throw new Error("Ya hay una operación en curso. Esperá un momento.");
    }
    this.setState({ busy: true, error: null });

    try {
      await signaling.connect();
    } catch (error) {
      this.setState({
        busy: false,
        error: describeError(error, "No se pudo conectar al signaling."),
      });
      throw error;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingJoin = null;
          reject(
            new SignalingError(
              "BAD_REQUEST",
              "Timeout esperando la confirmación de la sala.",
            ),
          );
        }, this.joinTimeoutMs);
        this.pendingJoin = { resolve, reject, timer };
        const request: ClientMessage = code
          ? { type: "join", code }
          : { type: "join" };
        try {
          signaling.send(request);
        } catch (error) {
          clearTimeout(timer);
          this.pendingJoin = null;
          reject(error);
        }
      });
    } catch (error) {
      this.setState({ busy: false, error: describeError(error) });
      throw error;
    }

    this.setState({ busy: false });
  }

  private send(message: ClientMessage): void {
    if (this.state.status !== "in-room") {
      throw new SignalingError("NOT_IN_ROOM", "No estás en una sala.");
    }
    signaling.send(message);
  }

  private ensureWired(): void {
    if (this.wired) return;
    this.wired = true;
    signaling.onMessage(this.handleMessage);
    signaling.subscribeStatus(this.handleStatus);
  }

  private handleStatus = (status: ConnectionStatus): void => {
    this.setState({ signaling: status });
    if (
      this.state.status === "in-room" &&
      (status === "reconnecting" || status === "closed")
    ) {
      this.clearPendingJoin();
      this.setState({
        ...EMPTY_ROOM,
        signaling: status,
        error:
          "Se perdió la conexión con el signaling. Creá o uníte a una sala nuevamente.",
      });
      this.emit({ type: "reset" });
    }
  };

  private handleMessage = (message: ServerMessage): void => {
    switch (message.type) {
      case "joined": {
        this.resolvePendingJoin();
        this.setState({
          status: "in-room",
          code: message.code,
          roomId: message.roomId,
          selfId: message.selfId,
          peerIds: message.peerIds,
          iceServers: message.iceServers,
          error: null,
        });
        this.emit({
          type: "joined",
          selfId: message.selfId,
          peerIds: message.peerIds,
          iceServers: message.iceServers,
        });
        break;
      }
      case "peer-joined": {
        if (!this.state.peerIds.includes(message.peerId)) {
          this.setState({ peerIds: [...this.state.peerIds, message.peerId] });
        }
        this.emit({ type: "peer-joined", peerId: message.peerId });
        break;
      }
      case "peer-left": {
        this.setState({
          peerIds: this.state.peerIds.filter((id) => id !== message.peerId),
        });
        this.emit({ type: "peer-left", peerId: message.peerId });
        break;
      }
      case "offer":
        this.emit({ type: "offer", from: message.from, sdp: message.sdp });
        break;
      case "answer":
        this.emit({ type: "answer", from: message.from, sdp: message.sdp });
        break;
      case "ice-candidate":
        this.emit({
          type: "ice-candidate",
          from: message.from,
          candidate: message.candidate,
        });
        break;
      case "error": {
        const error = new SignalingError(message.code, message.message);
        if (this.pendingJoin) {
          this.rejectPendingJoin(error);
          break;
        }
        this.setState({ error: error.message });
        this.emit({ type: "error", error });
        break;
      }
      case "chat":
        this.emit({
          type: "chat",
          from: message.from,
          text: message.text,
          sentAt: message.sentAt,
        });
        break;
    }
  };

  private resolvePendingJoin(): void {
    if (!this.pendingJoin) return;
    const { resolve, timer } = this.pendingJoin;
    clearTimeout(timer);
    this.pendingJoin = null;
    resolve();
  }

  private rejectPendingJoin(error: Error): void {
    if (!this.pendingJoin) return;
    const { reject, timer } = this.pendingJoin;
    clearTimeout(timer);
    this.pendingJoin = null;
    reject(error);
  }

  private clearPendingJoin(): void {
    if (!this.pendingJoin) return;
    clearTimeout(this.pendingJoin.timer);
    this.pendingJoin = null;
  }

  private setState(patch: Partial<RoomSnapshot>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private emit(event: RoomEvent): void {
    for (const handler of [...this.eventHandlers]) handler(event);
  }
}

export const roomService = new RoomService();
