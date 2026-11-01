// AudioWorklet: síntese "física" de um motor de popa 4 tempos, 4 cilindros em linha.
// Em vez de osciladores fixos (som eletrônico), cada EXPLOSÃO de cada cilindro gera um pulso de
// pressão com variação de ciclo a ciclo; os pulsos passam por um modelo de escape (dois tubos
// ressonantes por guia de onda), por um abafador (saída pelo cubo da hélice, debaixo d'água,
// com borbulhar) e pelo escape de marcha lenta (acima d'água). Somam-se o "tique" das válvulas
// e o ar da admissão. Parâmetros chegam do jogo via port.postMessage:
//   { rpm, load, combustion (0/1), wet (hélice na água 0/1), volume }
// Arquivo JS puro (sem imports): o AudioWorklet roda em um escopo separado.

class SVF {
  // filtro de variável de estado (Chamberlin) — passa-baixa/banda/alta
  constructor() { this.low = 0; this.band = 0; }
  run(x, f, q) {
    this.low += f * this.band;
    const high = x - this.low - q * this.band;
    this.band += f * high;
    return high;
  }
}

class Delay {
  constructor(n) { this.buf = new Float32Array(n); this.i = 0; }
  read() { return this.buf[this.i]; }
  write(x) { this.buf[this.i] = x; this.i = (this.i + 1) % this.buf.length; }
}

