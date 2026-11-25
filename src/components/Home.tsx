import { useState, useSyncExternalStore, type FormEvent } from "react";
import { ROOM_CODE_PATTERN, normalizeRoomCode } from "../services/protocol";
import { roomService } from "../services/room";

interface HomeProps {
  onCreate: () => Promise<void>;
  onJoin: (code: string) => Promise<void>;
  onOpenSettings: () => void;
}

export function Home({ onCreate, onJoin, onOpenSettings }: HomeProps) {
  const room = useSyncExternalStore(
    roomService.subscribe,
    roomService.getSnapshot,
  );
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo completar la operación.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitJoin = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!ROOM_CODE_PATTERN.test(normalized)) {
      setError("El código debe tener el formato ABCD-1234.");
      return;
    }
    void run(() => onJoin(normalized));
  };

  const visibleError = error ?? room.error;

  return (
    <section className="card">
      <div className="card__head">
        <h2>Sala privada</h2>
        <span className="badge">1 a 1</span>
      </div>
      <p className="text-muted">
        Audio directo entre dos personas. El signaling no transporta media.
      </p>

      <button
        type="button"
        className="button button--primary"
        onClick={() => void run(onCreate)}
        disabled={busy}
      >
        Crear sala
      </button>

      <form className="join-form" onSubmit={submitJoin}>
        <label className="field">
          <span>Código de sala</span>
          <input
            className="code-input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ABCD-1234"
            maxLength={9}
            aria-label="Código de sala"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="button" disabled={busy}>
          Unirse a sala
        </button>
      </form>

      {room.signaling === "reconnecting" && (
        <p className="alert">Reconectando con el signaling…</p>
      )}
      {visibleError && <p className="alert alert--error">{visibleError}</p>}

      <div className="row">
        <button
          type="button"
          className="button button--small"
          onClick={onOpenSettings}
        >
          Configuración
        </button>
      </div>
      <p className="text-hint">
        Al crear o unirte se pedirá permiso de micrófono. Usá auriculares para
        evitar eco.
      </p>
    </section>
  );
}
