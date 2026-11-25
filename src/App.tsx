import { useEffect, useState } from "react";
import { Home } from "./components/Home";
import { Room } from "./components/Room";
import { Settings } from "./components/Settings";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { chat } from "./services/chat";
import type { Preferences } from "./services/preferences";
import { preferences } from "./services/preferences";
import { roomService } from "./services/room";
import { voice } from "./services/webrtc";

type Screen = "home" | "room";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const detachVoice = voice.attach();
    const detachChat = chat.attach();
    return () => {
      detachVoice();
      detachChat();
    };
  }, []);

  useEffect(() => {
    const apply = (value: Preferences): void => voice.applyPreferences(value);
    apply(preferences.getSnapshot());
    return preferences.subscribe(apply);
  }, []);

  const enterRoom = async (action: () => Promise<void>): Promise<void> => {
    try {
      await voice.start();
      await action();
      setScreen("room");
    } catch (error) {
      voice.stop();
      try {
        await roomService.leaveRoom();
      } catch {}
      throw error;
    }
  };

  const disconnect = async (): Promise<void> => {
    voice.stop();
    await roomService.leaveRoom();
    setScreen("home");
  };

  return (
    <div className="app">
      <TitleBar />
      <main className="content">
        <div className="hero">
          <h1>Nexo</h1>
          <p>Voz 1 a 1, directa y privada.</p>
        </div>
        {screen === "home" ? (
          <Home
            onCreate={() => enterRoom(() => roomService.createRoom())}
            onJoin={(code) => enterRoom(() => roomService.joinRoom(code))}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : (
          <Room
            onDisconnect={disconnect}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
      </main>
      <StatusBar />
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
