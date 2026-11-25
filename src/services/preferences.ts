export interface Preferences {
  micEnabled: boolean;
  remoteAudioEnabled: boolean;
  pttEnabled: boolean;
  pttKey: string;
  hideFromCapture: boolean;
  signalingUrl: string;
}

const STORAGE_KEY = "nexo.preferences.v1";

export const DEFAULT_SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL ?? "ws://127.0.0.1:8787";

export function normalizeSignalingUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return null;
    return value;
  } catch {
    return null;
  }
}

export const DEFAULT_PREFERENCES: Preferences = {
  micEnabled: true,
  remoteAudioEnabled: true,
  pttEnabled: false,
  pttKey: "Space",
  hideFromCapture: false,
  signalingUrl: DEFAULT_SIGNALING_URL,
};

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_PREFERENCES };
    }
    const value = parsed as Record<string, unknown>;
    return {
      micEnabled:
        typeof value.micEnabled === "boolean"
          ? value.micEnabled
          : DEFAULT_PREFERENCES.micEnabled,
      remoteAudioEnabled:
        typeof value.remoteAudioEnabled === "boolean"
          ? value.remoteAudioEnabled
          : DEFAULT_PREFERENCES.remoteAudioEnabled,
      pttEnabled:
        typeof value.pttEnabled === "boolean"
          ? value.pttEnabled
          : DEFAULT_PREFERENCES.pttEnabled,
      pttKey:
        typeof value.pttKey === "string" && value.pttKey
          ? value.pttKey
          : DEFAULT_PREFERENCES.pttKey,
      hideFromCapture:
        typeof value.hideFromCapture === "boolean"
          ? value.hideFromCapture
          : DEFAULT_PREFERENCES.hideFromCapture,
      signalingUrl:
        typeof value.signalingUrl === "string"
          ? (normalizeSignalingUrl(value.signalingUrl) ?? DEFAULT_SIGNALING_URL)
          : DEFAULT_SIGNALING_URL,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

class PreferencesService {
  private readonly listeners = new Set<(value: Preferences) => void>();
  private current: Preferences = loadPreferences();

  getSnapshot = (): Preferences => this.current;

  subscribe = (listener: (value: Preferences) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update = (patch: Partial<Preferences>): void => {
    this.current = { ...this.current, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch {}
    for (const listener of [...this.listeners]) listener(this.current);
  };
}

export function keyLabel(code: string): string {
  if (code === "Space") return "Espacio";
  if (code === "Enter") return "Enter";
  if (code === "Tab") return "Tab";
  if (code === "Backquote") return "`";
  if (code === "Minus") return "-";
  if (code === "Equal") return "=";
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (code === "Semicolon") return ";";
  if (code === "Quote") return "'";
  if (code === "Comma") return ",";
  if (code === "Period") return ".";
  if (code === "Slash") return "/";
  if (code === "Backslash") return "\\";
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
  if (code === "AltLeft" || code === "AltRight") return "Alt";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

export const preferences = new PreferencesService();
