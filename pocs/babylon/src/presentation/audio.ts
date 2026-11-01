// Áudio procedural (Web Audio): motor ligado ao RPM real + ruído de água ligado à velocidade.
// Começa no primeiro gesto do usuário (exigência dos navegadores).

export class EngineAudio {
  private ctx: AudioContext | null = null;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private engGain!: GainNode;
  private filter!: BiquadFilterNode;
  private waterGain!: GainNode;
  private waterFilter!: BiquadFilterNode;
  muted = false;

  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 400;
    this.filter.Q.value = 2;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.05;
    this.osc1 = ctx.createOscillator(); this.osc1.type = "sawtooth";
    this.osc2 = ctx.createOscillator(); this.osc2.type = "square";
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    this.osc1.connect(this.filter);
    this.osc2.connect(g2).connect(this.filter);
    this.filter.connect(this.engGain).connect(master);
    this.osc1.start(); this.osc2.start();

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = "bandpass";
    this.waterFilter.frequency.value = 700;
    this.waterFilter.Q.value = 0.6;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    noise.connect(this.waterFilter).connect(this.waterGain).connect(master);
    noise.start();
  }

  update(rpm: number, throttle: number, speed: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = rpm / 20; // V6 4 tempos: 3 explosões por volta
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.filter.frequency.setTargetAtTime(250 + throttle * 1400 + rpm * 0.08, t, 0.08);
    const m = this.muted ? 0 : 1;
    this.engGain.gain.setTargetAtTime(m * (0.035 + throttle * 0.07), t, 0.1);
    this.waterGain.gain.setTargetAtTime(m * Math.min(speed / 22, 1) * 0.12, t, 0.15);
    this.waterFilter.frequency.setTargetAtTime(400 + speed * 40, t, 0.2);
  }
}
