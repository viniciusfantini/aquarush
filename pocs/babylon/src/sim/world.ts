// Mundo físico da cena PrototypeLake: relevo (função de altura), colisores estáticos
// (rochas = esferas, píer = caixas) e zonas de correnteza. Determinístico (seed fixa),
// compartilhado entre física e geração visual.

import type { CurrentZone } from "./water.ts";
import { clamp, smoothstep, v3, qMul, qFromAxisAngle, rotate, rotateInv, type Vec3, type Quat } from "./math.ts";

export interface SphereCollider { x: number; y: number; z: number; r: number }
export interface BoxCollider {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
  /** só empurra para +Z (batente em V da carretinha: a proa nunca escorrega pelo lado) */
  onlyPlusZ?: boolean;
}

/** Pose de um referencial móvel (carretinha): origem, rumo (yaw, +Z = (sen, cos)) e pitch (> 0 = +Z local desce). */
export interface FramePose { x: number; y: number; z: number; yaw: number; pitch: number }

/**
 * Carretinha no referencial dela (origem = guincho no chão; +Z local = traseira; Y = normal ao chão):
 * berço em V (y = clear + vSlope·|x|, 0 ≤ z ≤ length, só apoia por cima) + caixas locais (postes, batente).
 */
export interface TrailerCollider {
  pose: FramePose;
  length: number; clear: number; vSlope: number; halfW: number; mu: number;
  boxes: BoxCollider[];
}

export interface PhysicsWorld {
  groundHeight(x: number, z: number): number;
  spheres: SphereCollider[];
  boxes: BoxCollider[];
  trailers?: TrailerCollider[];
  /** vento atual (m/s, plano XZ) — atualizado pelo modelo `Wind` (sim/wind.ts); ausente = sem vento */
  wind?: Vec3;
}

/** rotação da pose (Hamilton, igual à Babylon: yaw em Y e depois pitch no X local) */
export const frameQuat = (p: FramePose): Quat => qMul(qFromAxisAngle(v3(0, 1, 0), p.yaw), qFromAxisAngle(v3(1, 0, 0), p.pitch));
export const toFrameLocal = (p: FramePose, w: Vec3): Vec3 => rotateInv(frameQuat(p), v3(w.x - p.x, w.y - p.y, w.z - p.z));
export const fromFrame = (p: FramePose, l: Vec3): Vec3 => { const r = rotate(frameQuat(p), l); return v3(p.x + r.x, p.y + r.y, p.z + r.z); };

// ---------- ruído determinístico ----------
const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
};
const valueNoise = (x: number, z: number): number => {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
};
export const fbm = (x: number, z: number, oct = 4): number => {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * valueNoise(x * f, z * f); f *= 2.03; amp *= 0.5; }
  return s;
};

/** PRNG determinístico (mulberry32). */
export const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------- relevo do lago ----------
export const LAKE = { rx: 330, rz: 240 };
/**
 * Lago ampliado (v0.66, ~4× a área): dois lobos grandes, a LESTE e a OESTE, unidos ao lago original por uma união
 * suave. O lago original — píer, rampa, marina, ilha, estrada e a foz do cânion — fica exatamente onde estava.
 */
export const LAKE_LOBES = [
  { cx: 650, cz: -10, rx: 480, rz: 390 },
  { cx: -670, cz: 90, rx: 450, rz: 350 },
];
/** união suave de dois campos de distância (k = largura da emenda) */
const smin = (a: number, b: number, k: number): number => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); };
export const ISLAND = { x: 140, z: 70, r: 48 };
/** Canal de rio que desemboca no lago pelo norte (com correnteza). */
export const RIVER = { z0: 170, z1: 760, width: 34 };
export const riverCenterX = (z: number): number => -60 + 38 * Math.sin(z / 95);

/** Distância normalizada ao contorno do lago (1 = margem). */
const lakeR = (x: number, z: number): number => {
  let r = Math.hypot(x / LAKE.rx, z / LAKE.rz);
  for (const L of LAKE_LOBES) r = smin(r, Math.hypot((x - L.cx) / L.rx, (z - L.cz) / L.rz), 0.18);
  return r + 0.11 * fbm(x / 140 + 7.3, z / 140 - 2.1, 3);
};

