// Simulation: campo de esteira (ondas geradas pela própria lancha).
// A esteira é um histórico de amostras (posição da proa/popa, rumo, velocidade). A partir dele:
//  • a FÍSICA consulta a altura da marola (heightAt) — a lancha sente a esteira ao cruzá-la;
//  • a APRESENTAÇÃO desenha o mesmo histórico no mapa de esteira (wakeMap.ts) do shader.
// Modelo: braços do V de Kelvin (crista, cavado, crista secundária) que se abrem com a idade,
// alargam (dispersão) e perdem amplitude lentamente — duram ~1 min e meio, como na vida real.

import { v3, clamp, smoothstep } from "./math.ts";
import type { Speedboat } from "./boat.ts";
import type { IWaterSurface } from "./water.ts";
import type { Vec3 } from "./math.ts";

export interface WakeSample {
  bx: number; bz: number;   // proa
  sx: number; sz: number;   // popa (hélice)
  rx: number; rz: number;   // "direita" do casco no plano
  v: number;                // velocidade na água (m/s)
  thr: number;              // acelerador efetivo
  boil: number;             // cavitação/ventilação 0..1
  exh: number;              // gases de escape borbulhando (motor ligado, lancha devagar) 0..1
  /** contato do casco com a água 0..1 (ekranoplano voando ≈ 0: quase não faz onda nem espuma) */
  wet: number;
  /** colchão de ar da asa rente à água 0..1 (ekranoplano): o ar "corta" a água sob a asa */
  air: number;
  /** meia-envergadura (m) de quem gera o colchão de ar */
  span: number;
  age: number;              // s
}

export const WAKE_MAX_AGE = 90;      // s
const EMIT_DT_FAST = 0.1;            // s entre amostras em movimento
const EMIT_DT_SLOW = 0.25;
/** Amostras mais novas que isso não afetam a física (a onda do próprio casco já é modelada em boat.ts). */
export const WAKE_PHYSICS_MIN_AGE = 3;

/** Amplitude (m) da onda gerada pelo casco em função da velocidade (pico no "hump"). */
export const waveAmp = (v: number): number =>
  0.1 * smoothstep(0.4, 3, v) + 0.24 * Math.exp(-(((v - 5) / 3) ** 2)) + 0.1 * smoothstep(8, 16, v);

/** Semiângulo do V: 19,5° (Kelvin) em deslocamento, mais fechado em planeio (alto Froude). */
export const kelvinTan = (v: number): number => {
  const fn = v / Math.sqrt(9.81 * 6);
  const ang = 19.47 - 8.5 * smoothstep(0.55, 1.6, fn);
  return Math.tan((ang * Math.PI) / 180);
};

/** Envelope da onda de um braço: cresce logo atrás do casco, decai devagar e se espalha. */
export const armEnvelope = (s: WakeSample): number =>
  (waveAmp(s.v) * Math.max(s.wet, 0.12 * s.air) * Math.exp(-s.age / 45)) / Math.sqrt(1 + s.age / 6) * (1 - Math.exp(-s.age * 6 - 0.15));

/** Cristas/cavados de cada braço (a partir da linha externa do V, para dentro). */
export const WAKE_RIDGES = [
  { inward: 0, amp: 1, sign: 1, width: 1.0 },
  { inward: 1.5, amp: 0.75, sign: -1, width: 1.1 },
  { inward: 3.0, amp: 0.45, sign: 1, width: 1.2 },
] as const;

/** Meia-largura (m) do perfil de uma crista: alarga com a idade (dispersão), até 7 m. */
export const ridgeHalfWidth = (age: number, base: number): number => Math.min(base * (0.9 + 0.11 * age), 7);

/** Distância lateral da crista ao rastro da proa (negativa = não existe ainda). */
export const armOffset = (s: WakeSample, inward: number): number =>
  0.9 + kelvinTan(s.v) * s.v * s.age - inward * (1 + 0.35 * s.age);

export const armPoint = (s: WakeSample, side: number, inward: number): { x: number; z: number } | null => {
  const half = armOffset(s, inward);
  if (half < 0.4) return null;
  return { x: s.bx + s.rx * side * half, z: s.bz + s.rz * side * half };
};

interface Chunk { i0: number; i1: number; minX: number; maxX: number; minZ: number; maxZ: number }

export class WakeField {
  samples: WakeSample[] = [];
  private emitTimer = 0;
  private chunks: Chunk[] = [];
  private static readonly CH = 10;
  /** contato do casco com a água, suavizado (o casco planando toca e solta a água o tempo todo) */
  private wetS = 1;

