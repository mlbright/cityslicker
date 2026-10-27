/**
 * Gentle generated sound, off by default: ambience that follows the City (birds when small, a soft
 * traffic hum as it grows, waves by the sea) and tiny effects. Everything is synthesised; no files.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: GainNode | null = null;
  private waves: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = false;
  private nextBird = 0;
  private lastPlop = 0;
  private plopsThisSecond = 0;

  constructor(private readonly coastal: boolean) {}

  get on(): boolean {
    return this.enabled;
  }

  /** Must be called from a user gesture the first time, so the browser allows audio. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on && !this.ctx) this.init();
    if (!this.ctx || !this.master) return;
    if (on) void this.ctx.resume();
    this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.2);
  }

  private init(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // Two seconds of brown noise, reused by every noisy sound.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    this.noise = buffer;

    // Traffic hum: low brown noise.
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 260;
    this.loopNoise().connect(humFilter).connect(this.hum).connect(this.master);

    // Waves: noise swelling slowly in and out.
    this.waves = ctx.createGain();
    this.waves.gain.value = 0;
    const waveFilter = ctx.createBiquadFilter();
    waveFilter.type = 'lowpass';
    waveFilter.frequency.value = 900;
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(swell.gain);
    lfo.start();
    this.loopNoise().connect(waveFilter).connect(swell).connect(this.waves).connect(this.master);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    src.start(0, Math.random() * 2);
    return src;
  }

  /** Ambience follows the City: `size` is 0..1 (population relative to Ambition), `traffic` 0..1. */
  update(now: number, size: number, traffic: number, night: boolean): void {
    if (!this.enabled || !this.ctx || !this.hum || !this.waves) return;
    const t = this.ctx.currentTime;
    this.hum.gain.setTargetAtTime(0.05 + 0.35 * Math.min(1, traffic), t, 1.5);
    this.waves.gain.setTargetAtTime(this.coastal ? 0.25 : 0, t, 1.5);
    if (now > this.nextBird) {
      const birdy = Math.max(0.05, 1 - size) * (night ? 0.15 : 1);
      if (Math.random() < birdy) this.bird();
      this.nextBird = now + 0.8 + Math.random() * 2.5;
    }
  }

  private envelope(peak: number, attack: number, decay: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private bird(): void {
    const ctx = this.ctx!;
    const chirps = 2 + Math.floor(Math.random() * 3);
    const base = 2600 + Math.random() * 1400;
    for (let c = 0; c < chirps; c++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const t = ctx.currentTime + c * 0.11;
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.05);
      osc.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  /** A soft plop when a Building pops up; taller Buildings plop lower. */
  plop(density: number): void {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPlop > 1) this.plopsThisSecond = 0;
    if (this.plopsThisSecond++ > 5) return;
    this.lastPlop = now;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const f = [0, 720, 520, 380][density] * (0.9 + Math.random() * 0.2);
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(f * 0.45, now + 0.13);
    osc.connect(this.envelope(0.12, 0.008, 0.14));
    osc.start(now);
    osc.stop(now + 0.18);
  }

  /** A whoosh when the Time lapse starts rewinding. */
  whoosh(): void {
    if (!this.enabled || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    const t = this.ctx.currentTime;
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.45);
    src.connect(bp).connect(this.envelope(0.35, 0.05, 0.45));
    src.start(t);
    src.stop(t + 0.55);
  }

  /** A camera shutter for Snapshots. */
  shutter(): void {
    if (!this.enabled || !this.ctx) return;
    for (const delay of [0, 0.07]) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      const t = this.ctx.currentTime + delay;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      src.connect(hp).connect(g).connect(this.master!);
      src.start(t);
      src.stop(t + 0.05);
    }
  }

  /** A little arpeggio for a Milestone. */
  chime(): void {
    if (!this.enabled || !this.ctx) return;
    [523.25, 659.25, 783.99].forEach((f, k) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const t = this.ctx!.currentTime + k * 0.09;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  }
}