const baseGround = (x: number, z: number): number => {
  const r = lakeR(x, z);
  const hills = 6 + 22 * (0.5 + 0.5 * fbm(x / 210, z / 210, 4));
  let h = -7 + 6.2 * smoothstep(0.5, 1.0, r) + 2.6 * smoothstep(1.0, 1.14, r) + hills * smoothstep(1.12, 1.75, r);
  h += 0.6 * fbm(x / 25, z / 25, 2) * smoothstep(0.9, 1.2, r); // irregularidade das margens

  // ilha
  const di = Math.hypot(x - ISLAND.x, z - ISLAND.z) / ISLAND.r;
  // (v0.38) a saia da ilha some além de 1,0–1,4 raio: antes o "−2,2 m" valia no lago inteiro e o max() abaixo
  // levantava todo o fundo para 2–3 m de profundidade
  const island = 7 * (1 - smoothstep(0.0, 1.0, di)) - 2.2 + 1.5 * fbm(x / 18, z / 18, 2) - 20 * smoothstep(1.0, 1.4, di);
  h = Math.max(h, island);

  // canal do rio (escava o terreno)
  if (z > RIVER.z0 - 60 && z < RIVER.z1 + 60) {
    const d = Math.abs(x - riverCenterX(z));
    const along = smoothstep(RIVER.z0 - 60, RIVER.z0, z) * (1 - smoothstep(RIVER.z1, RIVER.z1 + 60, z));
    const bed = -3.2 + 0.4 * fbm(x / 15, z / 15, 2);
    const carve = 1 - smoothstep(RIVER.width * 0.45, RIVER.width * 0.85, d);
    const target = bed + (h - bed) * (1 - carve * along);
    h = Math.min(h, target);
  }
  return h;
};

// ---------- rampa de concreto (descida de barcos) ----------
/**
 * Rampa na margem sul, 22 m a oeste do píer, descendo para o norte (+Z) com 12 % de inclinação.
 * s = distância ao longo da rampa a partir da linha d'água (s > 0 = dentro do lago).
 */
export const RAMP = (() => {
  const x = -22;
  let z = -300;
  while (baseGround(x, z) > 0 && z < 0) z += 0.05;
  return { x, z0: z, width: 5.5, slope: 0.12, sMin: -16, sMax: 9, shoulder: 2.5 };
})();
export const rampY = (s: number): number => -RAMP.slope * s;
/** dentro da faixa de concreto (para efeitos/vegetação) */
export const onRamp = (x: number, z: number, margin = 0): boolean => {
  const s = z - RAMP.z0;
  return Math.abs(x - RAMP.x) < RAMP.width / 2 + margin && s > RAMP.sMin - margin && s < RAMP.sMax + margin;
};

/**
 * Bacia dragada da marina (na frente do píer: ponto de partida, vaga de atracação e saída para o lago).
 * O lago perto da margem tem ~1 m — raso demais para o pé do motor da lancha (bate ao acelerar).
 */
export const MARINA_BASIN = { cx: 27, cz: -226, hx: 35, hz: 22, depth: -2.3, blend: 8 };
const basin = (x: number, z: number, h: number): number => {
  const B = MARINA_BASIN;
  const d = Math.hypot(Math.max(0, Math.abs(x - B.cx) - B.hx), Math.max(0, Math.abs(z - B.cz) - B.hz));
  if (d >= B.blend) return h;
  return Math.min(h, h + (B.depth - h) * (1 - smoothstep(0, B.blend, d)));
};

const terrainWithRamp = (x: number, z: number): number => {
  const b = basin(x, z, baseGround(x, z));
  const s = z - RAMP.z0, lat = Math.abs(x - RAMP.x);
  if (lat > RAMP.width / 2 + RAMP.shoulder || s < RAMP.sMin - 6 || s > RAMP.sMax + 6) return b;
  const r = rampY(clamp(s, RAMP.sMin, RAMP.sMax));
  const wLat = 1 - smoothstep(RAMP.width / 2, RAMP.width / 2 + RAMP.shoulder, lat);
  const wLon = 1 - smoothstep(0, 6, s < RAMP.sMin ? RAMP.sMin - s : s > RAMP.sMax ? s - RAMP.sMax : 0);
  return b + (r - b) * wLat * wLon;
};

