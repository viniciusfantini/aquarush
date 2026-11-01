// Áudio procedural (Web Audio) de um motor de popa 4 TEMPOS, 4 cilindros em linha (~60 hp),
// sem samples: tudo derivado do RPM real e da carga da simulação.
//
// Camadas:
//  • Bloco do motor: forma de onda periódica no ciclo completo de 4 tempos (2 voltas = freq do comando,
//    RPM/120). Ordens de queima (múltiplos de 4 nesse ciclo = RPM/30 Hz) dominam, com meias-ordens fracas
//    (desbalanço entre cilindros) → o "ronronar" liso típico de 4T. Saturação suave + filtro que abre com a carga.
//  • Escape pelo cubo da hélice: ruído grave modulado pelos pulsos de queima (borbulhar abafado na água;
//    fica mais seco quando a hélice sai da água).
//  • Comando de válvulas: "tique" agudo discreto, audível em lenta (característico dos 4T).
//  • Engrenagens da rabeta: zumbido fino proporcional à rotação, só engrenado e com carga.
//  • Admissão: chiado de ar quando acelera forte.
//  • Esguicho de refrigeração: fio d'água constante com o motor ligado.
//  • Água (velocidade), cavitação (chiado áspero) e "clunk" das trocas de marcha.

import engineWorkletUrl from "./engineWorklet.js?url";

const makeNoise = (ctx: AudioContext): AudioBuffer => {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
};

/** Onda periódica do ciclo de 4 tempos de um 4 cilindros (fundamental = frequência do comando). */
const fourStrokeWave = (ctx: AudioContext): PeriodicWave => {
  const N = 48;
  const real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 1; n <= N; n++) {
    let a: number;
    if (n % 4 === 0) a = 1 / Math.pow(n / 4, 1.05);          // ordens de queima
    else if (n % 2 === 0) a = 0.16 / Math.pow(n / 2, 0.9);     // 2ª ordem (forças secundárias do 4 em linha)
    else a = 0.07 / Math.pow(n, 0.6);                          // meias-ordens: pequeno desbalanço
    const ph = rnd() * Math.PI * 2;
    real[n] = a * Math.cos(ph);
    imag[n] = a * Math.sin(ph);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
};

/** Pulso de queima (para modular o escape): pico estreito por explosão. */
const pulseWave = (ctx: AudioContext): PeriodicWave => {
  const N = 16;
  const real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) real[n] = 1 / n ** 0.4;
  return ctx.createPeriodicWave(real, imag);
};

const softClip = (k: number): Float32Array<ArrayBuffer> => {
  const n = 1024, c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
};

export interface AudioState {
  rpm: number;
  throttle: number;       // carga 0..1
  speed: number;          // m/s
  boil: number;           // cavitação/ventilação 0..1
  inGear: boolean;
  propInWater: boolean;
  cockpit: boolean;       // câmera no cockpit (casco entre o ouvinte e o motor)
  engine: "off" | "cranking" | "running";
  revLimiter?: boolean;   // limitador cortando a ignição
}

