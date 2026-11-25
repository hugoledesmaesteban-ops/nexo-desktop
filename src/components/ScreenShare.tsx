import { useEffect, useRef, useSyncExternalStore } from "react";
import { voice } from "../services/webrtc";

export function ScreenShare() {
  const call = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stream = call.remoteScreenStream;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!stream) {
      el.srcObject = null;
      return;
    }
    el.srcObject = stream;
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  const toggleShare = async (): Promise<void> => {
    try {
      if (call.screenSharing) {
        voice.stopScreenShare();
      } else {
        await voice.startScreenShare();
      }
    } catch {}
  };

  const toggleFullscreen = async (): Promise<void> => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {}
  };

  return (
    <section className="card screen-card">
      <div className="card__head">
        <div className="screen-card__title">
          <h2>Pantalla compartida</h2>
          {stream && (
            <button
              type="button"
              className="button button--small button--fullscreen"
              onClick={() => void toggleFullscreen()}
            >
              ⛶ Pantalla completa
            </button>
          )}
        </div>
        <span
          className={`status-pill ${call.screenSharing ? "status-pill--ok" : ""}`}
        >
          {call.screenSharing ? "Transmitiendo" : "Sin compartir"}
        </span>
      </div>

      <button
        type="button"
        className={`button ${call.screenSharing ? "" : "button--primary"}`}
        disabled={call.screenShareStarting}
        onClick={() => void toggleShare()}
      >
        {call.screenShareStarting
          ? "Eligiendo fuente…"
          : call.screenSharing
            ? "🖥 Dejar de compartir"
            : "🖥 Compartir pantalla"}
      </button>

      <p className="text-hint">
        El selector del navegador/Windows te permite elegir pantalla completa,
        ventana específica o monitor. Elegí la fuente antes de confirmar.
      </p>

      <div className="screen-exclusion">
        <span className="screen-exclusion__icon" aria-hidden="true">
          ✓
        </span>
        <div>
          <strong>No compartir esta aplicación</strong>
          <p>
            Si no querés transmitir Nexo, elegí otra ventana o monitor en el
            selector. Si el navegador ofrece excluir esta ventana o pestaña,
            activalo en ese diálogo.
          </p>
        </div>
      </div>

      {call.screenShareError && (
        <p className="alert alert--error">{call.screenShareError}</p>
      )}

      <div className="screen-stage">
        {stream ? (
          <video
            ref={videoRef}
            className="screen-video"
            autoPlay
            playsInline
            muted
            aria-label="Pantalla compartida por el otro usuario"
          />
        ) : (
          <div className="empty">
            <span className="empty__mark">🖥</span>
            <p>Esperando la pantalla del otro usuario…</p>
          </div>
        )}
      </div>
    </section>
  );
}
