// The song, synthesized with WebAudio and scheduled a few hundred milliseconds
// ahead, plus the clock everything else reads. Song time is what the viewer
// *hears*: the audio context's output timestamp, mapped onto performance.now(),
// so cues, judgments and the route all agree with the speakers.

import type { Sfx } from "../core/audio";
import { BEAT, BEATS_PER_BAR, SONG_BEATS } from "./song";

const STEP = BEAT / 4;
const STEPS_PER_BAR = BEATS_PER_BAR * 4;
const LOOKAHEAD = 0.3;
/** Scheduling margin when (re)starting so the first notes are never in the past. */
const START_MARGIN = 0.08;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// Dm – Bb – F – C, one chord per bar.
const CHORDS = [
  [62, 65, 69],
  [58, 62, 65],
  [65, 69, 72],
  [60, 64, 67],
];
const ROOTS = [38, 34, 41, 36];
// A hook in eighth notes over the four chords (0 = rest).
const HOOK = [
  [69, 0, 74, 0, 72, 69, 0, 65],
  [65, 0, 67, 69, 0, 65, 62, 0],
  [72, 0, 69, 0, 65, 69, 72, 0],
  [76, 0, 74, 72, 0, 67, 0, 0],
];
const ARP = [0, 1, 2, 3, 2, 1, 0, 1];
const BASS = [0, 0, 12, 0, 0, 12, 7, 12];

const CRASH_BARS = new Set([2, 10, 18, 26, 30]);
const RISER_BARS = new Set([1, 9, 17, 25, 29]);

class Music {
  private bus: GainNode | null = null;
  private t0 = 0;
  private nextStep = 0;
  private readonly noise: AudioBuffer;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Song second `songTime` will sound when the context clock reads `at`. */
  play(songTime: number, at: number) {
    this.stop();
    const bus = this.ctx.createGain();
    bus.gain.value = 0.62;
    bus.connect(this.out);
    this.bus = bus;
    this.t0 = at - songTime;
    this.nextStep = Math.max(0, Math.ceil(songTime / STEP - 1e-6));
    this.pump();
  }

  stop() {
    const bus = this.bus;
    if (!bus) return;
    this.bus = null;
    // Already-scheduled notes keep playing into the old bus; fade it out and drop it.
    const t = this.ctx.currentTime;
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(0, t + 0.06);
    setTimeout(() => bus.disconnect(), 120);
  }

  pump() {
    const bus = this.bus;
    if (!bus) return;
    const now = this.ctx.currentTime;
    const until = now + LOOKAHEAD;
    while (this.nextStep < SONG_BEATS * 4) {
      const t = this.t0 + this.nextStep * STEP;
      if (t > until) break;
      if (t >= now - 0.005) this.step(this.nextStep, Math.max(t, now), bus);
      this.nextStep++;
    }
  }

  // ---------------------------------------------------------------- arrangement
  private step(i: number, t: number, bus: AudioNode) {
    const bar = Math.floor(i / STEPS_PER_BAR);
    const s = i % STEPS_PER_BAR; // 16th within the bar
    const beat = Math.floor(s / 4);
    const onBeat = s % 4 === 0;
    const eighth = s % 2 === 0 ? s / 2 : -1;
    const chord = bar % 4;

    if (bar >= 30) {
      // Final chord and tail.
      if (bar === 30 && s === 0) {
        this.crash(t, bus, 0.3);
        this.kick(t, bus);
        this.pad(t, BEAT * 7, CHORDS[0], bus, 1.4);
        this.bass(t, ROOTS[0], BEAT * 4, bus);
        [74, 77, 81, 86].forEach((n, k) => this.lead(t + k * 0.06, n, BEAT * 3, bus, 0.06));
      }
      return;
    }

    // Count-in sticks, then the leap whoosh.
    if (bar === 1 && onBeat && beat < 3) this.stick(t, beat === 2 ? 1568 : 1046, bus);

    if (s === 0) this.pad(t, BEAT * BEATS_PER_BAR, CHORDS[chord], bus, bar < 2 ? 0.8 : 1);
    if (s === 0 && CRASH_BARS.has(bar)) this.crash(t, bus, 0.22);
    if (s === 8 && RISER_BARS.has(bar)) this.riser(t, BEAT * 2, bus);

    const hats16 = bar >= 26;
    if (hats16 || s % 2 === 0) this.hat(t, bus, bar < 2 ? 0.05 : s % 4 === 2 ? 0.11 : 0.07);
    if (bar >= 18 && s % 4 === 2) this.openHat(t, bus);

    if (bar >= 2 && onBeat) this.kick(t, bus);
    if (bar >= 10 && onBeat && (beat === 1 || beat === 3)) this.snare(t, bus);
    if (bar >= 26 && s === 14) this.snare(t, bus, 0.18);

    if (bar >= 2 && eighth >= 0) this.bass(t, ROOTS[chord] + BASS[eighth], STEP * 1.7, bus);
    if (bar >= 10 && eighth >= 0) {
      const notes = [...CHORDS[chord], CHORDS[chord][0] + 12];
      this.arp(t, notes[ARP[eighth]] + 12, bus);
    }
    if (bar >= 18 && eighth >= 0) {
      const n = HOOK[chord][eighth];
      if (n) this.lead(t, n + (bar >= 26 ? 12 : 0), STEP * 1.8, bus, bar >= 26 ? 0.05 : 0.065);
    }
  }

