export const MESSAGE_TYPES = [
  "join",
  "joined",
  "peer-joined",
  "peer-left",
  "offer",
  "answer",
  "ice-candidate",
  "chat",
  "error",
  "leave",
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface JoinRequest {
  type: "join";
  code?: string;
}

export interface LeaveRequest {
  type: "leave";
}

export interface OfferRequest {
  type: "offer";
  sdp: string;
}

export interface AnswerRequest {
  type: "answer";
  sdp: string;
}

export interface IceCandidateRequest {
  type: "ice-candidate";
  candidate: string;
}

export interface ChatRequest {
  type: "chat";
  text: string;
}

export type ClientMessage =
  | JoinRequest
  | LeaveRequest
  | OfferRequest
  | AnswerRequest
  | IceCandidateRequest
  | ChatRequest;

export interface JoinedEvent {
  type: "joined";
  code: string;
  roomId: string;
  selfId: string;
  peerIds: string[];
  iceServers: IceServer[];
}

export interface PeerJoinedEvent {
  type: "peer-joined";
  peerId: string;
}

export interface PeerLeftEvent {
  type: "peer-left";
  peerId: string;
}

export interface OfferEvent {
  type: "offer";
  from: string;
  sdp: string;
}

export interface AnswerEvent {
  type: "answer";
  from: string;
  sdp: string;
}

export interface IceCandidateEvent {
  type: "ice-candidate";
  from: string;
  candidate: string;
}

export interface ChatEvent {
  type: "chat";
  from: string;
  text: string;
  sentAt: number;
}

export type ErrorCode =
  | "BAD_REQUEST"
  | "INVALID_MESSAGE"
  | "MESSAGE_TOO_LARGE"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NOT_IN_ROOM"
  | "PEER_NOT_FOUND";

export interface ErrorEvent {
  type: "error";
  code: ErrorCode;
  message: string;
}

export type ServerMessage =
  | JoinedEvent
  | PeerJoinedEvent
  | PeerLeftEvent
  | OfferEvent
  | AnswerEvent
  | IceCandidateEvent
  | ChatEvent
  | ErrorEvent;

export const ROOM_CODE_PATTERN = /^[A-Z]{4}-\d{4}$/;

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

export class SignalingError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "SignalingError";
    this.code = code;
  }
}

export function describeError(
  error: unknown,
  fallback = "Ocurrió un error inesperado.",
): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export function mediaErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Permiso de micrófono denegado. Habilitalo en Windows y aceptá el aviso de WebView2 o del navegador.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No se encontró ningún micrófono. Revisá el dispositivo de entrada predeterminado de Windows.";
    case "NotReadableError":
    case "TrackStartError":
      return "El micrófono está ocupado o no se puede abrir. Cerrá otras apps que lo estén usando.";
    case "OverconstrainedError":
      return "El micrófono no acepta las restricciones de audio solicitadas.";
    default:
      return describeError(error, "No se pudo abrir el micrófono.");
  }
}