// ---------- estrada (rampa → pátio) e pátio de estacionamento / posto ----------
/** Pátio do posto: retângulo plano (asfalto) com posto de combustível, loja, oficina, vagas e áreas de manobra. */
export const LOT = { cx: -165, cz: -312, hx: 38, hz: 25, y: 0 };
/** Pátio de manobra no alto da rampa: plano, na cota do topo da rampa (o carro vira e desce de ré). */
export const YARD = { cx: RAMP.x, cz: RAMP.z0 + RAMP.sMin - 12, hx: 16, hz: 12, y: rampY(RAMP.sMin) };
const rectDistance = (r: { cx: number; cz: number; hx: number; hz: number }, x: number, z: number): number =>
  Math.hypot(Math.max(0, Math.abs(x - r.cx) - r.hx), Math.max(0, Math.abs(z - r.cz) - r.hz));
export const yardDistance = (x: number, z: number): number => rectDistance(YARD, x, z);
/** Estacionamento de cima: extensão plana do pátio do posto para o norte (barcos de exposição nas carretinhas). */
export const PARK = { cx: LOT.cx, cz: LOT.cz + LOT.hz + 8, hx: LOT.hx, hz: 8 };
export const parkDistance = (x: number, z: number): number => rectDistance(PARK, x, z);
/** distância (≥ 0) ao retângulo do pátio */
export const lotDistance = (x: number, z: number): number => rectDistance(LOT, x, z);
/** Pontos de controle da estrada (Catmull-Rom): sai do alto da rampa e vai pela faixa baixa da praia com curvas. */
const ROAD_CTRL: [number, number][] = [
  [YARD.cx - YARD.hx + 2, YARD.cz], [YARD.cx - YARD.hx - 8, YARD.cz], [-58, -287], [-76, -283], [-94, -290],
  [-104, -302], [-112, -314], [LOT.cx + LOT.hx - 2, -317], [LOT.cx + LOT.hx - 10, -317],
];
export const ROAD = { halfWidth: 3.5, shoulder: 4 };
export interface RoadSample { x: number; z: number; y: number; dx: number; dz: number }
const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
/** Amostras da estrada a cada ~1 m, com altura suavizada (corte/aterro) e direção. */
export const ROAD_SAMPLES: RoadSample[] = (() => {
  const dense: { x: number; z: number }[] = [];
  const C = ROAD_CTRL;
  for (let i = 0; i < C.length - 1; i++) {
    const p0 = C[Math.max(0, i - 1)], p1 = C[i], p2 = C[i + 1], p3 = C[Math.min(C.length - 1, i + 2)];
    for (let k = 0; k < 40; k++) { const t = k / 40; dense.push({ x: catmull(p0[0], p1[0], p2[0], p3[0], t), z: catmull(p0[1], p1[1], p2[1], p3[1], t) }); }
  }
  dense.push({ x: C[C.length - 1][0], z: C[C.length - 1][1] });
  // reamostra por comprimento (1 m)
  const out: { x: number; z: number }[] = [dense[0]];
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    const d = Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z);
    acc += d;
    if (acc >= 1) { out.push(dense[i]); acc = 0; }
  }
  // perfil: terreno natural suavizado (média móvel de ±12 m), preso ao topo da rampa e à cota do pátio
  const raw = out.map((p) => terrainWithRamp(p.x, p.z));
  const W = 12;
  const smooth = raw.map((_, i) => { let s2 = 0, n = 0; for (let j = Math.max(0, i - W); j <= Math.min(raw.length - 1, i + W); j++) { s2 += raw[j]; n++; } return s2 / n; });
  let ly = 0, ln = 0;
  for (let x = LOT.cx - LOT.hx; x <= LOT.cx + LOT.hx; x += 4) for (let z = LOT.cz - LOT.hz; z <= LOT.cz + LOT.hz; z += 4) { ly += terrainWithRamp(x, z); ln++; }
  LOT.y = Math.min(ly / ln, 7.0); // o pátio corta um pouco o morro (estrada com rampa ≤ 9 %)
  const y0 = YARD.y, n = out.length;
  // greide: segue o terreno suavizado, mas com rampa máx. de 9 % e as pontas presas (topo da rampa e pátio)
  const G = 0.09, prof = smooth.slice();
  // dentro da faixa de transição do pátio a estrada já está na cota dele (senão a borda do pátio vira um degrau)
  const inLot = out.map((p) => lotDistance(p.x, p.z) < 7), inYard = out.map((p) => yardDistance(p.x, p.z) < 7);
  const pin = () => { for (let i = 0; i < n; i++) { if (inLot[i]) prof[i] = LOT.y; if (inYard[i]) prof[i] = y0; } };
  pin();
  for (let it = 0; it < 6; it++) {
    for (let i = 1; i < n; i++) prof[i] = clamp(prof[i], prof[i - 1] - G, prof[i - 1] + G);
    pin();
    for (let i = n - 2; i >= 0; i--) prof[i] = clamp(prof[i], prof[i + 1] - G, prof[i + 1] + G);
    pin();
  }
  return out.map((p, i) => {
    const y = prof[i];
    const q = out[Math.min(n - 1, i + 1)], r = out[Math.max(0, i - 1)];
    const l = Math.hypot(q.x - r.x, q.z - r.z) || 1;
    return { x: p.x, z: p.z, y, dx: (q.x - r.x) / l, dz: (q.z - r.z) / l };
  });
})();
const ROAD_BOX = (() => {
  const m = ROAD.halfWidth + ROAD.shoulder + 1;
  return { minX: Math.min(...ROAD_SAMPLES.map((p) => p.x)) - m, maxX: Math.max(...ROAD_SAMPLES.map((p) => p.x)) + m,
    minZ: Math.min(...ROAD_SAMPLES.map((p) => p.z)) - m, maxZ: Math.max(...ROAD_SAMPLES.map((p) => p.z)) + m };
})();
/** Amostra mais próxima da estrada e distância horizontal até o eixo (null fora da caixa da estrada). */
export const nearestRoad = (x: number, z: number, maxD = ROAD.halfWidth + ROAD.shoulder): { s: RoadSample; d: number } | null => {
  if (x < ROAD_BOX.minX - maxD || x > ROAD_BOX.maxX + maxD || z < ROAD_BOX.minZ - maxD || z > ROAD_BOX.maxZ + maxD) return null;
  let best = -1, bd = Infinity;
  for (let i = 0; i < ROAD_SAMPLES.length; i++) { const p = ROAD_SAMPLES[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
  // as pontas não "puxam" o terreno para trás delas (o início encosta no topo da rampa)
  const end = best === 0 ? ROAD_SAMPLES[0] : best === ROAD_SAMPLES.length - 1 ? ROAD_SAMPLES[best] : null;
  if (end) { const sgn = best === 0 ? 1 : -1; if (((x - end.x) * end.dx + (z - end.z) * end.dz) * sgn < -0.05) return null; }
  // projeta no segmento vizinho mais próximo e interpola a cota (sem "escadinha" entre amostras)
  let res: { s: RoadSample; d: number } = { s: ROAD_SAMPLES[best], d: Math.sqrt(bd) };
  for (const j of [best - 1, best]) {
    if (j < 0 || j + 1 >= ROAD_SAMPLES.length) continue;
    const a = ROAD_SAMPLES[j], b = ROAD_SAMPLES[j + 1];
    const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1;
    const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / L2, 0, 1);
    const px = a.x + ex * t, pz = a.z + ez * t, d = Math.hypot(x - px, z - pz);
    if (d <= res.d + 1e-6) res = { s: { x: px, z: pz, y: a.y + (b.y - a.y) * t, dx: a.dx, dz: a.dz }, d };
  }
  return res.d > maxD ? null : res;
};

/** Relevo final: terreno + rampa + estrada (corte/aterro com taludes) + pátio plano. Fonte única (física e visual). */
export const groundHeight = (x: number, z: number): number => {
  let h = terrainWithRamp(x, z);
  const r = nearestRoad(x, z);
  if (r) h += (r.s.y - h) * (1 - smoothstep(ROAD.halfWidth, ROAD.halfWidth + ROAD.shoulder, r.d));
  const dl = Math.min(lotDistance(x, z), parkDistance(x, z)); // pátio do posto + estacionamento de cima (mesma cota)
  if (dl < 6) h += (LOT.y - h) * (1 - smoothstep(0, 6, dl));
  const dy = yardDistance(x, z);
  if (dy < 6 && z < RAMP.z0 + RAMP.sMin + 0.01) h += (YARD.y - h) * (1 - smoothstep(0, 6, dy)); // não invade a rampa
  return h;
};
/** perto da estrada/pátio (para a vegetação e as rochas ficarem fora) */
export const onRoadOrLot = (x: number, z: number, margin = 0): boolean => lotDistance(x, z) < margin + 1 || parkDistance(x, z) < margin + 1 || yardDistance(x, z) < margin + 1 || nearestRoad(x, z, ROAD.halfWidth + margin) !== null;

export const RIVER_CURRENT: CurrentZone = {
  // aproximação retangular do trecho mais reto do rio próximo à foz; vazão para o sul
  minX: -140, maxX: 20, minZ: RIVER.z0 + 10, maxZ: RIVER.z1, vx: 0, vz: -1.6, feather: 25,
};

// ---------- colisores ----------
export interface PierLayout {
  /** Ponto em terra onde o píer começa. */
  shoreX: number; shoreZ: number;
  length: number; width: number; deckY: number;
  /** direção do píer (para dentro do lago) — unidade em XZ */
  dirX: number; dirZ: number;
}

/** Procura a margem caminhando a partir do centro numa direção. */
export const findShore = (dirX: number, dirZ: number): { x: number; z: number } => {
  let t = 0;
  while (t < 800 && groundHeight(dirX * t, dirZ * t) < 0.3) t += 0.5;
  return { x: dirX * t, z: dirZ * t };
};

/**
 * Cânion FECHADO por enquanto ("EM BREVE"): barreira flutuante de boias atravessando a entrada do rio, logo depois da
 * foz. O relevo do cânion não muda; a barreira é um colisor (caixa rasa na linha d'água) que só o jogo liga — os
 * testes do cânion continuam usando o rio aberto.
 */
export const CANYON_BOOM = (() => {
  const z = RIVER.z0 + 28, cx = riverCenterX(z), half = RIVER.width / 2 + 7;
  return { x: cx, z, half };
})();

export const buildWorld = (opts: { canyonClosed?: boolean } = {}): PhysicsWorld & { pier: PierLayout; rockList: SphereCollider[]; spawn: { x: number; z: number; heading: number } } => {
  const spheres: SphereCollider[] = [];
  const boxes: BoxCollider[] = [];

  // Píer na margem sul, apontando para o norte (dentro do lago)
  const shore = findShore(0, -1);
  const pier: PierLayout = { shoreX: shore.x, shoreZ: shore.z + 2, length: 34, width: 3.2, deckY: 1.1, dirX: 0, dirZ: 1 };
  boxes.push({
    minX: pier.shoreX - pier.width / 2, maxX: pier.shoreX + pier.width / 2,
    minY: -8, maxY: pier.deckY,
    minZ: pier.shoreZ - 6, maxZ: pier.shoreZ + pier.length,
  });

  // (as rochas redondas foram removidas a pedido do usuário: lago e margens livres)
  if (opts.canyonClosed) {
    const B = CANYON_BOOM;
    boxes.push({ minX: B.x - B.half, maxX: B.x + B.half, minY: -2.5, maxY: 0.7, minZ: B.z - 0.6, maxZ: B.z + 0.6 });
  }

  const spawn = { x: pier.shoreX + 9, z: pier.shoreZ + pier.length - 6, heading: 0 };
  return { groundHeight, spheres, boxes, trailers: [], pier, rockList: spheres, spawn };
};

export const isWater = (x: number, z: number): boolean => groundHeight(x, z) < -0.3;
export const slopeAt = (x: number, z: number): number => {
  const e = 1;
  return clamp(Math.hypot(groundHeight(x + e, z) - groundHeight(x - e, z), groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e), 0, 10);
};
