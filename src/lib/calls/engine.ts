import { callOutcome, emptyCallView, isLiveCall, type CallMediaKind, type CallTransport, type IceConfig, type VoiceCall, type VoiceSignal, type VoiceView } from "@/lib/calls/types";

const initialView = emptyCallView;
function cameraError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (["NotAllowedError", "SecurityError"].includes(name)) return "Allow camera access in your browser or device settings. You can also answer with audio only.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "This camera is unavailable. Try another camera or answer with audio only.";
  if (name === "NotReadableError") return "Your camera is busy. Close other camera apps and try again.";
  return error instanceof Error ? error.message : "Could not open the camera. Your audio can continue.";
}
function microphoneError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (["NotAllowedError", "SecurityError"].includes(name)) return "Microphone access was blocked. Tap Retry to request access again. If no prompt appears, check this website's microphone permission in Safari or device settings.";
  if (name === "NotFoundError") return "No microphone was found. Connect one and try again.";
  if (name === "NotReadableError") return "Your microphone is busy in another app. Close it and try again.";
  return error instanceof Error ? error.message : "Could not start the call. Try again.";
}
const blockedPermission = (error: unknown) => error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name);
function captureError(error: unknown, withVideo: boolean) {
  if (!withVideo) return microphoneError(error);
  if (blockedPermission(error)) return "Microphone or camera access was blocked. Tap Retry to request access again. If no prompt appears, check this website's permissions in Safari or device settings.";
  if (error instanceof DOMException && ["NotFoundError", "OverconstrainedError"].includes(error.name)) return "A microphone or camera is unavailable. Check your devices, or make an audio call instead.";
  if (error instanceof DOMException && error.name === "NotReadableError") return "Your microphone or camera is busy. Close other calling or camera apps, then try again.";
  return microphoneError(error);
}

// Owns one call and releases every microphone/connection when it ends.
// SDP negotiation follows the polite/impolite WebRTC negotiation pattern.
export class VoiceCallEngine {
  view = initialView();
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private capturing: MediaStream | null = null;
  private config: IceConfig | null = null;
  private readyConfig: IceConfig | null = null;
  private readyUntil = 0;
  private configRequest: Promise<IceConfig> | null = null;
  private permissionVideo = true;
  private epoch = 0;
  private cursor = 0;
  private disposed = false;
  private preparing = false;
  private pumping = false;
  private pumpAgain = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private settingRemoteAnswer = false;
  private candidates: RTCIceCandidateInit[] = [];
  private sends = Promise.resolve();
  private lastPing = 0;
  private lastStats = 0;
  private statsPackets = { lost: 0, received: 0 };
  private interval: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failTimer: ReturnType<typeof setTimeout> | null = null;
  private stopWatching: (() => void) | null = null;
  private tone: AudioContext | null = null;
  private toneTimer: ReturnType<typeof setInterval> | null = null;
  private pendingEnd: { id: string; action: "end" | "fail" | "decline" } | null = null;
  private videoSender: RTCRtpSender | null = null;
  private mediaChannel: RTCDataChannel | null = null;
  private remoteCameraKnown = false;

  constructor(public readonly transport: CallTransport, private audio: HTMLAudioElement, private changed: (view: VoiceView) => void) {}
  private patch(patch: Partial<VoiceView>) { if (this.disposed) return; this.view = { ...this.view, ...patch }; this.changed(this.view); }
  private owns(call: VoiceCall) { return call.caller_id === this.transport.userId ? call.caller_device === this.transport.deviceId : call.callee_device === this.transport.deviceId; }
  private valid(epoch: number) { return !this.disposed && epoch === this.epoch; }

  begin() {
    // Warm only relay credentials, never camera/microphone permissions. Keep
    // capture itself inside the user's start/answer click, with no network await.
    void this.prepareConnection().catch(() => undefined);
    this.stopWatching = this.transport.watch(() => void this.refresh());
    let lastPoll = 0;
    this.interval = setInterval(() => { if (isLiveCall(this.view.call) || this.pendingEnd || Date.now() - lastPoll >= 10000) { lastPoll = Date.now(); void this.refresh(); } }, 2500);
    void this.refresh();
  }

