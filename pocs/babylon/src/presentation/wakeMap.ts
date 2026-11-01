// Water Interaction → mapa de esteira (top-down) ao redor da lancha.
// Em vez de uma faixa desenhada POR CIMA da água, a esteira é pintada numa textura que o
// shader da água usa para (1) deslocar a superfície (cristas/cavados da onda de Kelvin),
// (2) perturbar a normal (reflexos distorcidos) e (3) gerar espuma (hélice, casco, cavitação).
//
// Canais (composição aditiva "lighter"):
//   R = espuma / água aerada (0..1)
//   G = altura positiva (crista)   B = altura negativa (cavado)   altura = (G − B) · HEIGHT_SCALE
//
// Tudo deriva do estado real da simulação (velocidade na água, acelerador, cavitação, ventilação).

import { type Scene, DynamicTexture, Texture } from "@babylonjs/core";
import type { Speedboat } from "../sim/boat.ts";
import { v3, clamp, smoothstep } from "../sim/math.ts";

export const WAKE_HEIGHT_SCALE = 0.6; // m para canal = 1.0
const MAX_AGE = 10;   // s
const EMIT_DT = 0.05; // s

interface Sample {
  bx: number; bz: number;   // proa
  sx: number; sz: number;   // popa (hélice)
  rx: number; rz: number;   // vetor "direita" do casco no plano
  v: number;                // velocidade na água (m/s)
  thr: number;              // acelerador efetivo
  boil: number;             // cavitação/ventilação 0..1
  age: number;
}

/** Amplitude (m) da onda gerada pelo casco em função da velocidade (pico no "hump"). */
const waveAmp = (v: number): number =>
  0.1 * smoothstep(0.4, 3, v) + 0.24 * Math.exp(-(((v - 5) / 3) ** 2)) + 0.1 * smoothstep(8, 16, v);

/** Semiângulo do V: 19,5° (Kelvin) em deslocamento, mais fechado em planeio (alto Froude). */
const kelvinTan = (v: number): number => {
  const fn = v / Math.sqrt(9.81 * 6);
  const ang = 19.47 - 8.5 * smoothstep(0.55, 1.6, fn);
  return Math.tan((ang * Math.PI) / 180);
};

export class WakeMap {
  readonly texture: DynamicTexture;
  readonly size: number;        // px
  readonly worldSize: number;   // m cobertos pela textura
  originX = 0;
  originZ = 0;
  private readonly ctx: CanvasRenderingContext2D;
  private samples: Sample[] = [];
  private emitTimer = 0;
  private readonly maxSamples: number;

  constructor(scene: Scene, opts: { size: number; worldSize: number }) {
    this.size = opts.size;
    this.worldSize = opts.worldSize;
    this.maxSamples = Math.ceil(MAX_AGE / EMIT_DT) + 2;
    this.texture = new DynamicTexture("wakeMap", { width: this.size, height: this.size }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
    this.texture.wrapU = this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.ctx = this.texture.getContext() as CanvasRenderingContext2D;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.size, this.size);
    this.texture.update(false); // textura pronta antes do 1º quadro (senão o material da água não fica "ready")
  }

  private snap(boat: Speedboat): Sample {
    const T = boat.telemetry;
    const b = boat.toWorld(v3(0, 0, 2.6));
    const s = boat.toWorld(v3(0, 0, -3.0));
    const r = boat.right;
    const rl = Math.hypot(r.x, r.z) || 1;
    return {
      bx: b.x, bz: b.z, sx: s.x, sz: s.z, rx: r.x / rl, rz: r.z / rl,
      v: Math.max(0, Math.abs(T.waterSpeed)),
      thr: T.gear === "N" ? 0 : T.throttle,
      boil: clamp(Math.max(T.cavitation, (1 - T.ventilation) * (T.throttle > 0.2 ? 1 : 0)), 0, 1),
      age: 0,
    };
  }

