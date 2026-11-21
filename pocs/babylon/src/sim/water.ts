// Water Physics: superfície da água consultável pela física.
// As MESMAS ondas (parâmetros e fórmula) são usadas pelo shader visual
// (presentation/waterMaterial.ts), para que o casco acompanhe exatamente o que se vê.

import { type Vec3, v3, normalize, cross } from "./math.ts";

export interface IWaterSurface {
  /** Altura (Y) da superfície em (x, z) no instante atual. */
  getHeight(x: number, z: number): number;
  /** Normal da superfície em (x, z). */
  getNormal(x: number, z: number): Vec3;
  /** Velocidade da correnteza (m/s, no plano XZ). */
  getCurrent(x: number, z: number): Vec3;
  /** Profundidade (m) entre a superfície em repouso e o fundo. */
  getDepth(x: number, z: number): number;
}

/** Uma onda de Gerstner direcional. */
export interface GerstnerWave {
  dirDeg: number;      // direção de propagação (graus, 0 = +Z)
  wavelength: number;  // m
  amplitude: number;   // m
  steepness: number;   // 0..1 (Q relativo; 1 = crista no limite)
  phase: number;       // rad
}

export const G = 9.81;

/** Ondas do lago (presets). A intensidade multiplica a amplitude de todas. */
export const WAVE_PRESETS: Record<string, GerstnerWave[]> = {
  lago: [
    { dirDeg: 20, wavelength: 18, amplitude: 0.16, steepness: 0.55, phase: 0.0 },
    { dirDeg: -15, wavelength: 11, amplitude: 0.09, steepness: 0.5, phase: 1.3 },
    { dirDeg: 55, wavelength: 6.5, amplitude: 0.045, steepness: 0.45, phase: 2.1 },
    { dirDeg: -60, wavelength: 3.7, amplitude: 0.022, steepness: 0.4, phase: 4.0 },
  ],
};

export const MAX_WAVES = 4;

/**
 * Mar mexido só numa REGIÃO (v0.82: a boca do cânion, estilo "inlet" com molhes): ondas de Gerstner próprias cuja
 * amplitude é multiplicada por uma máscara elíptica (1 no centro, 0 fora de rx × rz; a borda suaviza em `feather` da
 * fração do raio). Somam-se às ondas globais na física E no shader (mesmos parâmetros). Não seguem a `intensity`.
 */
export interface LocalSea { cx: number; cz: number; rx: number; rz: number; feather: number; waves: GerstnerWave[] }
export const MAX_LOCAL_WAVES = 3;

export interface CurrentZone {
  /** Retângulo (no plano XZ) onde existe correnteza. */
  minX: number; maxX: number; minZ: number; maxZ: number;
  /** Velocidade (m/s) no plano XZ. */
  vx: number; vz: number;
  /** Faixa de transição suave nas bordas (m). */
  feather: number;
}

export class GerstnerWater implements IWaterSurface {
  time = 0;
  /** Multiplicador global de amplitude (0 = espelho, 1 = padrão, 2.5 = mexido). */
  intensity = 1;
  readonly waves: GerstnerWave[];
  readonly baseLevel: number;
  private readonly groundHeight: (x: number, z: number) => number;
  private readonly currents: CurrentZone[];
  // cache derivado
  private k: number[] = [];
  private c: number[] = [];
  private dx: number[] = [];
  private dz: number[] = [];
  /** mar local (região mexida) e o cache das ondas dela */
  readonly local: LocalSea | null;
  private lk: number[] = []; private lc: number[] = []; private ldx: number[] = []; private ldz: number[] = [];

  constructor(opts: {
    waves: GerstnerWave[];
    baseLevel?: number;
    groundHeight: (x: number, z: number) => number;
    currents?: CurrentZone[];
    local?: LocalSea;
  }) {
    this.waves = opts.waves.slice(0, MAX_WAVES);
    this.baseLevel = opts.baseLevel ?? 0;
    this.groundHeight = opts.groundHeight;
    this.currents = opts.currents ?? [];
    for (const w of this.waves) {
      const k = (2 * Math.PI) / w.wavelength;
      this.k.push(k);
      this.c.push(Math.sqrt(G / k)); // dispersão em águas profundas
      const a = (w.dirDeg * Math.PI) / 180;
      this.dx.push(Math.sin(a));
      this.dz.push(Math.cos(a));
    }
    this.local = opts.local ? { ...opts.local, waves: opts.local.waves.slice(0, MAX_LOCAL_WAVES) } : null;
    for (const w of this.local?.waves ?? []) {
      const k = (2 * Math.PI) / w.wavelength;
      this.lk.push(k); this.lc.push(Math.sqrt(G / k));
      const a = (w.dirDeg * Math.PI) / 180;
      this.ldx.push(Math.sin(a)); this.ldz.push(Math.cos(a));
    }
  }

  /** máscara do mar local em (x, z): 1 no miolo, 0 fora (elipse com borda suave) */
  localMask(x: number, z: number): number {
    const L = this.local;
    if (!L) return 0;
    const r = Math.hypot((x - L.cx) / L.rx, (z - L.cz) / L.rz);
    const t = Math.min(1, Math.max(0, (r - (1 - L.feather)) / L.feather));
    return 1 - t * t * (3 - 2 * t);
  }