const FIRE = [0, 180, 360, 540];          // ordem de queima 1-3-4-2 espaçada 180° no ciclo de 720°
const FIRE_ERR = [0, 1.6, -1.1, 0.7];      // pequenos erros de ponto (graus) → não soa "perfeito"
const CYL_GAIN = [1.0, 0.93, 1.06, 0.97];  // diferenças entre cilindros

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.target = { rpm: 750, load: 0, combustion: 1, wet: 1, volume: 0 };
    this.rpm = 750; this.load = 0; this.comb = 1; this.wet = 1; this.vol = 0;
    this.theta = 0;
    this.seed = 1234567;
    this.pulseT = [1e9, 1e9, 1e9, 1e9];
    this.pulseA = [0, 0, 0, 0];
    this.valveT = 1e9; this.valveA = 0;
    this.intakeA = 0;
    // escape: coletor curto + tubo/câmara longa (comprimentos em metros, som a ~500 m/s nos gases quentes)
    this.d1 = new Delay(Math.max(8, Math.round(this.sr * 2 * 0.45 / 520)));
    this.d2 = new Delay(Math.max(8, Math.round(this.sr * 2 * 1.15 / 480)));
    this.lp1 = 0; this.lp2 = 0;
    this.hub = new SVF(); this.relief = new SVF(); this.valveF = new SVF(); this.intakeF = new SVF();
    this.hubLP2 = 0;
    this.bub = 0; this.bubT = 0;
    this.dcX = 0; this.dcY = 0;
    this.port.onmessage = (e) => Object.assign(this.target, e.data);
  }

  rnd() { // xorshift → [-1, 1]
    let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0;
    return (this.seed / 4294967295) * 2 - 1;
  }
  gauss() { return (this.rnd() + this.rnd() + this.rnd()) / 1.7; }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const sr = this.sr, T = this.target;
    const kS = 1 - Math.exp(-1 / (sr * 0.03));   // suavização dos parâmetros (~30 ms)
    for (let n = 0; n < out.length; n++) {
      this.rpm += (T.rpm - this.rpm) * kS;
      this.load += (T.load - this.load) * kS;
      this.comb += (T.combustion - this.comb) * kS;
      this.wet += (T.wet - this.wet) * kS;
      this.vol += (T.volume - this.vol) * kS;
      const rpm = Math.max(this.rpm, 0);

      // ---- ciclo de 4 tempos (720°) e disparo de cada cilindro ----
      const prev = this.theta;
      this.theta += (rpm / 60) * 360 / sr;
      let wrapped = false;
      if (this.theta >= 720) { this.theta -= 720; wrapped = true; }
      for (let c = 0; c < 4; c++) {
        const a = FIRE[c] + FIRE_ERR[c] + this.gauss() * 0.25;
        const crossed = wrapped ? (prev < a || this.theta >= a) : (prev < a && this.theta >= a);
        if (crossed && rpm > 30) {
          // explosão (ou só compressão, sem combustão: partida/desligando)
          const burn = this.comb * (0.32 + 0.68 * this.load) * (1 + 0.035 * this.gauss());
          const compress = 0.09 * Math.min(rpm / 300, 1);
          this.pulseA[c] = (burn + compress) * CYL_GAIN[c];
          this.pulseT[c] = 0;
          // válvulas: abertura logo depois (tique mecânico)
          this.valveT = -Math.round(sr * (0.25 / Math.max(rpm, 200)) * 60); this.valveA = 0.5 + 0.5 * this.rnd() * 0.3;
          this.intakeA = this.load;
        }
      }

      // ---- pulsos de pressão no escape ----
      const lowRev = 1 - Math.min(Math.max((rpm - 700) / 2500, 0), 1); // 1 em lenta → 0 acima de ~3200 rpm
      const tau = sr * (0.0026 + 0.0055 * lowRev - 0.0008 * this.load);
      const att = sr * (0.0003 + 0.0016 * lowRev);
      const grit = 0.45 * (1 - 0.75 * lowRev); // componente de ruído do pulso (aspereza)
      let p = 0;
      for (let c = 0; c < 4; c++) {
        const t = this.pulseT[c];
        if (t < tau * 8) {
          const env = Math.exp(-t / tau) * (1 - Math.exp(-t / att));
          p += this.pulseA[c] * env * (1 - grit + grit * this.rnd());
          this.pulseT[c] = t + 1;
        }
      }

      // ---- tubos de escape (guia de onda com reflexões) ----
      const r1 = this.d1.read();
      this.lp1 += (r1 - this.lp1) * 0.45;
      const y1 = p - 0.55 * this.lp1;
      this.d1.write(y1);
      const r2 = this.d2.read();
      this.lp2 += (r2 - this.lp2) * 0.35;
      const y2 = y1 + 0.42 * this.lp2;
      this.d2.write(y2);

      // ---- saída pelo cubo da hélice (abafada pela água) + borbulhar ----
      this.bubT -= 1;
      if (this.bubT <= 0) { this.bubT = sr * (0.03 + 0.05 * Math.random()); this.bub = 0.6 + 0.8 * Math.random(); }
      const hubCut = this.wet > 0.5 ? 0.008 + 0.006 * (1 - lowRev) + 0.01 * this.load : 0.05;  // freq. normalizada do abafador
      this.hub.run(y2, hubCut, 0.9);
      this.hubLP2 += (this.hub.low - this.hubLP2) * 0.25;
      const hubOut = this.hubLP2 * (this.wet > 0.5 ? (0.75 + 0.35 * this.bub) : 1.4);

      // ---- escape de marcha lenta (acima d'água): "putt-putt" mais aberto, some com carga ----
      this.relief.run(y2, 0.032 + 0.03 * (1 - lowRev), 1.3);
      const reliefOut = this.relief.low * (0.3 * (1 - this.load) + 0.05);

      // ---- válvulas (tique metálico) ----
      let valve = 0;
      if (this.valveT >= 0 && this.valveT < sr * 0.0012) {
        valve = this.valveA * Math.exp(-this.valveT / (sr * 0.00025)) * this.rnd();
      }
      this.valveT += 1;
      this.valveF.run(valve, 0.55, 0.35);
      const valveOut = this.valveF.band * (0.11 * lowRev + 0.03) * (0.4 + 0.6 * this.comb);

      // ---- admissão (ar entrando no capô) ----
      this.intakeA *= 0.9995;
      this.intakeF.run(this.rnd(), 0.18 + 0.12 * Math.min(rpm / 6000, 1), 0.7);
      const intakeOut = this.intakeF.band * this.intakeA * 0.05 * Math.min(rpm / 3000, 1.5);

      // ---- mistura, bloqueio de DC, saturação suave ----
      let y = (hubOut * (2.2 + 1.2 * lowRev) + reliefOut * 1.6) * (1 - 0.45 * lowRev * (1 - this.load)) + valveOut + intakeOut;
      const dc = y - this.dcX + 0.995 * this.dcY;
      this.dcX = y; this.dcY = dc;
      y = Math.tanh(dc * 1.6) * this.vol;
      out[n] = y;
    }
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    return true;
  }
}

registerProcessor("aqua-engine", EngineProcessor);
