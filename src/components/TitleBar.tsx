import { hideWindow, minimizeWindow } from "../lib/tauri";

export function TitleBar() {
  return (
    <header className="titlebar">
      <div className="titlebar__brand" data-tauri-drag-region>
        <span className="titlebar__mark" />
        <span>Nexo</span>
      </div>
      <div className="titlebar__spacer" data-tauri-drag-region />
      <div className="titlebar__actions">
        <button
          type="button"
          className="titlebar__button"
          aria-label="Minimizar"
          onClick={(event) => {
            event.stopPropagation();
            void minimizeWindow();
          }}
        >
          <span className="titlebar__minimize" />
        </button>
        <button
          type="button"
          className="titlebar__button titlebar__button--close"
          aria-label="Ocultar en la bandeja"
          onClick={(event) => {
            event.stopPropagation();
            void hideWindow();
          }}
        >
          <span className="titlebar__close" />
        </button>
      </div>
    </header>
  );
}
