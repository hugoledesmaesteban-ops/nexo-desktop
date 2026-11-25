import { DEFAULT_PREFERENCES, type Preferences } from "./preferences";
import { describeError, mediaErrorMessage, type IceServer } from "./protocol";
import { roomService, type RoomEvent } from "./room";

export type VoiceConnection =
  | "idle"
  | "waiting"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed";

export interface VoiceSnapshot {
  connection: VoiceConnection;
  peerId: string | null;
  micReady: boolean;
  micEnabled: boolean;
  remoteAudioEnabled: boolean;
  pttEnabled: boolean;
  pttKey: string;
  pttHeld: boolean;
  audioBlocked: boolean;
  screenSharing: boolean;
  screenShareStarting: boolean;
  screenShareError: string | null;
  remoteScreenStream: MediaStream | null;
  error: string | null;
}

export type ChatChannelEvent =
  | { type: "open" }
  | { type: "message"; data: string }
  | { type: "close" };

const INITIAL_VOICE: VoiceSnapshot = {
  connection: "idle",
  peerId: null,
  micReady: false,
  micEnabled: true,
  remoteAudioEnabled: true,
  pttEnabled: false,
  pttKey: "Space",
  pttHeld: false,
  audioBlocked: false,
  screenSharing: false,
  screenShareStarting: false,
  screenShareError: null,
  remoteScreenStream: null,
  error: null,
};

interface DisplayMediaDevices {
  getDisplayMedia?: (constraints: { video: boolean }) => Promise<MediaStream>;
}

function displayMediaErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Captura cancelada o permiso denegado. Elegí una fuente y confirmá en el selector del navegador.";
    case "NotSupportedError":
      return "Este navegador o WebView no soporta compartir pantalla.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No hay pantallas, ventanas o monitores disponibles para compartir.";
    case "NotReadableError":
    case "TrackStartError":
      return "No se pudo leer la fuente elegida. Probá con otra ventana o monitor.";
    default:
      return describeError(error, "No se pudo compartir la pantalla.");
  }
}

function parseIceCandidate(raw: string): RTCIceCandidateInit {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as RTCIceCandidateInit;
    }
  } catch {}
  return { candidate: raw };
}

class VoiceService {
  private readonly listeners = new Set<() => void>();
  private readonly chatChannelListeners = new Set<(event: ChatChannelEvent) => void>();
  private detachRoomHandler: (() => void) | null = null;
  private state: VoiceSnapshot = INITIAL_VOICE;
  private prefs: Preferences = { ...DEFAULT_PREFERENCES };
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private peerId: string | null = null;
  private initiator = false;
  private localTrackAdded = false;
  private makingOffer = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private chain: Promise<void> = Promise.resolve();
  private chatChannel: RTCDataChannel | null = null;
  private chatChannelCleanup: (() => void) | null = null;
  private screenStream: MediaStream | null = null;
  private screenSender: RTCRtpSender | null = null;
  private screenShareGeneration = 0;
  private polite = false;
  private needsRenegotiation = false;

  getSnapshot = (): VoiceSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onChatChannel = (listener: (event: ChatChannelEvent) => void): (() => void) => {
    this.chatChannelListeners.add(listener);
    if (this.chatChannel?.readyState === "open") listener({ type: "open" });
    return () => {
      this.chatChannelListeners.delete(listener);
    };
  };

  sendChatData = (data: string): boolean => {
    const channel = this.chatChannel;
    if (!channel || channel.readyState !== "open") return false;
    try {
      channel.send(data);
      return true;
    } catch {
      return false;
    }
  };

  attach = (): (() => void) => {
    if (!this.detachRoomHandler) {
      this.detachRoomHandler = roomService.onEvent(this.handleRoomEvent);
    }
    return () => {
      this.detachRoomHandler?.();
      this.detachRoomHandler = null;
    };
  };

