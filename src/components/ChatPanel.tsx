import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { CHAT_MAX_CHARS, chat, type ChatTransport } from "../services/chat";

const TRANSPORT_LABEL: Record<ChatTransport, string> = {
  none: "Sin chat",
  datachannel: "DataChannel",
  websocket: "WebSocket",
};

function formatTime(sentAt: number): string {
  return new Date(sentAt).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatPanel() {
  const snapshot = useSyncExternalStore(chat.subscribe, chat.getSnapshot);
  const [draft, setDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [snapshot.messages]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!snapshot.canSend || !draft.trim()) return;
    chat.send(draft);
    setDraft("");
  };

  const ready = snapshot.transport !== "none";

  return (
    <section className="card card--grow chat-panel">
      <div className="card__head">
        <h2>Chat privado</h2>
        <span className={`status-pill ${ready ? "status-pill--ok" : ""}`}>
          {TRANSPORT_LABEL[snapshot.transport]}
        </span>
      </div>

      <div
        className="chat-messages"
        ref={messagesRef}
        role="log"
        aria-label="Mensajes del chat"
        aria-live="polite"
      >
        {snapshot.messages.length === 0 ? (
          <div className="chat-empty">
            <p className="text-muted">Los mensajes aparecerán acá.</p>
            <p className="text-hint">Nada se guarda en disco ni en este equipo.</p>
          </div>
        ) : (
          snapshot.messages.map((message) => (
            <article
              key={message.id}
              className={`chat-message ${
                message.own ? "chat-message--own" : "chat-message--peer"
              }`}
            >
              <div className="chat-message__meta">
                <span>{message.own ? "Vos" : "Peer"}</span>
                <div className="chat-message__meta-right">
                  <time dateTime={new Date(message.sentAt).toISOString()}>
                    {formatTime(message.sentAt)}
                  </time>
                  <button
                    type="button"
                    className="chat-message__delete"
                    aria-label="Eliminar mensaje"
                    title="Eliminar mensaje"
                    onClick={() => chat.deleteMessage(message.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <p className="chat-message__text">{message.text}</p>
              <span className="chat-message__transport">
                {TRANSPORT_LABEL[message.transport]}
              </span>
            </article>
          ))
        )}
      </div>

      {snapshot.error && (
        <p className="alert alert--error">{snapshot.error}</p>
      )}

      <form className="composer" onSubmit={submit}>
        <input
          aria-label="Mensaje"
          placeholder={
            snapshot.canSend ? "Escribí un mensaje…" : "Esperando al otro participante…"
          }
          maxLength={CHAT_MAX_CHARS}
          value={draft}
          disabled={!snapshot.canSend}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="button button--small"
          disabled={!snapshot.canSend || !draft.trim()}
        >
          Enviar
        </button>
      </form>
      <p className="text-hint">
        Texto plano, máximo {CHAT_MAX_CHARS} caracteres. Solo existe mientras dure la sala.
      </p>
    </section>
  );
}