export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  // bloco
  private block!: OscillatorNode;
  private blockLP!: BiquadFilterNode;
  private blockGain!: GainNode;
  private cowlRes!: BiquadFilterNode;
  // escape
  private exhPulse!: OscillatorNode;
  private exhBP!: BiquadFilterNode;
  private exhGain!: GainNode;
  // válvulas
  private valvePulse!: OscillatorNode;
  private valveGain!: GainNode;
  // rabeta
  private gearOsc!: OscillatorNode;
  private gearGain!: GainNode;
  // admissão
  private intakeGain!: GainNode;
  private intakeBP!: BiquadFilterNode;
  // água, esguicho, cavitação
  private waterGain!: GainNode;
  private waterFilter!: BiquadFilterNode;
  private telltaleGain!: GainNode;
  private cavGain!: GainNode;
  private cavLfo!: OscillatorNode;
  private noise!: AudioBuffer;
  // motor por síntese física (AudioWorklet); osciladores antigos ficam como reserva
  private worklet: AudioWorkletNode | null = null;
  private workletGain!: GainNode;
  private starterGain!: GainNode;
  private starterLfo!: OscillatorNode;
  muted = false;

  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.noise = makeNoise(ctx);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(comp).connect(ctx.destination);
    const noiseSrc = () => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); return s; };

    // ---- bloco do motor ----
    this.block = ctx.createOscillator();
    this.block.setPeriodicWave(fourStrokeWave(ctx));
    this.block.frequency.value = 750 / 120;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2.2);
    shaper.oversample = "2x";
    const pre = ctx.createGain(); pre.gain.value = 0.9;
    this.blockLP = ctx.createBiquadFilter(); this.blockLP.type = "lowpass"; this.blockLP.Q.value = 0.8;
    this.cowlRes = ctx.createBiquadFilter(); this.cowlRes.type = "peaking"; this.cowlRes.frequency.value = 650; this.cowlRes.Q.value = 1.4; this.cowlRes.gain.value = 5;
    this.blockGain = ctx.createGain(); this.blockGain.gain.value = 0;
    this.block.connect(pre).connect(shaper).connect(this.blockLP).connect(this.cowlRes).connect(this.blockGain).connect(this.master);
    this.block.start();

    // ---- escape pelo cubo (borbulhar) ----
    this.exhPulse = ctx.createOscillator();
    this.exhPulse.setPeriodicWave(pulseWave(ctx));
    const exhAM = ctx.createGain(); exhAM.gain.value = 0;
    const depth = ctx.createGain(); depth.gain.value = 0.6;
    this.exhPulse.connect(depth).connect(exhAM.gain);
    this.exhBP = ctx.createBiquadFilter(); this.exhBP.type = "bandpass"; this.exhBP.Q.value = 0.9;
    const exhLP = ctx.createBiquadFilter(); exhLP.type = "lowpass"; exhLP.frequency.value = 520;
    this.exhGain = ctx.createGain(); this.exhGain.gain.value = 0;
    noiseSrc().connect(this.exhBP).connect(exhAM).connect(exhLP).connect(this.exhGain).connect(this.master);
    this.exhPulse.start();

    // ---- tique de válvulas ----
    this.valvePulse = ctx.createOscillator();
    this.valvePulse.setPeriodicWave(pulseWave(ctx));
    const valveAM = ctx.createGain(); valveAM.gain.value = 0;
    const vDepth = ctx.createGain(); vDepth.gain.value = 0.8;
    this.valvePulse.connect(vDepth).connect(valveAM.gain);
    const valveHP = ctx.createBiquadFilter(); valveHP.type = "bandpass"; valveHP.frequency.value = 4200; valveHP.Q.value = 3;
    this.valveGain = ctx.createGain(); this.valveGain.gain.value = 0;
    noiseSrc().connect(valveHP).connect(valveAM).connect(this.valveGain).connect(this.master);
    this.valvePulse.start();

    // ---- zumbido de engrenagens da rabeta ----
    this.gearOsc = ctx.createOscillator(); this.gearOsc.type = "triangle";
    this.gearGain = ctx.createGain(); this.gearGain.gain.value = 0;
    this.gearOsc.connect(this.gearGain).connect(this.master);
    this.gearOsc.start();

    // ---- admissão ----
    this.intakeBP = ctx.createBiquadFilter(); this.intakeBP.type = "bandpass"; this.intakeBP.Q.value = 1.2; this.intakeBP.frequency.value = 1200;
    this.intakeGain = ctx.createGain(); this.intakeGain.gain.value = 0;
    noiseSrc().connect(this.intakeBP).connect(this.intakeGain).connect(this.master);

    // ---- água ----
    this.waterFilter = ctx.createBiquadFilter(); this.waterFilter.type = "bandpass"; this.waterFilter.Q.value = 0.6; this.waterFilter.frequency.value = 700;
    this.waterGain = ctx.createGain(); this.waterGain.gain.value = 0;
    noiseSrc().connect(this.waterFilter).connect(this.waterGain).connect(this.master);

    // ---- esguicho de refrigeração (fio d'água) ----
    const ttBP = ctx.createBiquadFilter(); ttBP.type = "bandpass"; ttBP.frequency.value = 2600; ttBP.Q.value = 1.8;
    this.telltaleGain = ctx.createGain(); this.telltaleGain.gain.value = 0;
    noiseSrc().connect(ttBP).connect(this.telltaleGain).connect(this.master);

    // ---- cavitação ----
    const cavHP = ctx.createBiquadFilter(); cavHP.type = "highpass"; cavHP.frequency.value = 1800;
    const cavAM = ctx.createGain(); cavAM.gain.value = 0.5;
    this.cavLfo = ctx.createOscillator(); this.cavLfo.type = "square"; this.cavLfo.frequency.value = 37;
    const cavDepth = ctx.createGain(); cavDepth.gain.value = 0.5;
    this.cavLfo.connect(cavDepth).connect(cavAM.gain);
    this.cavLfo.start();
    this.cavGain = ctx.createGain(); this.cavGain.gain.value = 0;
    noiseSrc().connect(cavHP).connect(cavAM).connect(this.cavGain).connect(this.master);

    // ---- motor de arranque (partida): zumbido elétrico + engrenagem, pulsando nas compressões ----
    const st1 = ctx.createOscillator(); st1.type = "sawtooth"; st1.frequency.value = 1150;
    const st2 = ctx.createOscillator(); st2.type = "square"; st2.frequency.value = 93;
    const stBP = ctx.createBiquadFilter(); stBP.type = "bandpass"; stBP.frequency.value = 1100; stBP.Q.value = 2;
    const stAM = ctx.createGain(); stAM.gain.value = 0.6;
    this.starterLfo = ctx.createOscillator(); this.starterLfo.type = "sine"; this.starterLfo.frequency.value = 8;
    const stDepth = ctx.createGain(); stDepth.gain.value = 0.4;
    this.starterLfo.connect(stDepth).connect(stAM.gain);
    this.starterGain = ctx.createGain(); this.starterGain.gain.value = 0;
    st1.connect(stBP); st2.connect(stBP);
    stBP.connect(stAM).connect(this.starterGain).connect(this.master);
    st1.start(); st2.start(); this.starterLfo.start();

    // ---- motor por síntese física (explosões → tubos de escape → cubo da hélice) ----
    this.workletGain = ctx.createGain(); this.workletGain.gain.value = 0;
    const cowl = ctx.createBiquadFilter(); cowl.type = "peaking"; cowl.frequency.value = 700; cowl.Q.value = 1.1; cowl.gain.value = 3;
    this.workletGain.connect(cowl).connect(this.master);
    ctx.audioWorklet.addModule(engineWorkletUrl).then(() => {
      const node = new AudioWorkletNode(ctx, "aqua-engine", { numberOfInputs: 0, outputChannelCount: [1] });
      node.connect(this.workletGain);
      this.worklet = node;
      console.info("[AquaRush] áudio do motor: síntese física (AudioWorklet)");
    }).catch((e) => console.warn("[AquaRush] AudioWorklet indisponível, usando síntese simples", e));
  }

  update(st: AudioState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = this.muted ? 0 : 1;
    const rpm = Math.max(st.rpm, 300);
    const load = Math.min(Math.max(st.throttle, 0), 1);
    const r = (rpm - 750) / (5800 - 750); // 0 lenta .. 1 rotação máxima
    const cam = rpm / 120;     // ciclo completo de 4 tempos
    const firing = rpm / 30;   // 4 cilindros, 4 tempos: 2 explosões por volta
    const dist = st.cockpit ? 0.8 : 1;
    const running = st.engine === "running";
    const useW = this.worklet !== null;
    if (this.worklet) {
      // limitador: a ignição corta em rajadas ("bap-bap-bap")
      const cut = st.revLimiter && Math.floor(t * 16) % 2 === 1;
      this.worklet.port.postMessage({ rpm: st.rpm, load: st.revLimiter ? 0.3 : load, combustion: running && !cut ? 1 : 0, wet: st.propInWater ? 1 : 0, volume: 1 });
      this.workletGain.gain.setTargetAtTime(m * dist * 0.55, t, 0.05);
    }
    const legacy = useW || !running ? 0 : 1; // osciladores antigos só sem worklet
    this.starterGain.gain.setTargetAtTime(m * (st.engine === "cranking" ? 0.09 : 0), t, 0.03);
    this.starterLfo.frequency.setTargetAtTime(Math.max(st.rpm, 60) / 30, t, 0.05);

    // bloco: lenta suave e baixa; com carga o filtro abre e o som "encorpa"
    this.block.frequency.setTargetAtTime(cam, t, 0.04);
    this.blockLP.frequency.setTargetAtTime(220 + 900 * r + 1600 * load * (0.4 + 0.6 * r), t, 0.06);
    this.cowlRes.frequency.setTargetAtTime(520 + 500 * r, t, 0.1);
    this.blockGain.gain.setTargetAtTime(legacy * m * dist * (0.05 + 0.1 * r + 0.07 * load), t, 0.08);

    // escape no cubo: borbulha em lenta; abafa com a hélice na água
    this.exhPulse.frequency.setTargetAtTime(firing, t, 0.04);
    this.exhBP.frequency.setTargetAtTime(90 + 0.05 * rpm, t, 0.08);
    const wet = st.propInWater ? 1 : 1.8;
    this.exhGain.gain.setTargetAtTime(legacy * m * dist * (0.13 + 0.12 * load) * wet, t, 0.08);

    // válvulas: tique por volta do comando (cada cilindro), mais evidente em lenta
    this.valvePulse.frequency.setTargetAtTime(cam * 4, t, 0.04);
    this.valveGain.gain.setTargetAtTime(legacy * m * dist * 0.035 * (1 - 0.7 * r), t, 0.1);

    // rabeta: dentes do pinhão (~ 13) × rotação do virabrequim
    this.gearOsc.frequency.setTargetAtTime((rpm / 60) * 13, t, 0.05);
    this.gearGain.gain.setTargetAtTime(m * (st.inGear && running ? 0.004 + 0.01 * load * r : 0), t, 0.1);

    // admissão (ar entrando no capô quando acelera forte)
    this.intakeBP.frequency.setTargetAtTime(900 + 1400 * r, t, 0.1);
    this.intakeGain.gain.setTargetAtTime(legacy * m * dist * 0.03 * load * r, t, 0.08);

    // água, esguicho, cavitação
    this.waterGain.gain.setTargetAtTime(m * Math.min(st.speed / 22, 1) * 0.11, t, 0.15);
    this.waterFilter.frequency.setTargetAtTime(400 + st.speed * 40, t, 0.2);
    this.telltaleGain.gain.setTargetAtTime(running ? m * (0.004 + 0.009 * r) * (st.cockpit ? 0.5 : 1) : 0, t, 0.2);
    this.cavGain.gain.setTargetAtTime(m * Math.min(st.boil, 1) * 0.14 * (0.3 + load), t, 0.05);
    this.cavLfo.frequency.setTargetAtTime(20 + rpm / 120, t, 0.1);
  }

  /** "Clunk" metálico do câmbio da rabeta ao engrenar (F/R) ou soltar (N). */
  clunk(engage: boolean): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(engage ? 95 : 140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(engage ? 0.35 : 0.15, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.2);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(engage ? 0.18 : 0.08, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t, Math.random()); n.stop(t + 0.06);
  }
}
