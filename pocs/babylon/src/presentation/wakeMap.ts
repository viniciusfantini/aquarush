// Water Interaction → mapa de esteira (top-down) ao redor da lancha, desenhado a partir do
// MESMO histórico que a física usa (sim/wake.ts → WakeField). O shader da água usa a textura para
// (1) deslocar a superfície, (2) perturbar a normal (reflexos) e (3) gerar espuma.
//
// Canais (composição aditiva "lighter"):
//   R = espuma / água aerada (0..1)
//   G = altura positiva (crista)   B = altura negativa (cavado)   altura = (G − B) · HEIGHT_SCALE
//
// A DynamicTexture inverte o canvas no upload: +Z do mundo cresce para BAIXO no canvas.

import { type Scene, DynamicTexture, Texture } from "@babylonjs/core";
import { clamp, smoothstep } from "../sim/math.ts";
import {
  type WakeField, type WakeSample, WAKE_RIDGES, armEnvelope, armPoint, ridgeHalfWidth, waveAmp,
} from "../sim/wake.ts";

export const WAKE_HEIGHT_SCALE = 0.6; // m para canal = 1.0

export class WakeMap {
  readonly texture: DynamicTexture;
  readonly size: number;        // px
  readonly worldSize: number;   // m cobertos pela textura
  originX = 0;
  originZ = 0;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly field: WakeField;

  constructor(scene: Scene, field: WakeField, opts: { size: number; worldSize: number }) {
    this.field = field;
    this.size = opts.size;
    this.worldSize = opts.worldSize;
    this.texture = new DynamicTexture("wakeMap", { width: this.size, height: this.size }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
    this.texture.wrapU = this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.ctx = this.texture.getContext() as CanvasRenderingContext2D;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.size, this.size);
    this.texture.update(false); // pronta antes do 1º quadro (senão o material da água não fica "ready")
  }

  /** Redesenha o mapa centrado em (cx, cz); `live` = estado atual (liga o rastro à lancha). */
  update(cx: number, cz: number, live: WakeSample): void {
    const ppm = this.size / this.worldSize;
    this.originX = Math.round(cx * ppm) / ppm;
    this.originZ = Math.round(cz * ppm) / ppm;
    this.draw([...this.field.samples, live], live);
    this.texture.update(false);
  }

