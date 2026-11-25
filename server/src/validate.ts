import { errorEvent, MESSAGE_TYPES, type ClientMessage, type ErrorEvent } from "./protocol.js";

export const LIMITS = {
  messageBytes: 16 * 1024,
  sdpChars: 10_000,
  candidateChars: 2_000,
  chatChars: 2_000,
} as const;

export const ROOM_CODE_PATTERN = /^[A-Z]{4}-\d{4}$/;

type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: ErrorEvent };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(detail: string): ParseResult {
  return { ok: false, error: errorEvent("INVALID_MESSAGE", detail) };
}

function readString(
  source: Record<string, unknown>,
  key: string,
  maxChars: number,
): string | ParseResult {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    return invalid(`El campo "${key}" debe ser un texto no vacío.`);
  }
  if (value.length > maxChars) {
    return invalid(`El campo "${key}" supera los ${maxChars} caracteres.`);
  }
  if (!value.trim()) {
    return invalid(`El campo "${key}" no puede ser solo espacios.`);
  }
  return value;
}

export function parseClientMessage(raw: string): ParseResult {
  if (Buffer.byteLength(raw, "utf8") > LIMITS.messageBytes) {
    return {
      ok: false,
      error: errorEvent(
        "MESSAGE_TOO_LARGE",
        `Mensaje demasiado grande (máximo ${LIMITS.messageBytes} bytes).`,
      ),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid("El mensaje no es JSON válido.");
  }

  if (!isRecord(parsed)) {
    return invalid("El mensaje debe ser un objeto JSON.");
  }

  const type = parsed.type;
  if (typeof type !== "string" || !(MESSAGE_TYPES as readonly string[]).includes(type)) {
    return invalid(`Tipo de mensaje desconocido: ${String(type)}`);
  }

  switch (type) {
    case "join": {
      if (parsed.code === undefined) {
        return { ok: true, message: { type: "join" } };
      }
      if (typeof parsed.code !== "string") {
        return invalid('El campo "code" debe ser un texto.');
      }
      const code = parsed.code.trim().toUpperCase();
      if (!ROOM_CODE_PATTERN.test(code)) {
        return invalid('El campo "code" debe tener el formato ABCD-1234.');
      }
      return { ok: true, message: { type: "join", code } };
    }
    case "leave":
      return { ok: true, message: { type: "leave" } };
    case "offer":
    case "answer": {
      const sdp = readString(parsed, "sdp", LIMITS.sdpChars);
      if (typeof sdp !== "string") return sdp;
      return { ok: true, message: { type, sdp } };
    }
    case "ice-candidate": {
      const candidate = readString(parsed, "candidate", LIMITS.candidateChars);
      if (typeof candidate !== "string") return candidate;
      return { ok: true, message: { type: "ice-candidate", candidate } };
    }
    case "chat": {
      const text = readString(parsed, "text", LIMITS.chatChars);
      if (typeof text !== "string") return text;
      return { ok: true, message: { type: "chat", text } };
    }
    default:
      return invalid(`Tipo de mensaje no soportado: ${type}`);
  }
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}
