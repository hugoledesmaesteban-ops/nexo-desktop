import { useSyncExternalStore } from "react";
import { roomService } from "../services/room";
import { voice, type VoiceConnection } from "../services/webrtc";
import { ChatPanel } from "./ChatPanel";
import { ScreenShare } from "./ScreenShare";
import { VoiceControls } from "./VoiceControls";

interface RoomProps {
  onDisconnect: () => Promise<void>;
  onOpenSettings: () => void;
}

function connectionLabel(connection: VoiceConnection): string {
  switch (connection) {
    case "connected":
      return "Conectado";
    case "waiting":
      return "Esperando…";
    case "connecting":
      return "Conectando…";
    case "disconnected":
      return "Reconectando…";
    case "failed":
      return "Error de conexión";
    case "idle":
      return "Sin conexión";
  }
}

export function Room({ onDisconnect, onOpenSettings }: RoomProps) {
  const room = useSyncExternalStore(
    roomService.subscribe,
    roomService.getSnapshot,
  );
  const call = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  const connected = call.connection === "connected";

  return (
    <div className="room-layout">
      <section className="card room-card">
        <div className="card__head">
          <h2>Sala activa</h2>
          <span
            className={`status-pill ${connected ? "status-pill--ok" : ""}`}
          >
            {connectionLabel(call.connection)}
          </span>
        </div>

        <div className="room-code">{room.code ?? "------"}</div>

        <div className="kv">
          <span>Tu ID</span>
          <code>{room.selfId ?? "—"}</code>
        </div>
        <div className="kv">
          <span>Peer ID</span>
          <code>{call.peerId ?? "Esperando…"}</code>
        </div>

        {call.audioBlocked && (
          <div className="alert">
            El navegador bloqueó el audio remoto.
            <button
              type="button"
              className="button button--small"
              onClick={voice.resumeAudio}
            >
              Activar audio
            </button>
          </div>
        )}
        {(call.error ?? room.error) && (
          <p className="alert alert--error">{call.error ?? room.error}</p>
        )}

        <VoiceControls />

        <div className="row room-actions">
          <button
            type="button"
            className="button button--small"
            onClick={onOpenSettings}
          >
            Configuración
          </button>
          <button type="button" className="button button--small" onClick={() => void onDisconnect()}>
            Desconectar
          </button>
        </div>
        <p className="text-hint">
          Nunca se reenvía el audio remoto al micrófono. Usá auriculares.
        </p>
      </section>

      <div className="room-main">
        <ScreenShare />
        <ChatPanel />
      </div>
    </div>
  );
}