  private draw(pts: WakeSample[], live: WakeSample): void {
    const c = this.ctx, N = this.size, ppm = N / this.worldSize;
    const ox = this.originX, oz = this.originZ;
    const X = (x: number) => (x - ox) * ppm + N / 2;
    const Y = (z: number) => N / 2 + (z - oz) * ppm;
    c.globalCompositeOperation = "source-over";
    c.fillStyle = "#000";
    c.fillRect(0, 0, N, N);
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    c.lineJoin = "round";
    if (pts.length < 2) return;
    const half = this.worldSize / 2 + 10;
    const inView = (x: number, z: number) => Math.abs(x - ox) < half && Math.abs(z - oz) < half;

    const CH = 8;
    const strokeChain = (
      pick: (s: WakeSample) => { x: number; z: number } | null,
      style: (s: WakeSample) => { r: number; g: number; b: number; w: number } | null,
    ) => {
      for (let i0 = 0; i0 < pts.length - 1; i0 += CH - 1) {
        const i1 = Math.min(i0 + CH - 1, pts.length - 1);
        const mid = pts[(i0 + i1) >> 1];
        const st = style(mid);
        if (!st || st.r + st.g + st.b < 0.004) continue;
        c.beginPath();
        let started = false, any = false, prevAge = -1;
        for (let i = i0; i <= i1; i++) {
          const p = pick(pts[i]);
          if (!p) { started = false; continue; }
          if (inView(p.x, p.z)) any = true;
          // não liga amostras separadas por um intervalo (lancha parada)
          if (!started || Math.abs(pts[i].age - prevAge) > 0.6) { c.moveTo(X(p.x), Y(p.z)); started = true; }
          else c.lineTo(X(p.x), Y(p.z));
          prevAge = pts[i].age;
        }
        if (!any) continue;
        c.lineWidth = Math.max(1, st.w * ppm);
        c.strokeStyle = `rgb(${(clamp(st.r, 0, 1) * 255) | 0},${(clamp(st.g, 0, 1) * 255) | 0},${(clamp(st.b, 0, 1) * 255) | 0})`;
        c.stroke();
      }
    };

    const H = WAKE_HEIGHT_SCALE;
    // ---- braços do V de Kelvin (mesmo modelo da física) ----
    for (const side of [-1, 1]) {
      WAKE_RIDGES.forEach((r, k) => {
        strokeChain((s) => armPoint(s, side, r.inward), (s) => {
          const a = (armEnvelope(s) * r.amp) / H;
          const foam = k === 0 ? smoothstep(5, 14, s.v) * s.wet * Math.exp(-s.age / 1.4) * 0.75 : 0;
          return { r: foam, g: r.sign > 0 ? a : 0, b: r.sign < 0 ? a : 0, w: 2 * ridgeHalfWidth(s.age, r.width) * 0.85 };
        });
      });
    }

    // ---- ondas transversais (dentro do V) em baixa velocidade: λ = 2πv²/g ----
    strokeChain((s) => ({ x: s.sx, z: s.sz }), (s) => {
      const lam = (2 * Math.PI * s.v * s.v) / 9.81;
      const phase = Math.sin((2 * Math.PI * s.v * s.age) / Math.max(lam, 0.5));
      const a = waveAmp(s.v) * s.wet * 0.35 * Math.exp(-s.age / 8) * (1 - smoothstep(6, 10, s.v));
      return { r: 0, g: phase > 0 ? (a * phase) / H : 0, b: phase < 0 ? (-a * phase) / H : 0, w: 2 + 0.6 * s.age };
    });

    // ---- água revolvida da hélice: espuma central que se abre e some devagar ----
    strokeChain((s) => ({ x: s.sx, z: s.sz }), (s) => {
      const f = (0.25 + 0.75 * s.thr) * smoothstep(0.3, 3, s.v + s.thr * 3) * s.wet * Math.exp(-s.age / 6);
      return { r: f * 0.95, g: 0.02 * f, b: 0, w: 0.8 + 0.4 * s.age };
    });
    // rastro de água "lisa"/aerada que fica muito tempo visível (como na vida real)
    strokeChain((s) => ({ x: s.sx, z: s.sz }), (s) => {
      const f = smoothstep(0.5, 6, s.v) * Math.max(s.wet, 0.25 * s.air) * Math.exp(-s.age / 25) * 0.3;
      return { r: f, g: 0, b: 0, w: Math.min(2.2 + 0.45 * s.age, 14) };
    });

    // ---- colchão de ar da asa (ekranoplano rente à água): o ar empurrado sob a asa "corta" a água ----
    // faixa de água encrespada/aerada da largura da asa + os vórtices das pontas riscando a superfície (duas linhas
    // de espuma fina com ondinhas alternadas), que se abrem e somem em poucos segundos
    if (pts.some((s) => s.air > 0.03)) {
      const along = (s: WakeSample, k: number) => ({ x: s.sx + s.rx * k, z: s.sz + s.rz * k });
      strokeChain((s) => along(s, 0), (s) => {
        const a = s.air * Math.exp(-s.age / 1.6);
        return { r: 0.14 * a, g: 0.008 * a / H, b: 0, w: Math.max(0.5, s.span * 1.1 + 0.6 * s.age) };
      });
      for (const side of [-1, 1]) {
        strokeChain((s) => along(s, side * (s.span * 0.92 + 0.35 * s.age)), (s) => {
          const a = s.air * Math.exp(-s.age / 3.5);
          const ph = Math.sin(s.age * 9);
          return { r: 0.6 * a, g: ph > 0 ? 0.025 * a * ph / H : 0, b: ph < 0 ? -0.025 * a * ph / H : 0, w: 0.35 + 0.5 * s.age };
        });
      }
    }

    // ---- cavitação / ventilação: "fervura" branca na popa ----
    for (const s of pts) {
      if (s.boil < 0.05 || !inView(s.sx, s.sz)) continue;
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

    // ---- escape borbulhando na lenta: manchas de espuma fina que sobem atrás da hélice ----
    if (live.exh > 0.05) {
      const t = performance.now() / 1000;
      for (let k = 0; k < 7; k++) {
        const ph = (t * 1.7 + k * 0.37) % 1;              // cada "bolha" nasce, abre e some
        const ang = k * 2.4 + Math.floor(t * 1.7 + k * 0.37) * 1.3;
        const rr = 0.25 + 0.5 * ((k * 0.61) % 1);
        const fx = -live.rz, fz = live.rx;
        const bx = live.sx - fx * 0.35 + Math.cos(ang) * rr, bz = live.sz - fz * 0.35 + Math.sin(ang) * rr;
        const rad = (0.15 + 0.55 * ph) * ppm;
        const a = live.exh * Math.sin(Math.PI * ph) * 0.55;
        const g = c.createRadialGradient(X(bx), Y(bz), rad * 0.35, X(bx), Y(bz), rad);
        g.addColorStop(0, `rgba(${(a * 160) | 0},0,0,1)`);
        g.addColorStop(0.75, `rgba(${(a * 255) | 0},0,0,1)`);
        g.addColorStop(1, "rgba(0,0,0,1)");
        c.fillStyle = g;
        c.beginPath(); c.arc(X(bx), Y(bz), rad, 0, Math.PI * 2); c.fill();
      }
    }

    // ---- borda do casco: espuma/"bigode" na proa e ao longo do costado ----
    const hullFoam = smoothstep(1.5, 9, live.v) * live.wet * 0.7;
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
