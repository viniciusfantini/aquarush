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
export const ISLAND = { x: 140, z: 70, r: 48 };
/** Canal de rio que desemboca no lago pelo norte (com correnteza). */
export const RIVER = { z0: 170, z1: 760, width: 34 };
export const riverCenterX = (z: number): number => -60 + 38 * Math.sin(z / 95);

/** Distância normalizada ao contorno do lago (1 = margem). */
const lakeR = (x: number, z: number): number =>
  Math.hypot(x / LAKE.rx, z / LAKE.rz) + 0.11 * fbm(x / 140 + 7.3, z / 140 - 2.1, 3);

const baseGround = (x: number, z: number): number => {
  const r = lakeR(x, z);
  const hills = 6 + 22 * (0.5 + 0.5 * fbm(x / 210, z / 210, 4));
  let h = -7 + 6.2 * smoothstep(0.5, 1.0, r) + 2.6 * smoothstep(1.0, 1.14, r) + hills * smoothstep(1.12, 1.75, r);
  h += 0.6 * fbm(x / 25, z / 25, 2) * smoothstep(0.9, 1.2, r); // irregularidade das margens

  // ilha
  const di = Math.hypot(x - ISLAND.x, z - ISLAND.z) / ISLAND.r;
  const island = 7 * (1 - smoothstep(0.0, 1.0, di)) - 2.2 + 1.5 * fbm(x / 18, z / 18, 2);
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

export const groundHeight = (x: number, z: number): number => {
  const b = baseGround(x, z);
  const s = z - RAMP.z0, lat = Math.abs(x - RAMP.x);
  if (lat > RAMP.width / 2 + RAMP.shoulder || s < RAMP.sMin - 6 || s > RAMP.sMax + 6) return b;
  const r = rampY(clamp(s, RAMP.sMin, RAMP.sMax));
  const wLat = 1 - smoothstep(RAMP.width / 2, RAMP.width / 2 + RAMP.shoulder, lat);
  const wLon = 1 - smoothstep(0, 6, s < RAMP.sMin ? RAMP.sMin - s : s > RAMP.sMax ? s - RAMP.sMax : 0);
  return b + (r - b) * wLat * wLon;
};

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

export const buildWorld = (): PhysicsWorld & { pier: PierLayout; rockList: SphereCollider[]; spawn: { x: number; z: number; heading: number } } => {
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

  // Rochas: na margem, algumas dentro do lago e um grupo na foz do rio
  const rand = rng(1337);
  const tryRock = (x: number, z: number, r: number) => {
    const g = groundHeight(x, z);
    if (Math.hypot(x - pier.shoreX, z - (pier.shoreZ + pier.length / 2)) < 28) return; // livre perto do píer
    if (Math.hypot(x - RAMP.x, z - RAMP.z0) < 30) return; // e da rampa
    spheres.push({ x, y: g + r * 0.35, z, r });
  };
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2;
    const rr = 0.9 + rand() * 0.16;
    const x = Math.sin(a) * LAKE.rx * rr, z = Math.cos(a) * LAKE.rz * rr;
    tryRock(x, z, 1.5 + rand() * 3.5);
  }
  for (let i = 0; i < 9; i++) {
    const x = (rand() * 2 - 1) * 220, z = (rand() * 2 - 1) * 150;
    if (Math.hypot(x, z - shore.z) < 60) continue;
    tryRock(x, z, 2 + rand() * 2.5);
  }
  for (let i = 0; i < 10; i++) {
    const z = RIVER.z0 + 40 + rand() * 300;
    const x = riverCenterX(z) + (rand() * 2 - 1) * RIVER.width * 0.5;
    tryRock(x, z, 1.2 + rand() * 1.6);
  }

  const spawn = { x: pier.shoreX + 9, z: pier.shoreZ + pier.length - 6, heading: 0 };
  return { groundHeight, spheres, boxes, trailers: [], pier, rockList: spheres, spawn };
};

export const isWater = (x: number, z: number): boolean => groundHeight(x, z) < -0.3;
export const slopeAt = (x: number, z: number): number => {
  const e = 1;
  return clamp(Math.hypot(groundHeight(x + e, z) - groundHeight(x - e, z), groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e), 0, 10);
};
