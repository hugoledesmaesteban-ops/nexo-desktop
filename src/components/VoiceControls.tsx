import { useEffect, useSyncExternalStore } from "react";
import {
  keyLabel,
  preferences,
  type Preferences,
} from "../services/preferences";
import { voice } from "../services/webrtc";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function VoiceControls() {
  const prefs: Preferences = useSyncExternalStore(
    preferences.subscribe,
    preferences.getSnapshot,
  );
  const call = useSyncExternalStore(voice.subscribe, voice.getSnapshot);

  useEffect(() => {
    if (!prefs.pttEnabled) {
      voice.setPttHeld(false);
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== prefs.pttKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      voice.setPttHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== prefs.pttKey) return;
      voice.setPttHeld(false);
    };
    const onBlur = (): void => voice.setPttHeld(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      voice.setPttHeld(false);
    };
  }, [prefs.pttEnabled, prefs.pttKey]);

  return (
    <div className="controls">
      <button
        type="button"
        className={`control ${prefs.micEnabled ? "control--active" : ""}`}
        onClick={() => preferences.update({ micEnabled: !prefs.micEnabled })}
      >
        <span className="control__label">🎙 Micrófono</span>
        <span className="control__state">
          {prefs.micEnabled ? "ON" : "OFF"}
        </span>
      </button>

      <button
        type="button"
        className={`control ${prefs.remoteAudioEnabled ? "control--active" : ""}`}
        onClick={() =>
          preferences.update({
            remoteAudioEnabled: !prefs.remoteAudioEnabled,
          })
        }
      >
        <span className="control__label">🔊 Audio remoto</span>
        <span className="control__state">
          {prefs.remoteAudioEnabled ? "ON" : "OFF"}
        </span>
      </button>

      <button
        type="button"
        className={`control ${prefs.pttEnabled ? "control--active" : ""}`}
        onClick={() => preferences.update({ pttEnabled: !prefs.pttEnabled })}
      >
        <span className="control__label">
          🎤 Push-to-talk <span className="keycap">{keyLabel(prefs.pttKey)}</span>
        </span>
        <span className="control__state">
          {prefs.pttEnabled ? (call.pttHeld ? "HABLANDO" : "LISTO") : "OFF"}
        </span>
      </button>

      {prefs.pttEnabled && !call.pttHeld && prefs.micEnabled && (
        <p className="text-hint">
          Mantené {keyLabel(prefs.pttKey)} para transmitir.
        </p>
      )}
    </div>
  );
}
