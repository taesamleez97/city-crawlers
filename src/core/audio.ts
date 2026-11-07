// Procedural WebAudio sound design: no sample files to download, tiny CPU cost.
// The context unlocks on the first remote key press (a trusted user gesture).

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private wind?: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private muted = false;

  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  suspend() {
    void this.ctx?.suspend();
  }

  resume() {
    if (this.ctx && !this.muted) void this.ctx.resume();
  }

  private get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, q = 1.2, at = 0) {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.0);
    src.stop(t + dur + 0.02);
  }

  thwip() {
    if (!this.ready) return;
    this.burst(0.12, 0.7, "bandpass", 4200, 900, 2.5);
    this.tone(1400, 0.06, "triangle", 0.18, 0, 600);
  }

  attach() {
    if (!this.ready) return;
    this.tone(180, 0.09, "sine", 0.35, 0, 90);
    this.burst(0.05, 0.25, "lowpass", 1800, 400);
  }

  release(perfect: boolean) {
    if (!this.ready) return;
    this.burst(0.28, 0.35, "bandpass", 700, 2400, 0.8);
    if (perfect) {
      this.tone(880, 0.09, "square", 0.08);
      this.tone(1320, 0.14, "square", 0.08, 0.07);
    }
  }

  fizzle() {
    if (!this.ready) return;
    this.burst(0.18, 0.3, "highpass", 3000, 1200, 0.7);
    this.tone(300, 0.12, "sawtooth", 0.06, 0, 160);
  }

  coin(combo: number) {
    if (!this.ready) return;
    const base = 988 * Math.pow(2, Math.min(combo, 8) / 24);
    this.tone(base, 0.06, "square", 0.09);
    this.tone(base * 1.335, 0.16, "square", 0.09, 0.055);
  }

  hoop(combo: number) {
    if (!this.ready) return;
    const shift = Math.pow(2, Math.min(combo, 10) / 12);
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f * shift, 0.16, "triangle", 0.2, i * 0.05));
    this.burst(0.35, 0.18, "highpass", 6000, 3000, 0.6);
  }

  crash() {
    if (!this.ready) return;
    this.tone(110, 0.35, "sine", 0.7, 0, 38);
    this.burst(0.4, 0.6, "lowpass", 2400, 150, 0.7);
  }

  bonk() {
    if (!this.ready) return;
    this.tone(160, 0.18, "sine", 0.45, 0, 70);
    this.burst(0.15, 0.25, "lowpass", 1200, 200);
  }

  splash() {
    if (!this.ready) return;
    this.burst(0.7, 0.6, "lowpass", 3500, 300, 0.5);
    this.tone(300, 0.3, "sine", 0.2, 0.05, 120);
  }

  ui(kind: "move" | "select" | "back") {
    if (!this.ready) return;
    if (kind === "move") this.tone(660, 0.05, "triangle", 0.12);
    else if (kind === "select") {
      this.tone(784, 0.06, "triangle", 0.16);
      this.tone(1175, 0.1, "triangle", 0.16, 0.05);
    } else this.tone(440, 0.08, "triangle", 0.14, 0, 330);
  }

  fanfare() {
    if (!this.ready) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.25, "triangle", 0.22, i * 0.09));
    [1047, 1568].forEach((f, i) => this.tone(f, 0.5, "square", 0.06, 0.5 + i * 0.12));
  }

  countdown(go: boolean) {
    if (!this.ready) return;
    this.tone(go ? 1047 : 523, go ? 0.35 : 0.15, "square", 0.12);
  }

  /** Continuous wind bed; intensity 0..1 follows speed. */
  setWind(intensity: number) {
    if (!this.ready) return;
    const c = this.ctx!;
    if (!this.wind) {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.6;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      this.wind = { src, filter, gain };
    }
    const t = c.currentTime;
    this.wind.filter.frequency.setTargetAtTime(250 + intensity * 1900, t, 0.15);
    this.wind.gain.gain.setTargetAtTime(intensity * intensity * 0.32, t, 0.2);
  }
}