  private connectionReady() { return !this.disposed && this.readyConfig && Date.now() < this.readyUntil ? this.readyConfig : null; }
  prepareConnection(): Promise<IceConfig> {
    const ready = this.connectionReady();
    if (ready) return Promise.resolve(ready);
    if (this.configRequest) return this.configRequest;
    const request = this.transport.ice().then(config => {
      if (this.disposed) throw new Error("Call session closed.");
      if (!Number.isFinite(config.expiresAt) || config.expiresAt <= Date.now() + 60000) throw new Error("Call connection credentials expired. Please retry.");
      this.readyConfig = config; this.readyUntil = Math.min(config.expiresAt - 60000, Date.now() + 300000);
      return config;
    }).finally(() => { if (this.configRequest === request) this.configRequest = null; });
    this.configRequest = request; return request;
  }

  private unlockSound() {
    try { this.tone ||= new AudioContext(); void this.tone.resume().catch(() => undefined); } catch {}
    void this.audio.play().catch(() => undefined);
  }
  enableSound() { this.unlockSound(); }
  private ring(incoming: boolean) {
    this.stopRing();
    try { this.tone ||= new AudioContext(); } catch { return; }
    const play = () => {
      if (!this.tone || this.tone.state !== "running") return;
      const gain = this.tone.createGain(); gain.gain.setValueAtTime(0.025, this.tone.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, this.tone.currentTime + 0.7); gain.connect(this.tone.destination);
      for (const frequency of incoming ? [660, 880] : [440, 480]) { const oscillator = this.tone.createOscillator(); oscillator.frequency.value = frequency; oscillator.connect(gain); oscillator.start(); oscillator.stop(this.tone.currentTime + 0.7); oscillator.onended = () => oscillator.disconnect(); }
      setTimeout(() => gain.disconnect(), 800);
    };
    play(); this.toneTimer = setInterval(play, incoming ? 2000 : 3000);
    if (incoming && document.visibilityState === "visible") navigator.vibrate?.([150, 100, 150]);
  }
  private stopRing() { if (this.toneTimer) clearInterval(this.toneTimer); this.toneTimer = null; navigator.vibrate?.(0); }
  private async microphone(deviceId?: string) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Voice calls require HTTPS and a browser with microphone support.");
    return navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
  }
  private async camera(facing: "user" | "environment", exact = false) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Video calls require HTTPS and camera support.");
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: exact ? { exact: facing } : { ideal: facing }, width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 24, max: 30 } } });
  }
  private async media(withVideo: boolean, epoch: number) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Calls require HTTPS and a browser with microphone and camera support. Open the app's HTTPS link directly in Safari or Chrome.");
    // One request preserves the click gesture for BOTH permissions and avoids
    // opening a second capture session that can interrupt iPhone audio.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } },
      video: withVideo ? { facingMode: { ideal: "user" }, width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 24, max: 30 } } : false,
    });
    if (!this.valid(epoch)) { stream.getTracks().forEach(track => track.stop()); return stream; }
    this.capturing = stream;
    return stream;
  }
  private publishLocalVideo() {
    const track = this.local?.getVideoTracks().find(track => track.readyState === "live");
    this.patch({ cameraOn: Boolean(track), localVideo: track ? new MediaStream([track]) : null });
    if (track) track.onended = () => { if (this.local?.getVideoTracks().includes(track)) { this.local.removeTrack(track); this.publishLocalVideo(); this.sendCameraState(); this.patch({ cameraError: "Your camera stopped. Turn it on again to resume video." }); } };
  }
  private sendCameraState() { if (this.mediaChannel?.readyState === "open") { try { this.mediaChannel.send(JSON.stringify({ cameraOn: this.view.cameraOn })); } catch {} } }
  private bindMediaChannel(channel: RTCDataChannel) {
    if (channel.label !== "together-media") { channel.close(); return; }
    this.mediaChannel = channel;
    channel.onopen = () => this.sendCameraState();
    channel.onmessage = event => { if (this.mediaChannel !== channel || typeof event.data !== "string" || event.data.length > 128) return; try { const state = JSON.parse(event.data); if (typeof state.cameraOn === "boolean") { this.remoteCameraKnown = true; this.patch({ remoteCameraOn: state.cameraOn }); } } catch {} };
  }
  private async prepareVideoAnswer(pc: RTCPeerConnection) {
    if (this.view.call?.media_kind !== "video") return;
    const transceiver = pc.getTransceivers().find(item => item.receiver.track.kind === "video");
    if (!transceiver) return;
    transceiver.direction = "sendrecv"; this.videoSender = transceiver.sender;
    const track = this.local?.getVideoTracks()[0] || null;
    if (this.local) transceiver.sender.setStreams(this.local);
    await transceiver.sender.replaceTrack(track);
  }

  async start(kind: CallMediaKind = "audio") {
    if (this.preparing || isLiveCall(this.view.call)) return;
    const epoch = ++this.epoch, id = crypto.randomUUID();
    this.preparing = true; this.unlockSound(); this.patch({ ...initialView(), phase: "preparing", mediaKind: kind });
    let stream: MediaStream | null = null;
    let capturing = false;
    try {
      const config = this.connectionReady();
      if (!config) {
        await this.prepareConnection();
        if (this.valid(epoch)) this.patch({ phase: "permission" });
        return; // A fresh tap must request capture; never auto-capture after fetch.
      }
      capturing = true;
      stream = await this.media(kind === "video", epoch); if (!this.valid(epoch)) { stream.getTracks().forEach(track => track.stop()); return; }
      capturing = false;
      let call: VoiceCall;
      try { call = await this.transport.start(id, kind); }
      catch (error: unknown) { const recovered = await this.transport.get(id).catch(() => null); if (!recovered || !this.owns(recovered) || !isLiveCall(recovered)) throw error; call = recovered; }
      if (!this.valid(epoch)) { stream.getTracks().forEach(track => track.stop()); this.transport.leave(id); return; }
      this.patch({ call }); this.local = stream; this.capturing = null; if (kind === "video") this.publishLocalVideo(); this.config = config; this.cursor = 0; this.preparing = false; this.adopt(call);
      void this.transport.notify(id).then(notice => { if (this.valid(epoch) && notice) this.patch({ notice }); }).catch(() => { if (this.valid(epoch)) this.patch({ notice: "Call is ringing in the app. The push alert could not be delivered." }); });
    } catch (error: unknown) {
      stream?.getTracks().forEach(track => track.stop()); if (this.capturing === stream) this.capturing = null; this.transport.leave(id);
      if (this.valid(epoch)) { this.patch({ phase: "finished", error: capturing ? captureError(error, kind === "video") : microphoneError(error), permissionBlocked: capturing && blockedPermission(error) }); this.preparing = false; await this.refresh(); }
    } finally { if (this.valid(epoch)) this.preparing = false; }
  }

  async accept(withVideo = true) {
    const call = this.view.call;
    if (!call || call.state !== "ringing" || call.callee_id !== this.transport.userId || this.preparing) return;
    const epoch = ++this.epoch; this.preparing = true; this.unlockSound(); this.patch({ phase: "connecting", error: "", notice: "" });
    this.permissionVideo = withVideo;
    this.patch({ permissionBlocked: false });
    let stream: MediaStream | null = null;
    let capturing = false;
    try {
      const config = this.connectionReady();
      if (!config) {
        await this.prepareConnection();
        if (this.valid(epoch)) this.patch({ phase: "permission" });
        return;
      }
      capturing = true;
      stream = await this.media(call.media_kind === "video" && withVideo, epoch); if (!this.valid(epoch)) { stream.getTracks().forEach(track => track.stop()); return; }
      capturing = false;
      let accepted: VoiceCall;
      try { accepted = await this.transport.action(call.id, "accept"); }
      catch (error: unknown) { const recovered = await this.transport.get(call.id).catch(() => null); if (!recovered || !this.owns(recovered) || !["accepted", "active"].includes(recovered.state)) throw error; accepted = recovered; }
      if (!this.valid(epoch)) { stream.getTracks().forEach(track => track.stop()); this.transport.leave(call.id); return; }
      this.local = stream; this.capturing = null; if (call.media_kind === "video") this.publishLocalVideo(); this.config = config; this.cursor = 0; this.preparing = false; this.adopt(accepted);
    } catch (error: unknown) { stream?.getTracks().forEach(track => track.stop()); if (this.capturing === stream) this.capturing = null; if (this.valid(epoch)) this.patch({ phase: "incoming", error: capturing ? captureError(error, call.media_kind === "video" && withVideo) : microphoneError(error), permissionBlocked: capturing && blockedPermission(error) }); }
    finally { if (this.valid(epoch)) { this.preparing = false; await this.refresh(); } }
  }

  continuePermission() {
    if (this.view.phase !== "permission") return;
    return this.view.call?.callee_id === this.transport.userId ? this.accept(this.permissionVideo) : this.start(this.view.mediaKind);
  }

  private adopt(call: VoiceCall) {
    // Network snapshots must not revive a locally ended/cancelled session.
    if (isLiveCall(call) && (this.pendingEnd?.id === call.id || this.view.call?.id === call.id && !isLiveCall(this.view.call))) return;
    if (!isLiveCall(call)) { this.release(); this.patch({ call, phase: "finished", notice: callOutcome(call), quality: "unknown" }); return; }
    const newCall = this.view.call?.id !== call.id;
    if (newCall) { this.release(); this.cursor = 0; this.patch({ ...initialView(), call }); }
    else this.patch({ call, mediaKind: call.media_kind || "audio" });
    if (newCall) this.patch({ mediaKind: call.media_kind || "audio" });
    if (call.state === "ringing") {
      const incoming = call.callee_id === this.transport.userId;
      if (!incoming && !this.owns(call)) { this.patch({ phase: "elsewhere" }); return; }
      const phase = incoming ? "incoming" : "ringing";
      if (incoming && !newCall && this.view.phase === "permission") return;
      if (this.view.phase !== phase) { this.patch({ phase }); this.ring(incoming); }
      return;
    }
    this.stopRing();
    if (!this.owns(call)) { this.release(); this.patch({ phase: "elsewhere" }); return; }
    if (!this.pc && this.local && this.config) this.connect(call);
    else if (!this.pc && !this.preparing) { this.pendingEnd = { id: call.id, action: "fail" }; this.patch({ phase: "finished", error: "This call cannot be restored after a page reload. Please call again." }); }
  }

  async refresh() {
    if (this.disposed || this.preparing) return;
    if (this.pumping) { this.pumpAgain = true; return; }
    this.pumping = true;
    const epoch = this.epoch;
    try {
      if (this.pendingEnd) { const pending = this.pendingEnd; await this.transport.action(pending.id, pending.action); if (this.pendingEnd === pending) this.pendingEnd = null; }
      const active = await this.transport.current(); if (!this.valid(epoch) || this.preparing) return;
      const current = this.view.call;
      if (active) this.adopt(active);
      else if (current && isLiveCall(current)) { const ended = await this.transport.get(current.id); if (!this.valid(epoch) || this.preparing) return; if (ended) this.adopt(ended); else { this.release(); this.patch({ phase: "finished", call: null, notice: "Call ended" }); } }
      const call = this.view.call;
      if (call && isLiveCall(call) && this.owns(call)) {
        if (Date.now() - this.lastPing > 10000) { this.lastPing = Date.now(); await this.transport.action(call.id, "ping"); }
        if (this.pc) {
          let more = true;
          while (more && this.pc && this.view.call?.id === call.id) {
            const rows = await this.transport.signals(call.id, this.cursor);
            for (const row of rows) { if (!this.pc || this.view.call?.id !== call.id) break; if (row.sender_id !== this.transport.userId) await this.receive(row); this.cursor = Math.max(this.cursor, Number(row.seq)); }
            more = rows.length === 100;
          }
          if (Date.now() - this.lastStats > 5000) { this.lastStats = Date.now(); await this.measureQuality(); }
        }
      }
    } catch (error: unknown) { if (isLiveCall(this.view.call) && this.view.phase !== "finished") this.patch({ notice: "Connection check delayed. Trying again…" }); }
    finally { this.pumping = false; if (this.pumpAgain && !this.disposed) { this.pumpAgain = false; setTimeout(() => void this.refresh(), 150); } }
  }

  private connect(call: VoiceCall) {
    const pc = new RTCPeerConnection({ iceServers: this.config!.iceServers, iceTransportPolicy: this.config!.iceTransportPolicy, bundlePolicy: "max-bundle" });
    this.pc = pc; this.makingOffer = false; this.ignoreOffer = false; this.settingRemoteAnswer = false; this.candidates = []; this.sends = Promise.resolve();
    this.patch({ phase: "connecting" });
    pc.ontrack = event => { if (this.pc !== pc) return; if (event.track.kind === "video") { this.patch({ remoteVideo: new MediaStream([event.track]), ...(!this.remoteCameraKnown ? { remoteCameraOn: true } : {}) }); } else { this.audio.srcObject = new MediaStream([event.track]); void this.playAudio(); } };
    if (call.media_kind === "video") {
      pc.ondatachannel = event => { if (this.pc === pc) this.bindMediaChannel(event.channel); };
      if (call.caller_id === this.transport.userId) { this.bindMediaChannel(pc.createDataChannel("together-media")); this.videoSender = pc.addTransceiver(this.local!.getVideoTracks()[0] || "video", { direction: "sendrecv", streams: [this.local!], sendEncodings: [{ maxBitrate: 750000, maxFramerate: 24 }] }).sender; }
    }
    pc.onicecandidate = event => { if (this.pc === pc && event.candidate) void this.send("candidate", event.candidate.toJSON()); };
    pc.onnegotiationneeded = async () => {
      try { this.makingOffer = true; await pc.setLocalDescription(); if (this.pc === pc && pc.localDescription) await this.send("description", { type: pc.localDescription.type, sdp: pc.localDescription.sdp }); }
      catch (error: unknown) { if (this.pc === pc) void this.fail("Could not establish the audio connection. Please call again."); }
      finally { this.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === "connected") {
        if (this.videoSender) { const sender = this.videoSender; const parameters = sender.getParameters(); if (parameters.encodings?.length) { for (const encoding of parameters.encodings) { encoding.maxBitrate = 750000; encoding.maxFramerate = 24; } void sender.setParameters(parameters).catch(() => undefined); } }
        this.clearRecovery(); this.patch({ phase: "connected", connectedAt: this.view.connectedAt || Date.now(), notice: "", error: "" });
        void this.transport.action(call.id, "connected").catch(() => this.patch({ notice: "Audio is connected. Updating call status…" }));
      } else if (["disconnected", "failed"].includes(pc.connectionState)) this.recover();
    };
    for (const track of this.local!.getAudioTracks()) { track.onended = () => { if (this.pc === pc) void this.fail("Your microphone disconnected. Please call again."); }; pc.addTrack(track, this.local!); }
  }

  private send(kind: VoiceSignal["kind"], payload: VoiceSignal["payload"]) {
    const call = this.view.call, epoch = this.epoch; if (!call) return Promise.resolve();
    const signal = { id: crypto.randomUUID(), kind, payload };
    const task = this.sends.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!this.valid(epoch) || !this.pc || this.view.call?.id !== call.id) return;
        try { await this.transport.send(call.id, signal); return; }
        catch (error: unknown) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1))); }
      }
    });
    this.sends = task.catch(() => { if (this.valid(epoch) && this.pc) void this.fail("The call connection could not be negotiated. Please try again."); });
    return this.sends;
  }

  private candidateMatches(candidate: RTCIceCandidateInit, pc: RTCPeerConnection) { return !candidate.usernameFragment || Boolean(pc.remoteDescription?.sdp.includes(`a=ice-ufrag:${candidate.usernameFragment}`)); }
  private async receive(signal: VoiceSignal) {
    const pc = this.pc, call = this.view.call; if (!pc || !call) return;
    if (signal.kind === "description") {
      const description = signal.payload as RTCSessionDescriptionInit;
      const ready = !this.makingOffer && (pc.signalingState === "stable" || this.settingRemoteAnswer);
      const collision = description.type === "offer" && !ready;
      this.ignoreOffer = call.caller_id === this.transport.userId && collision;
      if (this.ignoreOffer) return;
      this.settingRemoteAnswer = description.type === "answer";
      try { await pc.setRemoteDescription(description); } finally { this.settingRemoteAnswer = false; }
      if (this.pc !== pc) return;
      const waiting = this.candidates; this.candidates = [];
      for (const candidate of waiting) { if (this.candidateMatches(candidate, pc)) await pc.addIceCandidate(candidate).catch(() => undefined); else this.candidates.push(candidate); }
      if (description.type === "offer") { await this.prepareVideoAnswer(pc); if (this.pc !== pc) return; await pc.setLocalDescription(); if (this.pc === pc && pc.localDescription) await this.send("description", { type: pc.localDescription.type, sdp: pc.localDescription.sdp }); }
    } else {
      const candidate = signal.payload as RTCIceCandidateInit;
      if (this.ignoreOffer) return;
      if (!pc.remoteDescription || !this.candidateMatches(candidate, pc)) { this.candidates.push(candidate); if (this.candidates.length > 100) this.candidates.shift(); }
      else await pc.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  private recover() {
    if (!this.pc) return;
    this.patch({ phase: "reconnecting", quality: "weak", notice: "Reconnecting your audio…" });
    if (!this.retryTimer) this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.pc && this.pc.connectionState !== "connected") this.pc.restartIce(); }, 3000);
    if (!this.failTimer) this.failTimer = setTimeout(() => { if (this.pc && this.pc.connectionState !== "connected") void this.fail("The connection was lost. Check your network and call again."); }, 25000);
  }
  private clearRecovery() { if (this.retryTimer) clearTimeout(this.retryTimer); if (this.failTimer) clearTimeout(this.failTimer); this.retryTimer = null; this.failTimer = null; }
  private async measureQuality() {
    const pc = this.pc; if (!pc || pc.connectionState !== "connected") return;
    const reports = await pc.getStats(); if (this.pc !== pc) return;
    let lost = 0, received = 0, jitter = 0, rtt = 0;
    reports.forEach(report => { if (report.type === "inbound-rtp" && report.kind === "audio") { lost += report.packetsLost || 0; received += report.packetsReceived || 0; jitter = Math.max(jitter, report.jitter || 0); } if (report.type === "remote-inbound-rtp") rtt = Math.max(rtt, report.roundTripTime || 0); });
    const packetDelta = Math.max(0, received - this.statsPackets.received), lossDelta = Math.max(0, lost - this.statsPackets.lost); this.statsPackets = { lost, received };
    if (received) this.patch({ quality: (lossDelta / Math.max(1, packetDelta + lossDelta) > 0.08 || jitter > 0.06 || rtt > 0.6) ? "weak" : "good" });
  }

  async playAudio() { try { await this.audio.play(); this.patch({ playbackBlocked: false }); } catch { if (this.audio.srcObject) this.patch({ playbackBlocked: true }); } }
  toggleMute() { if (!this.local) return; const muted = !this.view.muted; this.local.getAudioTracks().forEach(track => { track.enabled = !muted; }); this.patch({ muted }); }
  async changeMicrophone(deviceId: string) {
    const epoch = this.epoch, pc = this.pc; if (!pc) return;
    const stream = await this.microphone(deviceId);
    if (!this.valid(epoch) || this.pc !== pc) { stream.getTracks().forEach(track => track.stop()); return; }
    try { const track = stream.getAudioTracks()[0], sender = pc.getSenders().find(item => item.track?.kind === "audio"); if (!sender || !track) throw new Error("No active microphone."); track.enabled = !this.view.muted; await sender.replaceTrack(track); if (!this.valid(epoch) || this.pc !== pc) { stream.getTracks().forEach(item => item.stop()); return; } this.local?.getAudioTracks().forEach(item => { item.onended = null; item.stop(); this.local?.removeTrack(item); }); this.local?.addTrack(track); track.onended = () => void this.fail("Your microphone disconnected."); }
    catch (error: unknown) { stream.getTracks().forEach(track => track.stop()); throw new Error(microphoneError(error)); }
  }
  async output(deviceId: string) { if (!("setSinkId" in this.audio)) throw new Error("Use your device controls to select speaker or Bluetooth."); await this.audio.setSinkId(deviceId); }

  async toggleCamera() { await this.changeCamera(this.view.cameraFacing, !this.view.cameraOn); }
  async switchCamera() { if (!this.view.cameraOn) return; await this.changeCamera(this.view.cameraFacing === "user" ? "environment" : "user", true, true); }
  private async changeCamera(facing: "user" | "environment", enable: boolean, switching = false) {
    const pc = this.pc, sender = this.videoSender, epoch = this.epoch;
    if (!pc || !sender || this.view.mediaKind !== "video" || this.view.cameraBusy) return;
    this.patch({ cameraBusy: true, cameraError: "" });
    let stream: MediaStream | null = null;
    try {
      // Mobile cameras often cannot be captured simultaneously. Release the old
      // camera first while preserving the microphone and negotiated video sender.
      await sender.replaceTrack(null);
      if (!this.valid(epoch) || this.pc !== pc) return;
      this.local?.getVideoTracks().forEach(track => { track.onended = null; track.stop(); this.local?.removeTrack(track); });
      this.publishLocalVideo(); this.sendCameraState();
      if (!enable) return;
      stream = await this.camera(facing, switching);
      if (!this.valid(epoch) || this.pc !== pc) { stream.getTracks().forEach(track => track.stop()); return; }
      const track = stream.getVideoTracks()[0]; if (!track) throw new Error("No camera track was found.");
      await sender.replaceTrack(track);
      if (!this.valid(epoch) || this.pc !== pc) { stream.getTracks().forEach(track => track.stop()); return; }
      this.local?.addTrack(track); this.patch({ cameraFacing: facing }); this.publishLocalVideo(); this.sendCameraState();
    } catch (error) { stream?.getTracks().forEach(track => track.stop()); if (this.valid(epoch)) this.patch({ cameraError: cameraError(error) }); }
    finally { if (this.valid(epoch)) this.patch({ cameraBusy: false }); }
  }

  private release() {
    this.stopRing(); this.clearRecovery();
    const pc = this.pc; this.pc = null;
    if (this.mediaChannel) { this.mediaChannel.onopen = null; this.mediaChannel.onmessage = null; this.mediaChannel.close(); this.mediaChannel = null; }
    this.videoSender = null; this.remoteCameraKnown = false;
    if (pc) { pc.ontrack = null; pc.ondatachannel = null; pc.onicecandidate = null; pc.onnegotiationneeded = null; pc.onconnectionstatechange = null; pc.close(); }
    this.local?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.local = null;
    this.capturing?.getTracks().forEach(track => track.stop()); this.capturing = null;
    this.audio.pause(); this.audio.srcObject = null; this.candidates = []; this.statsPackets = { lost: 0, received: 0 };
    this.patch({ cameraOn: false, cameraBusy: false, localVideo: null, remoteVideo: null, remoteCameraOn: false });
  }
  async end() {
    const call = this.view.call;
    const action = "end";
    ++this.epoch; this.preparing = false; this.release(); this.patch({ phase: "finished", notice: call?.state === "ringing" && call.callee_id === this.transport.userId ? "Call declined" : "Call ended", playbackBlocked: false });
    if (!call || !isLiveCall(call)) return;
    this.pendingEnd = { id: call.id, action };
    try { const ended = await this.transport.action(call.id, action); if (this.view.call?.id === call.id) { this.pendingEnd = null; this.patch({ call: ended, phase: "finished", notice: callOutcome(ended) }); } }
    catch { this.patch({ notice: "Audio stopped. Updating call status when you reconnect…" }); }
  }
  private async fail(message: string) { const call = this.view.call; ++this.epoch; this.preparing = false; this.release(); this.patch({ phase: "finished", error: message, playbackBlocked: false }); if (call && this.owns(call)) { this.pendingEnd = { id: call.id, action: "fail" }; await this.refresh(); } }
  dismiss() { if (isLiveCall(this.view.call) && this.view.phase !== "finished") return; this.patch(initialView()); }
  dispose() { const call = this.view.call; this.disposed = true; this.readyConfig = null; this.readyUntil = 0; ++this.epoch; this.release(); if (this.interval) clearInterval(this.interval); this.stopWatching?.(); void this.tone?.close().catch(() => undefined); if (call && isLiveCall(call) && this.owns(call)) this.transport.leave(call.id); }
}
