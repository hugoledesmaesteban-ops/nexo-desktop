export function RoomCard() {
  return (
    <section className="card">
      <div className="card__head">
        <h2>Sala privada</h2>
        <span className="badge">1 a 1</span>
      </div>
      <p className="text-muted">
        Creá una sala y compartí el código con una sola persona.
      </p>
      <div className="empty">
        <div className="empty__mark">◇</div>
        <p>Todavía no hay una sala activa.</p>
      </div>
      <div className="row">
        <button type="button" className="button button--primary" disabled>
          Crear sala
        </button>
        <button type="button" className="button" disabled>
          Unirse con código
        </button>
      </div>
      <p className="text-hint">Acciones habilitadas en la etapa 2.</p>
    </section>
  );
}