  applyPreferences = (prefs: Preferences): void => {
    this.prefs = { ...prefs };
    this.setState({
      micEnabled: prefs.micEnabled,
      remoteAudioEnabled: prefs.remoteAudioEnabled,
      pttEnabled: prefs.pttEnabled,
      pttKey: prefs.pttKey,
      pttHeld: false,
    });
    this.syncTracks();
  };

  setPttHeld = (held: boolean): void => {
    if (this.state.pttHeld === held) return;
    this.setState({ pttHeld: held });
    this.syncTracks();
  };

  resumeAudio = (): void => {
    const audioEl = this.audioEl;
    if (!audioEl) return;
    void audioEl
      .play()
      .then(() => this.setState({ audioBlocked: false }))
      .catch(() => this.setState({ audioBlocked: true }));
  };

  startScreenShare = async (): Promise<void> => {
    if (this.state.screenSharing || this.state.screenShareStarting) return;
    const mediaDevices = navigator.mediaDevices as
      | (MediaDevices & DisplayMediaDevices)
      | undefined;
    if (!mediaDevices?.getDisplayMedia) {
      const message =
        "getDisplayMedia no está disponible. Usá localhost, un navegador compatible o la app Tauri.";
      this.setState({ screenShareError: message });
      throw new Error(message);
    }

    const generation = ++this.screenShareGeneration;
    this.setState({ screenShareStarting: true, screenShareError: null });

    let stream: MediaStream;
    try {
      stream = await mediaDevices.getDisplayMedia({ video: true });
    } catch (error) {
      if (generation === this.screenShareGeneration) {
        this.setState({
          screenShareStarting: false,
          screenShareError: displayMediaErrorMessage(error),
        });
      }
      throw new Error(displayMediaErrorMessage(error));
    }

    if (generation !== this.screenShareGeneration) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      for (const item of stream.getTracks()) item.stop();
      const message = "La fuente elegida no devolvió ninguna pista de video.";
      this.setState({ screenShareStarting: false, screenShareError: message });
      throw new Error(message);
    }

