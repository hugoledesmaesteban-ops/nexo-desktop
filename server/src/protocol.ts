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

export function errorEvent(code: ErrorCode, message: string): ErrorEvent {
  return { type: "error", code, message };
}