  update(dt: number, boat: Speedboat): void {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[0].age > MAX_AGE) this.samples.shift();
    this.emitTimer -= dt;
    const live = this.snap(boat);
    const moving = live.v > 0.3 || live.thr > 0.05;
    if (this.emitTimer <= 0 && moving) {
      this.emitTimer = EMIT_DT;
      this.samples.push(live);
      if (this.samples.length > this.maxSamples) this.samples.shift();
    }
    // origem encaixada no pixel (evita "nadar" a textura)
    const ppm = this.size / this.worldSize;
    this.originX = Math.round(boat.pos.x * ppm) / ppm;
    this.originZ = Math.round(boat.pos.z * ppm) / ppm;
    this.draw([...this.samples, { ...live, age: 0 }], live);
    this.texture.update(false);
  }

  private draw(pts: Sample[], live: Sample): void {
    const c = this.ctx, N = this.size, ppm = N / this.worldSize;
    const ox = this.originX, oz = this.originZ;
    const X = (x: number) => (x - ox) * ppm + N / 2;
    const Y = (z: number) => N / 2 - (z - oz) * ppm; // canvas cresce para baixo; +Z para cima
    c.globalCompositeOperation = "source-over";
    c.fillStyle = "#000";
    c.fillRect(0, 0, N, N);
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    c.lineJoin = "round";
    if (pts.length < 2) return;

    const CH = 8; // amostras por trecho de caminho (mesma cor/largura)
    const strokeChain = (
      pick: (s: Sample) => { x: number; z: number } | null,
      style: (s: Sample) => { r: number; g: number; b: number; w: number } | null,
    ) => {
      for (let i0 = 0; i0 < pts.length - 1; i0 += CH - 1) {
        const i1 = Math.min(i0 + CH - 1, pts.length - 1);
        const mid = pts[(i0 + i1) >> 1];
        const st = style(mid);
        if (!st || st.r + st.g + st.b < 0.004) continue;
        c.beginPath();
        let started = false;
        for (let i = i0; i <= i1; i++) {
          const p = pick(pts[i]);
          if (!p) continue;
          if (!started) { c.moveTo(X(p.x), Y(p.z)); started = true; } else c.lineTo(X(p.x), Y(p.z));
        }
        c.lineWidth = Math.max(1, st.w * ppm);
        c.strokeStyle = `rgb(${(clamp(st.r, 0, 1) * 255) | 0},${(clamp(st.g, 0, 1) * 255) | 0},${(clamp(st.b, 0, 1) * 255) | 0})`;
        c.stroke();
      }
    };

    const H = WAKE_HEIGHT_SCALE;
    // ---- braços do V de Kelvin: crista, cavado e crista secundária (para dentro) ----
    for (const side of [-1, 1]) {
      const arm = (inward: number) => (s: Sample) => {
        const half = 0.9 + kelvinTan(s.v) * s.v * s.age - inward * (1 + 0.35 * s.age);
        if (half < 0.4) return null;
        return { x: s.bx + s.rx * side * half, z: s.bz + s.rz * side * half };
      };
      const env = (s: Sample) => waveAmp(s.v) * Math.exp(-s.age / 5.5) * (1 - Math.exp(-s.age * 6 - 0.15));
      strokeChain(arm(0), (s) => ({ r: smoothstep(5, 14, s.v) * Math.exp(-s.age / 1.1) * 0.75, g: env(s) / H, b: 0, w: 1.0 + 0.22 * s.age }));
      strokeChain(arm(1.5), (s) => ({ r: 0, g: 0, b: (env(s) * 0.75) / H, w: 1.1 + 0.25 * s.age }));
      strokeChain(arm(3.0), (s) => ({ r: 0, g: (env(s) * 0.45) / H, b: 0, w: 1.2 + 0.3 * s.age }));
    }

    // ---- ondas transversais (dentro do V) em baixa velocidade: comprimento λ = 2πv²/g ----
    // aproximadas por leve ondulação de altura no centro da esteira
    strokeChain((s) => ({ x: s.sx, z: s.sz }), (s) => {
      const lam = (2 * Math.PI * s.v * s.v) / 9.81;
      const phase = Math.sin((2 * Math.PI * s.v * s.age) / Math.max(lam, 0.5));
      const a = waveAmp(s.v) * 0.35 * Math.exp(-s.age / 4) * (1 - smoothstep(6, 10, s.v));
      return { r: 0, g: phase > 0 ? (a * phase) / H : 0, b: phase < 0 ? (-a * phase) / H : 0, w: 2 + 0.9 * s.age };
    });

    // ---- água revolvida da hélice (espuma central que se abre e some) ----
    strokeChain((s) => ({ x: s.sx, z: s.sz }), (s) => {
      const f = (0.25 + 0.75 * s.thr) * smoothstep(0.3, 3, s.v + s.thr * 3) * Math.exp(-s.age / 4.5);
      return { r: f * 0.95, g: 0.02 * f, b: 0, w: 0.8 + 0.45 * s.age };
    });
    strokeChain((s) => ({ x: s.sx, z: s.sz }), (s) => {
      const f = smoothstep(0.5, 6, s.v) * Math.exp(-s.age / 7) * 0.35;
      return { r: f, g: 0, b: 0, w: 2.2 + 0.7 * s.age };
    });

    // ---- cavitação / ventilação: "fervura" branca e bolhas na popa ----
    for (const s of pts) {
      if (s.boil < 0.05) continue;
      const a = s.boil * Math.exp(-s.age / 2.2);
      if (a < 0.03) continue;
      const r = (0.7 + 1.1 * s.age + s.thr * 0.6) * ppm;
      const g = c.createRadialGradient(X(s.sx), Y(s.sz), 0, X(s.sx), Y(s.sz), r);
      g.addColorStop(0, `rgba(255,${(a * 60) | 0},0,${clamp(a, 0, 1)})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(X(s.sx), Y(s.sz), r, 0, Math.PI * 2);
      c.fill();
    }

    // ---- borda do casco: espuma/"bigode" na proa e ao longo do costado ----
    const hullFoam = smoothstep(1.5, 9, live.v) * 0.7;
    if (hullFoam > 0.02) {
      const fx = -live.rz, fz = live.rx; // frente no plano
      const outline: [number, number][] = [[0, 3.0], [0.75, 2.2], [1.12, 0.6], [1.12, -1.6], [1.0, -2.95]];
      c.lineWidth = Math.max(1, (0.35 + live.v * 0.03) * ppm);
      for (const side of [-1, 1]) {
        c.beginPath();
        outline.forEach(([lx, lz], i) => {
          const wx = live.bx - fx * 2.6 + fx * lz + live.rx * lx * side;
          const wz = live.bz - fz * 2.6 + fz * lz + live.rz * lx * side;
          if (i === 0) c.moveTo(X(wx), Y(wz)); else c.lineTo(X(wx), Y(wz));
        });
        c.strokeStyle = `rgb(${(hullFoam * 255) | 0},${(smoothstep(2, 7, live.v) * 0.12 / H * 255) | 0},0)`;
        c.stroke();
      }
    }
  }
}