    track.onended = () => {
      if (generation === this.screenShareGeneration) this.stopScreenShare();
    };
    this.screenStream = stream;
    this.setState({
      screenSharing: true,
      screenShareStarting: false,
      screenShareError: null,
    });
    this.addScreenTrack();
    this.requestRenegotiation();
  };

  stopScreenShare = (): void => {
    this.disposeScreenShare(true);
  };

  start = async (): Promise<void> => {
    if (this.localStream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      const message =
        "getUserMedia no está disponible. Usá localhost o la app Tauri.";
      this.setState({ error: message });
      throw new Error(message);
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (error) {
      const message = mediaErrorMessage(error);
      this.setState({ error: message });
      throw new Error(message);
    }

    console.log("Pistas de micrófono locales:", stream.getAudioTracks());

    const track = stream.getAudioTracks()[0];
    if (!track) {
      for (const item of stream.getTracks()) item.stop();
      const message = "El micrófono no devolvió ninguna pista de audio.";
      this.setState({ error: message });
      throw new Error(message);
    }

    track.enabled = this.computeMicEnabled();
    track.onended = () =>
      this.setState({ micReady: false, error: "El micrófono dejó de estar disponible." });
    this.localStream = stream;
    this.setState({ micReady: true, error: null });

    const peers = roomService.getSnapshot().peerIds;
    if (peers.length > 0 && !this.pc) this.beginSession(peers[0]!, false);
    this.addLocalTrack();
  };

  stop = (): void => {
    this.disposeScreenShare(false);
    this.closePeerConnection();
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }
    this.chain = Promise.resolve();
    this.setState({
      ...INITIAL_VOICE,
      micEnabled: this.prefs.micEnabled,
      remoteAudioEnabled: this.prefs.remoteAudioEnabled,
      pttEnabled: this.prefs.pttEnabled,
      pttKey: this.prefs.pttKey,
    });
  };

  private handleRoomEvent = (event: RoomEvent): void => {
    switch (event.type) {
      case "joined":
        if (event.peerIds.length > 0) {
          this.beginSession(event.peerIds[0]!, false);
        } else {
          this.setState({ connection: "waiting", peerId: null, error: null });
        }
        break;
      case "peer-joined":
        this.beginSession(event.peerId, true);
        break;
      case "offer":
        if (!this.pc) this.beginSession(event.from, false);
        this.enqueue(async () => {
          await this.handleOffer(event.from, event.sdp);
        });
        break;
      case "answer":
        this.enqueue(async () => {
          await this.handleAnswer(event.from, event.sdp);
        });
        break;
      case "ice-candidate":
        this.enqueue(async () => {
          await this.handleIce(event.from, event.candidate);
        });
        break;
      case "peer-left":
        if (this.peerId === event.peerId) {
          this.disposeScreenShare(false);
          this.closePeerConnection();
          this.setState({
            connection: "waiting",
            peerId: null,
            error: null,
            audioBlocked: false,
          });
        }
        break;
      case "reset":
        this.stop();
        break;
      case "error":
        if (
          event.error.code === "NOT_IN_ROOM" ||
          event.error.code === "PEER_NOT_FOUND"
        ) {
          this.setState({ error: event.error.message });
        }
        break;
    }
  };

  private beginSession(peerId: string, initiator: boolean): void {
    if (this.pc && this.peerId === peerId) return;
    this.closePeerConnection();

    const iceServers: IceServer[] = roomService.getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    this.peerId = peerId;
    this.initiator = initiator;
    this.polite = !initiator;
    this.needsRenegotiation = false;
    this.setState({
      peerId,
      connection: "connecting",
      error: null,
      audioBlocked: false,
    });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      try {
        roomService.sendIceCandidate(JSON.stringify(event.candidate.toJSON()));
      } catch (error) {
        this.setState({ error: describeError(error) });
      }
    };

    pc.ondatachannel = (event) => {
      if (event.channel.label === "chat") this.setChatChannel(event.channel);
    };

    pc.ontrack = (event) => {
      if (event.track.kind === "video") {
        const remoteStream =
          event.streams.length > 0
            ? event.streams[0]!
            : new MediaStream([event.track]);
        this.setState({ remoteScreenStream: remoteStream });
        event.track.onended = () => {
          if (this.state.remoteScreenStream === remoteStream) {
            this.setState({ remoteScreenStream: null });
          }
        };
        event.track.onunmute = () => this.syncRemoteScreen();
        return;
      }

      console.log("¡Pista de audio remota recibida!", event.streams);
      const el = this.ensureAudioElement();
      const remoteStream =
        event.streams.length > 0
          ? event.streams[0]!
          : new MediaStream([event.track]);
      el.srcObject = remoteStream;
      el.muted = !this.prefs.remoteAudioEnabled;
      void el
        .play()
        .then(() => this.setState({ audioBlocked: false }))
        .catch(() => this.setState({ audioBlocked: true }));
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE Connection State:", pc.iceConnectionState);
      const state = pc.iceConnectionState;
      if (state === "connected" || state === "completed") {
        this.setState({ connection: "connected", error: null });
      } else if (state === "disconnected") {
        this.setState({ connection: "disconnected" });
      } else if (state === "failed") {
        this.setState({
          connection: "failed",
          error: "Falló la conexión de audio. Reintentando…",
        });
        if (this.initiator) void this.createAndSendOffer(true);
      }
    };

    this.addLocalTrack();
    this.addScreenTrack();
    if (this.screenStream) this.requestRenegotiation();
    if (initiator) {
      this.setChatChannel(pc.createDataChannel("chat"));
      void this.createAndSendOffer(false);
    }
  }

  private setChatChannel(channel: RTCDataChannel): void {
    this.clearChatChannel();
    this.chatChannel = channel;

    const onOpen = (): void => this.emitChatChannel({ type: "open" });
    const onClose = (): void => {
      if (this.chatChannel !== channel) return;
      this.clearChatChannel();
      this.emitChatChannel({ type: "close" });
    };
    const onMessage = (event: MessageEvent): void => {
      if (typeof event.data !== "string") return;
      this.emitChatChannel({ type: "message", data: event.data });
    };
    const onError = (): void => onClose();

    channel.addEventListener("open", onOpen);
    channel.addEventListener("close", onClose);
    channel.addEventListener("message", onMessage);
    channel.addEventListener("error", onError);
    this.chatChannelCleanup = () => {
      channel.removeEventListener("open", onOpen);
      channel.removeEventListener("close", onClose);
      channel.removeEventListener("message", onMessage);
      channel.removeEventListener("error", onError);
    };

    if (channel.readyState === "open") onOpen();
  }

  private clearChatChannel(): void {
    this.chatChannelCleanup?.();
    this.chatChannelCleanup = null;
    this.chatChannel = null;
  }

  private emitChatChannel(event: ChatChannelEvent): void {
    for (const listener of [...this.chatChannelListeners]) listener(event);
  }

  private addLocalTrack(): void {
    if (!this.pc || !this.localStream || this.localTrackAdded) return;
    const track = this.localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = this.computeMicEnabled();
    this.pc.addTrack(track, this.localStream);
    this.localTrackAdded = true;
  }

  private addScreenTrack(): void {
    const pc = this.pc;
    const stream = this.screenStream;
    if (!pc || !stream || this.screenSender) return;
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return;
    this.screenSender = pc.addTrack(track, stream);
  }

  private disposeScreenShare(renegotiate: boolean): void {
    const sender = this.screenSender;
    this.screenShareGeneration += 1;
    this.screenSender = null;
    if (sender && this.pc) {
      try {
        this.pc.removeTrack(sender);
      } catch {}
    }
    const stream = this.screenStream;
    this.screenStream = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
    }
    this.setState({
      screenSharing: false,
      screenShareStarting: false,
      screenShareError: null,
    });
    if (sender && renegotiate) this.requestRenegotiation();
  }

  private requestRenegotiation(): void {
    this.needsRenegotiation = true;
    this.enqueue(async () => {
      await this.flushRenegotiation();
    });
  }

  private async flushRenegotiation(): Promise<void> {
    const pc = this.pc;
    if (!pc || !this.needsRenegotiation) return;
    if (this.makingOffer || pc.signalingState !== "stable") return;
    this.needsRenegotiation = false;
    this.makingOffer = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (offer.sdp) roomService.sendOffer(offer.sdp);
    } catch (error) {
      this.setState({
        error: `No se pudo negociar la pantalla compartida: ${describeError(error)}`,
      });
    } finally {
      this.makingOffer = false;
    }
  }

  private syncRemoteScreen(): void {
    const pc = this.pc;
    if (!pc) {
      if (this.state.remoteScreenStream) {
        this.setState({ remoteScreenStream: null });
      }
      return;
    }

    const transceiver = pc.getTransceivers().find(
      (item) =>
        item.receiver.track.kind === "video" &&
        (item.currentDirection === "recvonly" ||
          item.currentDirection === "sendrecv"),
    );
    const track = transceiver?.receiver.track;
    if (!track || track.readyState !== "live") {
      if (this.state.remoteScreenStream) {
        this.setState({ remoteScreenStream: null });
      }
      return;
    }

    const current = this.state.remoteScreenStream?.getVideoTracks()[0];
    if (current !== track) {
      this.setState({ remoteScreenStream: new MediaStream([track]) });
    }
  }

  private async createAndSendOffer(iceRestart: boolean): Promise<void> {
    const pc = this.pc;
    if (
      !pc ||
      !this.initiator ||
      this.makingOffer ||
      pc.signalingState !== "stable"
    ) {
      return;
    }
    this.makingOffer = true;
    try {
      const offer = await pc.createOffer(
        iceRestart ? { iceRestart: true } : undefined,
      );
      await pc.setLocalDescription(offer);
      if (offer.sdp) roomService.sendOffer(offer.sdp);
    } catch (error) {
      this.setState({
        error: `No se pudo crear la oferta: ${describeError(error)}`,
      });
    } finally {
      this.makingOffer = false;
    }
  }

  private async handleOffer(from: string, sdp: string): Promise<void> {
    const pc = this.pc;
    if (!pc || (this.peerId && this.peerId !== from)) return;
    if (this.makingOffer || pc.signalingState !== "stable") {
      if (!this.polite) return;
      await pc.setLocalDescription({ type: "rollback" });
    }
    await pc.setRemoteDescription({ type: "offer", sdp });
    await this.flushIce();
    this.syncRemoteScreen();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (answer.sdp) roomService.sendAnswer(answer.sdp);
    await this.flushRenegotiation();
  }

  private async handleAnswer(from: string, sdp: string): Promise<void> {
    const pc = this.pc;
    if (!pc || (this.peerId && this.peerId !== from)) return;
    await pc.setRemoteDescription({ type: "answer", sdp });
    await this.flushIce();
    this.syncRemoteScreen();
    await this.flushRenegotiation();
  }

  private async handleIce(from: string, raw: string): Promise<void> {
    const pc = this.pc;
    if (!pc || (this.peerId && this.peerId !== from)) return;
    const candidate = parseIceCandidate(raw);
    if (!pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      this.setState({
        error: `ICE candidate rechazado: ${describeError(error)}`,
      });
    }
  }

  private async flushIce(): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    const pending = [...this.pendingIce];
    this.pendingIce = [];
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        this.setState({
          error: `ICE candidate rechazado: ${describeError(error)}`,
        });
      }
    }
  }

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task, task).catch((error: unknown) => {
      this.setState({
        error: describeError(error, "Falló la negociación WebRTC."),
      });
    });
  }

  private computeMicEnabled(): boolean {
    return this.prefs.micEnabled && (!this.prefs.pttEnabled || this.state.pttHeld);
  }

  private syncTracks(): void {
    const track = this.localStream?.getAudioTracks()[0];
    if (track) track.enabled = this.computeMicEnabled();
    if (this.audioEl) this.audioEl.muted = !this.prefs.remoteAudioEnabled;
  }

  private ensureAudioElement(): HTMLAudioElement {
    if (this.audioEl) return this.audioEl;
    const el = document.createElement("audio");
    el.autoplay = true;
    el.removeAttribute("muted");
    el.defaultMuted = false;
    el.muted = !this.prefs.remoteAudioEnabled;
    el.style.display = "none";
    el.setAttribute("playsinline", "");
    document.body.appendChild(el);
    this.audioEl = el;
    return el;
  }

  private removeAudioElement(): void {
    if (!this.audioEl) return;
    this.audioEl.pause();
    this.audioEl.srcObject = null;
    this.audioEl.remove();
    this.audioEl = null;
  }

  private closePeerConnection(): void {
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ondatachannel = null;
      this.pc.ontrack = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    if (this.chatChannel) {
      this.clearChatChannel();
      this.emitChatChannel({ type: "close" });
    }
    this.pendingIce = [];
    this.localTrackAdded = false;
    this.screenSender = null;
    this.needsRenegotiation = false;
    this.makingOffer = false;
    this.peerId = null;
    this.initiator = false;
    this.polite = false;
    if (this.state.remoteScreenStream) {
      this.setState({ remoteScreenStream: null });
    }
    this.removeAudioElement();
  }

  private setState(patch: Partial<VoiceSnapshot>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

export const voice = new VoiceService();