  /** Amostra do estado atual da lancha (também usada como "ponta viva" pelo visual). */
  sampleBoat(boat: Speedboat): WakeSample {
    const T = boat.telemetry;
    const L = boat.params.length;
    const b = boat.toWorld(v3(0, 0, 0.43 * L)); // proa
    const s = boat.toWorld(v3(0, 0, -0.5 * L)); // popa
    const r = boat.right;
    const rl = Math.hypot(r.x, r.z) || 1;
    return {
      bx: b.x, bz: b.z, sx: s.x, sz: s.z, rx: r.x / rl, rz: r.z / rl,
      v: Math.max(0, Math.abs(T.waterSpeed)),
      thr: T.gear === "N" ? 0 : T.throttle,
      // fervura: cavitação/ar puxado (hélice dentro d'água) + pás picando a superfície (hélice aflorando)
      boil: clamp(Math.max(
        T.cavitation * T.propImmersion,
        (1 - T.ventilation) * (T.throttle > 0.2 ? 1 : 0) * smoothstep(0.2, 0.6, T.propImmersion),
        4 * T.propImmersion * (1 - T.propImmersion) * Math.min(Math.abs(T.propRpm) / 1500, 1),
      ), 0, 1) * (T.depth > 0.4 ? 1 : 0),
      exh: T.engine === "running" && T.depth > 0.4 ? 1 - smoothstep(1.5, 5, Math.abs(T.waterSpeed)) : 0,
      wet: this.wetS,
      air: boat.params.wing && !boat.wingFolded ? (1 - smoothstep(0.4, 3.5, T.wingH)) * smoothstep(12, 30, Math.abs(T.waterSpeed)) * (1 - 0.6 * this.wetS) : 0,
      span: boat.params.wing ? boat.params.wing.span / 2 : 0,
      age: 0,
    };
  }

  /** Avança a esteira (chamar no passo de física). */
  update(dt: number, boat: Speedboat): void {
    for (const s of this.samples) s.age += dt;
    // planando, só 1–3 pontos tocam a água: qualquer contato conta como "molhado"; no ar cai para 0 em ~0,3 s
    const wetT = clamp(boat.telemetry.wetFraction * 6, 0, 1);
    this.wetS += (wetT - this.wetS) * (1 - Math.exp(-dt / (wetT > this.wetS ? 0.08 : 0.3)));
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].age > WAKE_MAX_AGE) drop++;
    if (drop) this.samples.splice(0, drop);
    this.emitTimer -= dt;
    const live = this.sampleBoat(boat);
    const moving = live.v > 0.3 || live.thr > 0.05;
    if (this.emitTimer <= 0 && moving) {
      this.emitTimer = live.v > 2 ? EMIT_DT_FAST : EMIT_DT_SLOW;
      this.samples.push(live);
    }
    this.rebuildChunks();
  }

  reset(): void { this.samples = []; this.chunks = []; this.wetS = 1; }

  /** Caixas envolventes por trecho (aceleram a consulta da física). */
  private rebuildChunks(): void {
    this.chunks = [];
    const S = this.samples, CH = WakeField.CH;
    for (let i0 = 0; i0 < S.length - 1; i0 += CH - 1) {
      const i1 = Math.min(i0 + CH - 1, S.length - 1);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = i0; i <= i1; i++) {
        const s = S[i];
        if (s.age < WAKE_PHYSICS_MIN_AGE) continue;
        const reach = Math.max(armOffset(s, 0), 0) + ridgeHalfWidth(s.age, 1.2) * 2.2;
        minX = Math.min(minX, s.bx - reach); maxX = Math.max(maxX, s.bx + reach);
        minZ = Math.min(minZ, s.bz - reach); maxZ = Math.max(maxZ, s.bz + reach);
      }
      if (minX < Infinity) this.chunks.push({ i0, i1, minX, maxX, minZ, maxZ });
    }
  }

  /** Altura (m) da marola da esteira em (x, z) — usada pela física. */
  heightAt(x: number, z: number): number {
    let h = 0;
    const S = this.samples;
    for (const c of this.chunks) {
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      for (let i = c.i0; i < c.i1; i++) {
        const a = S[i], b = S[i + 1];
        if (a.age < WAKE_PHYSICS_MIN_AGE || Math.abs(a.age - b.age) > 0.6) continue;
        const env = (armEnvelope(a) + armEnvelope(b)) * 0.5;
        if (env < 0.002) continue;
        for (const side of [-1, 1]) {
          for (const r of WAKE_RIDGES) {
            const pa = armPoint(a, side, r.inward), pb = armPoint(b, side, r.inward);
            if (!pa || !pb) continue;
            // distância do ponto ao segmento pa-pb
            const ex = pb.x - pa.x, ez = pb.z - pa.z;
            const L2 = ex * ex + ez * ez;
            let t = L2 > 1e-9 ? ((x - pa.x) * ex + (z - pa.z) * ez) / L2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = x - (pa.x + ex * t), dz = z - (pa.z + ez * t);
            const w = ridgeHalfWidth((a.age + b.age) * 0.5, r.width);
            const q = (dx * dx + dz * dz) / (w * w);
            if (q > 4) continue;
            // segmentos vizinhos se sobrepõem nas pontas: pondera pela posição ao longo do segmento
            const along = t <= 0 || t >= 1 ? 0.5 : 1;
            h += r.sign * r.amp * env * Math.exp(-q) * along;
          }
        }
      }
    }
    return h;
  }
}

/** Superfície da água + marolas da esteira (o que a física da lancha enxerga). */
export class WaterWithWake implements IWaterSurface {
  private readonly base: IWaterSurface;
  private readonly wake: WakeField;
  constructor(base: IWaterSurface, wake: WakeField) { this.base = base; this.wake = wake; }
  getHeight(x: number, z: number): number { return this.base.getHeight(x, z) + this.wake.heightAt(x, z); }
  getNormal(x: number, z: number): Vec3 { return this.base.getNormal(x, z); }
  getCurrent(x: number, z: number): Vec3 { return this.base.getCurrent(x, z); }
  getDepth(x: number, z: number): number { return this.base.getDepth(x, z); }
}