  // ---------------------------------------------------------------- voices
  private env(g: GainNode, t: number, peak: number, attack: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, to: AudioNode, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    o.connect(to);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noiseSrc(t: number, dur: number, to: AudioNode) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.connect(to);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    return src;
  }

  private kick(t: number, bus: AudioNode) {
    const g = this.ctx.createGain();
    g.connect(bus);
    this.env(g, t, 0.95, 0.004, 0.32);
    const o = this.osc("sine", 160, t, 0.32, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  }

  private snare(t: number, bus: AudioNode, vol = 0.32) {
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1900;
    f.Q.value = 0.7;
    const g = this.ctx.createGain();
    f.connect(g).connect(bus);
    this.env(g, t, vol, 0.003, 0.18);
    this.noiseSrc(t, 0.2, f);
    const g2 = this.ctx.createGain();
    g2.connect(bus);
    this.env(g2, t, vol * 0.6, 0.003, 0.1);
    this.osc("triangle", 190, t, 0.1, g2);
  }

  private hat(t: number, bus: AudioNode, vol: number) {
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7600;
    const g = this.ctx.createGain();
    f.connect(g).connect(bus);
    this.env(g, t, vol, 0.002, 0.04);
    this.noiseSrc(t, 0.05, f);
  }

  private openHat(t: number, bus: AudioNode) {
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 6800;
    const g = this.ctx.createGain();
    f.connect(g).connect(bus);
    this.env(g, t, 0.06, 0.004, 0.16);
    this.noiseSrc(t, 0.18, f);
  }

  private crash(t: number, bus: AudioNode, vol: number) {
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 3800;
    const g = this.ctx.createGain();
    f.connect(g).connect(bus);
    this.env(g, t, vol, 0.004, 1.4);
    this.noiseSrc(t, 1.5, f);
  }

  private riser(t: number, dur: number, bus: AudioNode) {
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const g = this.ctx.createGain();
    f.connect(g).connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.95);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    this.noiseSrc(t, dur + 0.05, f);
  }

  private stick(t: number, freq: number, bus: AudioNode) {
    const g = this.ctx.createGain();
    g.connect(bus);
    this.env(g, t, 0.22, 0.002, 0.07);
    this.osc("square", freq, t, 0.07, g);
  }

  private pad(t: number, dur: number, notes: number[], bus: AudioNode, vol: number) {
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1300;
    const g = this.ctx.createGain();
    f.connect(g).connect(bus);
    const peak = 0.05 * vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.18);
    g.gain.setValueAtTime(peak, t + dur - 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    for (const n of notes) {
      this.osc("sawtooth", hz(n - 12), t, dur + 0.3, f, -8);
      this.osc("sawtooth", hz(n - 12), t, dur + 0.3, f, 8);
    }
  }

