import { invoke } from "@tauri-apps/api/core";

export interface AppStateDto {
  version: string;
  shortcut: string;
  roomId: string | null;
}

export function getState(): Promise<AppStateDto> {
  return invoke<AppStateDto>("get_state");
}

export function hideWindow(): Promise<void> {
  return invoke<void>("hide_window");
}

export function minimizeWindow(): Promise<void> {
  return invoke<void>("minimize_window");
}

export function toggleCaptureVisibility(hide: boolean): Promise<void> {
  return invoke<void>("toggle_capture_visibility", { hide });
}
