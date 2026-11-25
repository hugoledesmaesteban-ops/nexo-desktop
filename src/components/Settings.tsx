import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { toggleCaptureVisibility } from "../lib/tauri";
import { describeError } from "../services/protocol";
import {
  keyLabel,
  normalizeSignalingUrl,
  preferences,
  type Preferences,
} from "../services/preferences";

interface SettingsProps {
  onClose: () => void;
}

const MODIFIER_KEYS = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

export function Settings({ onClose }: SettingsProps) {
  const prefs: Preferences = useSyncExternalStore(
    preferences.subscribe,
    preferences.getSnapshot,
  );
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [signalingDraft, setSignalingDraft] = useState(prefs.signalingUrl);
  const [signalingError, setSignalingError] = useState<string | null>(null);
  const [signalingSaved, setSignalingSaved] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        setCapturing(false);
        return;
      }
      if (MODIFIER_KEYS.has(event.code)) return;
      preferences.update({ pttKey: event.code });
      setCapturing(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing]);

  const changeCaptureVisibility = async (): Promise<void> => {
    const hide = !prefs.hideFromCapture;
    try {
      await toggleCaptureVisibility(hide);
      preferences.update({ hideFromCapture: hide });
      setCaptureError(null);
    } catch (error) {
      setCaptureError(
        describeError(error, "No se pudo cambiar la visibilidad de captura."),
      );
    }
  };

  const saveSignalingUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const url = normalizeSignalingUrl(signalingDraft);
    if (!url) {
      setSignalingError(
        "Ingresá una URL válida: wss://tuservidor.onrender.com o ws://127.0.0.1:8787",
      );
      setSignalingSaved(false);
      return;
    }
    preferences.update({ signalingUrl: url });
    setSignalingDraft(url);
    setSignalingError(null);
    setSignalingSaved(true);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label="Configuración">
        <div className="modal__head">
          <h2>Configuración</h2>
          <button
            type="button"
            className="button button--small"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>

        <div className="controls">
          <button
            type="button"
            className={`control ${prefs.pttEnabled ? "control--active" : ""}`}
            onClick={() =>
              preferences.update({ pttEnabled: !prefs.pttEnabled })
            }
          >
            <span className="control__label">🎤 Push-to-talk</span>
            <span className="control__state">
              {prefs.pttEnabled ? "ON" : "OFF"}
            </span>
          </button>

          <button
            type="button"
            className="control"
            onClick={() => setCapturing(true)}
            disabled={capturing}
          >
            <span className="control__label">Tecla de push-to-talk</span>
            <span className="keycap">
              {capturing ? "Presioná una tecla…" : keyLabel(prefs.pttKey)}
            </span>
          </button>

          <button
            type="button"
            className={`control ${prefs.micEnabled ? "control--active" : ""}`}
            onClick={() =>
              preferences.update({ micEnabled: !prefs.micEnabled })
            }
          >
            <span className="control__label">Micrófono al entrar</span>
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
            <span className="control__label">Audio remoto al entrar</span>
            <span className="control__state">
              {prefs.remoteAudioEnabled ? "ON" : "OFF"}
            </span>
          </button>

          <button
            type="button"
            className={`control ${prefs.hideFromCapture ? "control--active" : ""}`}
            onClick={() => void changeCaptureVisibility()}
          >
            <span className="control__label">
              Ocultar Nexo al compartir pantalla (Windows)
            </span>
            <span className="control__state">
              {prefs.hideFromCapture ? "ON" : "OFF"}
            </span>
          </button>
          {captureError && <p className="text-hint">{captureError}</p>}
        </div>

        <form className="join-form" onSubmit={saveSignalingUrl}>
          <label className="field">
            <span>Servidor de signaling (URL)</span>
            <input
              className="url-input"
              value={signalingDraft}
              onChange={(event) => {
                setSignalingDraft(event.target.value);
                setSignalingSaved(false);
              }}
              placeholder="wss://nexo-signaling.onrender.com"
              aria-label="URL del servidor de signaling"
              spellCheck={false}
              autoCapitalize="none"
            />
          </label>
          <button type="submit" className="button button--small">
            Guardar URL
          </button>
          {signalingError && <p className="text-hint">{signalingError}</p>}
          {signalingSaved && (
            <p className="text-hint">
              URL guardada en este equipo. Se aplica al crear o unirte a una
              sala nuevamente.
            </p>
          )}
        </form>

        <p className="help">
          <strong>Micrófono en Windows/WebView2:</strong> activá
          Configuración → Privacidad y seguridad → Micrófono → “Permitir que
          las aplicaciones accedan al micrófono” y “Permitir que las aplicaciones
          de escritorio accedan al micrófono”. Después, al crear o unirte a una
          sala, aceptá el aviso de permiso de WebView2 (o del navegador en
          desarrollo). Si apretaste “Bloquear”, cerrá la app y borrá el
          archivo <code>Preferences</code> de EBWebView, o restablecé el permiso
          del sitio en el navegador. Elegí auriculares para evitar eco.
        </p>
        <p className="text-hint">
          Solo se guardan preferencias locales no sensibles, incluida la URL
          del signaling. No hay claves ni secretos en esta pantalla. Escape
          cancela la captura de tecla.
        </p>
      </section>
    </div>
  );
}