  private bass(t: number, note: number, dur: number, bus: AudioNode) {
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 4;
    f.frequency.setValueAtTime(280, t);
    f.frequency.exponentialRampToValueAtTime(1100, t + 0.02);
    f.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = this.ctx.createGain();
    f.connect(g).connect(bus);
    this.env(g, t, 0.2, 0.004, dur);
    this.osc("sawtooth", hz(note), t, dur, f);
  }

  private arp(t: number, note: number, bus: AudioNode) {
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2600;
    const g = this.ctx.createGain();
    f.connect(g).connect(bus);
    this.env(g, t, 0.045, 0.003, 0.16);
    this.osc("square", hz(note), t, 0.16, f);
  }

  private lead(t: number, note: number, dur: number, bus: AudioNode, vol: number) {
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 3400;
    const g = this.ctx.createGain();
    f.connect(g).connect(bus);
    this.env(g, t, vol, 0.01, dur);
    this.osc("square", hz(note), t, dur, f, 4);
    this.osc("triangle", hz(note + 12), t, dur, f);
  }
}

/**
 * Owns the music and the song clock. Song time runs from the audio output while
 * sound is available, and from performance.now() when it is not (the context can
 * stay locked until the first key press), switching seamlessly when sound unlocks.
 */
export class Conductor {
  private music: Music | null = null;
  private mode: "stopped" | "audio" | "wall" = "stopped";
  /** audio: context seconds at song 0 · wall: performance seconds at song 0. */
  private base = 0;
  private paused = false;
  private pausedSong = 0;
  /** Smoothed (audible context time − performance time), seconds. */
  private off = 0;
  private offOk = false;
  private pumpTimer = 0;

  constructor(private readonly sfx: Sfx) {}

  get running() {
    return this.mode !== "stopped" && !this.paused;
  }
  get audible() {
    return this.mode === "audio";
  }

  start(fromSong: number) {
    this.stop();
    this.paused = false;
    if (!this.enterAudio(fromSong)) this.enterWall(fromSong);
    this.pumpTimer = window.setInterval(() => this.music?.pump(), 50);
  }

  stop() {
    this.music?.stop();
    this.mode = "stopped";
    window.clearInterval(this.pumpTimer);
  }

  pause() {
    if (this.mode === "stopped" || this.paused) return;
    this.pausedSong = this.songTime();
    this.paused = true;
    this.music?.stop();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (!this.enterAudio(this.pausedSong)) this.enterWall(this.pausedSong);
  }

  /** Call every frame. */
  update() {
    if (this.mode === "stopped" || this.paused) return;
    const ctx = this.sfx.context;
    if (this.mode === "wall" && ctx?.state === "running") this.enterAudio(this.songTime());
    if (this.mode === "audio") this.measure(false);
    this.music?.pump();
  }

  /** Song seconds as heard at performance time `perfMs`. */
  songTime(perfMs = performance.now()): number {
    if (this.mode === "stopped") return 0;
    if (this.paused) return this.pausedSong;
    if (this.mode === "audio") return perfMs / 1000 + this.off - this.base;
    return perfMs / 1000 - this.base;
  }

  beat(perfMs?: number) {
    return this.songTime(perfMs) / BEAT;
  }

  private enterAudio(song: number): boolean {
    const ctx = this.sfx.context;
    if (!ctx || ctx.state !== "running") return false;
    this.measure(true);
    if (!this.music) this.music = new Music(ctx, this.sfx.output);
    // Restart a hair in the future: the song steps back by the output latency at most.
    const at = ctx.currentTime + START_MARGIN;
    this.base = at - song;
    this.mode = "audio";
    this.music.play(song, at);
    return true;
  }

  private enterWall(song: number) {
    this.music?.stop();
    this.base = performance.now() / 1000 - song;
    this.mode = "wall";
  }

  private measure(snap: boolean) {
    const ctx = this.sfx.context;
    if (!ctx) return;
    let audible: number, perf: number;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime && ts.performanceTime) {
      audible = ts.contextTime;
      perf = ts.performanceTime / 1000;
    } else {
      audible = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
      perf = performance.now() / 1000;
    }
    const o = audible - perf;
    if (snap || !this.offOk || Math.abs(o - this.off) > 0.05) {
      this.off = o;
      this.offOk = true;
    } else {
      this.off += (o - this.off) * 0.05;
    }
  }
}