  /** Q efetivo por onda (normalizado para nunca formar laços). */
  private q(i: number): number {
    const n = this.waves.length;
    const amp = this.waves[i].amplitude * this.intensity;
    return amp > 0 ? this.waves[i].steepness / (this.k[i] * amp * n) : 0;
  }

  /** Deslocamento de Gerstner de um ponto de grade (x0, z0). */
  displace(x0: number, z0: number, out: { x: number; y: number; z: number }): void {
    let ox = 0, oy = 0, oz = 0;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      const amp = w.amplitude * this.intensity;
      const f = this.k[i] * (this.dx[i] * x0 + this.dz[i] * z0 - this.c[i] * this.time) + w.phase;
      const qa = this.q(i) * amp;
      const cf = Math.cos(f);
      ox += qa * this.dx[i] * cf;
      oz += qa * this.dz[i] * cf;
      oy += amp * Math.sin(f);
    }
    // mar local (a máscara é avaliada no ponto de grade, como no shader)
    const L = this.local;
    if (L) {
      const m = this.localMask(x0, z0);
      if (m > 0) for (let i = 0; i < L.waves.length; i++) {
        const w = L.waves[i], amp = w.amplitude * m;
        const f = this.lk[i] * (this.ldx[i] * x0 + this.ldz[i] * z0 - this.lc[i] * this.time) + w.phase;
        const qa = (w.steepness / (this.lk[i] * L.waves.length)) * m;
        const cf = Math.cos(f);
        ox += qa * this.ldx[i] * cf;
        oz += qa * this.ldz[i] * cf;
        oy += amp * Math.sin(f);
      }
    }
    out.x = ox; out.y = oy; out.z = oz;
  }

  private tmp = { x: 0, y: 0, z: 0 };

  getHeight(x: number, z: number): number {
    // Gerstner desloca horizontalmente: inverte por iteração de ponto fixo
    // para achar o ponto de grade cujo deslocamento cai em (x, z).
    let gx = x, gz = z;
    const d = this.tmp;
    for (let it = 0; it < 4; it++) {
      this.displace(gx, gz, d);
      gx = x - d.x;
      gz = z - d.z;
    }
    this.displace(gx, gz, d);
    return this.baseLevel + d.y;
  }

  getNormal(x: number, z: number): Vec3 {
    const e = 0.25;
    const hL = this.getHeight(x - e, z), hR = this.getHeight(x + e, z);
    const hB = this.getHeight(x, z - e), hF = this.getHeight(x, z + e);
    const tx = v3(2 * e, hR - hL, 0);
    const tz = v3(0, hF - hB, 2 * e);
    return normalize(cross(tz, tx));
  }

  getCurrent(x: number, z: number): Vec3 {
    let vx = 0, vz = 0;
    for (const c of this.currents) {
      const fx = Math.min(x - c.minX, c.maxX - x) / c.feather;
      const fz = Math.min(z - c.minZ, c.maxZ - z) / c.feather;
      const f = Math.max(0, Math.min(1, fx, fz));
      vx += c.vx * f;
      vz += c.vz * f;
    }
    return v3(vx, 0, vz);
  }

  getDepth(x: number, z: number): number {
    return this.baseLevel - this.groundHeight(x, z);
  }

  /** Parâmetros empacotados para o shader (vec4 por onda). */
  shaderParams(): { a: number[]; b: number[]; la: number[]; lb: number[]; lm: number[]; lf: number } {
    // a = (dirX, dirZ, k, c)   b = (amplitude, Q*amp, phase, 0)
    const a: number[] = [], b: number[] = [];
    for (let i = 0; i < MAX_WAVES; i++) {
      if (i < this.waves.length) {
        const amp = this.waves[i].amplitude * this.intensity;
        a.push(this.dx[i], this.dz[i], this.k[i], this.c[i]);
        b.push(amp, this.q(i) * amp, this.waves[i].phase, 0);
      } else {
        a.push(1, 0, 1, 0);
        b.push(0, 0, 0, 0);
      }
    }
    // mar local: la = (dirX, dirZ, k, c), lb = (amplitude, Q*amp, phase, 0); lm = (cx, cz, rx, rz), lf = feather
    const la: number[] = [], lb: number[] = [], L = this.local;
    for (let i = 0; i < MAX_LOCAL_WAVES; i++) {
      if (L && i < L.waves.length) {
        const w = L.waves[i];
        la.push(this.ldx[i], this.ldz[i], this.lk[i], this.lc[i]);
        lb.push(w.amplitude, w.steepness / (this.lk[i] * L.waves.length), w.phase, 0);
      } else { la.push(1, 0, 1, 0); lb.push(0, 0, 0, 0); }
    }
    return { a, b, la, lb, lm: L ? [L.cx, L.cz, L.rx, L.rz] : [0, 0, 1, 1], lf: L ? L.feather : 0.5 };
  }
}
