import { useEffect, useState } from "react";
import { getState, type AppStateDto } from "../lib/tauri";

export function StatusBar() {
  const [state, setState] = useState<AppStateDto | null>(null);

  useEffect(() => {
    let active = true;
    void getState()
      .then((value) => {
        if (active) setState(value);
      })
      .catch(() => {
        if (active) setState(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <footer className="statusbar">
      <span className="statusbar__item">
        <span className="statusbar__led" />
        {state?.roomId ? "En sala" : "Sin sala"}
      </span>
      <span className="statusbar__item">{state?.shortcut ?? "Ctrl+Shift+H"}</span>
      <span className="statusbar__item">v{state?.version ?? "0.1.0"}</span>
    </footer>
  );
}
