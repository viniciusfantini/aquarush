// Vento: 5 níveis (sem vento → tempestade), com rajadas e direção que oscila um pouco.
// A física do barco usa o vento aparente (vento − velocidade do barco) sobre a área exposta (`params.windage`):
// empurra o barco (deriva), inclina (banda) e gira (a proa cai a sotavento). O vento também levanta as
// ondas (o nível de mar efetivo é o maior entre o preset de água e o do vento). Sem Babylon (testável no Node).

import { type Vec3, v3 } from "./math.ts";

export interface WindLevel {
  key: string;
  label: string;
  /** velocidade média (m/s) */
  speed: number;
  /** amplitude das rajadas (fração da média) */
  gust: number;
  /** mar levantado pelo vento (mesma escala de `water.intensity`) e ondulação fina do visual */
  waves: number;
  ripple: number;
}

/** Beaufort aproximado: 0 / 2 / 4 / 6 / 8. */
export const WIND_LEVELS: WindLevel[] = [
  { key: "nenhum", label: "sem vento", speed: 0, gust: 0, waves: 0, ripple: 0 },
  { key: "fraco", label: "vento fraco (~6 nós)", speed: 3, gust: 0.25, waves: 0.15, ripple: 0.5 },
  { key: "moderado", label: "vento moderado (~14 nós)", speed: 7, gust: 0.3, waves: 0.5, ripple: 0.9 },
  { key: "forte", label: "vento forte (~23 nós)", speed: 12, gust: 0.35, waves: 1.3, ripple: 1.3 },
  { key: "tempestade", label: "tempestade (~39 nós)", speed: 20, gust: 0.4, waves: 2.6, ripple: 1.8 },
];

export const MS_TO_KNOTS = 1.94384;

export class Wind {
  level = 0;
  /** direção para onde o vento sopra (rad, 0 = +Z/norte, π/2 = +X/leste) — média */
  dirTo = 2.4; // sopra de noroeste para sudeste
  /** vento atual (m/s, plano XZ) */
  v: Vec3 = v3();
  time = 0;

  get def(): WindLevel { return WIND_LEVELS[this.level]; }
  setLevel(i: number): void { this.level = ((i % WIND_LEVELS.length) + WIND_LEVELS.length) % WIND_LEVELS.length; }
  /** velocidade atual (m/s) */
  get speed(): number { return Math.hypot(this.v.x, this.v.z); }
  /** direção de onde o vento VEM (rad, convenção náutica) */
  get dirFrom(): number { return Math.atan2(-this.v.x, -this.v.z); }

  update(dt: number): void {
    this.time += dt;
    const t = this.time, L = this.def;
    // rajadas: soma de senoides incomensuráveis (determinística, sem ruído aleatório)
    const g = 1 + L.gust * (0.55 * Math.sin(t * 0.37) + 0.3 * Math.sin(t * 1.13 + 1.7) + 0.15 * Math.sin(t * 2.9 + 0.4));
    const s = Math.max(0, L.speed * g);
    const dir = this.dirTo + 0.18 * Math.sin(t * 0.07) + 0.06 * Math.sin(t * 0.31 + 2.1);
    this.v = v3(Math.sin(dir) * s, 0, Math.cos(dir) * s);
  }
}
