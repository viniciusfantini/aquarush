// Pátio no fim da estrada: posto de combustível (cobertura + 2 ilhas de bombas), loja de conveniência,
// oficina e vagas (onde fica o OUTRO veículo com o outro barco). Geometria em coordenadas do mundo, usada
// pela física do veículo (obstáculos) e pelo visual (presentation/station.ts).

import { LOT, PARK } from "./world.ts";

/** Retângulo orientado no plano XZ (yaw: rumo do eixo "comprimento", +Z = 0). */
export interface Obb { x: number; z: number; hw: number; hl: number; yaw: number }

/** Bombas de combustível (uma por ilha) e as faixas onde o veículo para ao lado delas. */
export interface Pump { x: number; z: number; lanes: number[] /* z do centro de cada faixa */ }

const L = LOT;
/** vagas ocupadas pelos conjuntos que não estão em uso */
const PARKED_STALLS = [0, 2, 3, 4, 5, 6, 7]; // (7 conjuntos fora de uso; a vaga 1 fica livre)
/** passo entre as vagas (m) — 8 vagas lado a lado entre o fundo do pátio e a cobertura do posto */
const STALL_W = 2.85;
const CAN = { x: L.cx + 15, z: L.cz + 10 };
/**
 * Pátio grande (76 × 50 m): posto perto da entrada (leste), loja e oficina no fundo (oeste), vaga do outro
 * conjunto ao sul e o miolo livre para manobrar o carro com a carretinha.
 */
export const STATION = {
  canopy: { x: CAN.x, z: CAN.z, w: 18, d: 18, h: 5.2 },          // cobertura do posto
  pumps: [
    { x: CAN.x, z: CAN.z + 3, lanes: [CAN.z + 5.2, CAN.z + 0.8] },
    { x: CAN.x, z: CAN.z - 3, lanes: [CAN.z - 0.8, CAN.z - 5.2] },
  ] as Pump[],
  islandLen: 4, islandW: 1.0,
  shop: { x: L.cx - 25, z: L.cz + 12, w: 12, d: 9, h: 3.6 },          // loja (porta para +X)
  workshop: { x: L.cx - 25, z: L.cz - 11, w: 12, d: 12, h: 5.0 },     // oficina (portões para +X)
  /** vagas dos outros seis conjuntos (veículo + carretinha, de frente para a saída, +X): vagas 0, 2, 3, 4, 5, 6 e 7 */
  parking: PARKED_STALLS.map((k) => ({ x: L.cx + 22, z: L.cz - 21 + k * STALL_W, yaw: Math.PI / 2 })),
  /** vagas longas (carro + carretinha), lado a lado ao sul; 0, 2, 3, 4, 5, 6 e 7 são dos outros conjuntos, a 1 fica livre */
  stalls: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ x: L.cx + 15, z: L.cz - 21 + k * STALL_W, len: 24, w: STALL_W })),
};

/** O veículo (com a carretinha) está estacionado dentro de uma vaga livre, alinhado e parado? (índice ou −1) */
export const parkedStall = (car: Obb, trailer: Obb, speed: number): number => {
  if (speed > 0.15 || Math.abs(Math.sin(car.yaw)) < 0.95) return -1;
  for (let k = 0; k < STATION.stalls.length; k++) {
    if (PARKED_STALLS.includes(k)) continue; // ocupadas pelos outros conjuntos
    const s = STATION.stalls[k];
    const inside = (o: Obb) => Math.abs(o.z - s.z) < s.w / 2 - 0.5 && Math.abs(o.x - s.x) < s.len / 2 - o.hl * 0.6;
    if (inside(car) && inside(trailer)) return k;
  }
  return -1;
};

/**
 * Frota de exposição no estacionamento de cima (só visual + obstáculo): cada uma na carretinha, engatada no
 * veículo de reboque, de frente para +X. (x, z) = centro do conjunto; len = comprimento total; w = largura.
 */
export type FleetKind = "jetski" | "pontoon" | "catamaran" | "cruiser50" | "offshore";
export const FLEET: { kind: FleetKind; label: string; x: number; z: number; len: number; w: number }[] = [
  { kind: "cruiser50", label: "Lancha cabinada 50 pés", x: PARK.cx - 20, z: PARK.cz - 3.6, len: 25, w: 4.6 },
  { kind: "offshore", label: "Lancha offshore", x: PARK.cx + 14, z: PARK.cz - 3.6, len: 19, w: 3.0 },
  { kind: "catamaran", label: "Catamarã fisher", x: PARK.cx - 22, z: PARK.cz + 3.8, len: 17, w: 3.0 },
  { kind: "pontoon", label: "Pontoon", x: PARK.cx + 1, z: PARK.cz + 3.8, len: 16, w: 2.7 },
  { kind: "jetski", label: "Jet ski", x: PARK.cx + 22, z: PARK.cz + 3.8, len: 9.5, w: 2.0 },
];

/** Obstáculos fixos para o veículo de reboque (prédios, ilhas das bombas, colunas da cobertura). */
export const stationObstacles = (): Obb[] => {
  const S = STATION, o: Obb[] = [];
  o.push({ x: S.shop.x, z: S.shop.z, hw: S.shop.w / 2, hl: S.shop.d / 2, yaw: 0 });
  o.push({ x: S.workshop.x, z: S.workshop.z, hw: S.workshop.w / 2, hl: S.workshop.d / 2, yaw: 0 });
  for (const p of S.pumps) o.push({ x: p.x, z: p.z, hw: S.islandLen / 2, hl: S.islandW / 2, yaw: 0 });
  const c = S.canopy;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.push({ x: c.x + sx * (c.w / 2 - 0.4), z: c.z + sz * (c.d / 2 - 0.4), hw: 0.2, hl: 0.2, yaw: 0 });
  for (const f of FLEET) o.push({ x: f.x, z: f.z, hw: f.len / 2, hl: f.w / 2, yaw: 0 }); // frota de exposição
  return o;
};

/** Separating Axis Theorem para dois retângulos orientados no plano. */
export const obbOverlap = (a: Obb, b: Obb): boolean => {
  const axes = (o: Obb): [number, number][] => [[Math.cos(o.yaw), -Math.sin(o.yaw)], [Math.sin(o.yaw), Math.cos(o.yaw)]];
  const corners = (o: Obb): [number, number][] => {
    const [[ux, uz], [vx, vz]] = axes(o); // u = largura (X local), v = comprimento (Z local)
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [o.x + ux * o.hw * i + vx * o.hl * j, o.z + uz * o.hw * i + vz * o.hl * j]);
  };
  const ca = corners(a), cb = corners(b);
  for (const [ax, az] of [...axes(a), ...axes(b)]) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const [x, z] of ca) { const p = x * ax + z * az; amin = Math.min(amin, p); amax = Math.max(amax, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; bmin = Math.min(bmin, p); bmax = Math.max(bmax, p); }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
};

export interface FuelBay { near: boolean; ok: boolean; pump: Pump | null; why: string }

/**
 * Parado corretamente ao lado da bomba: veículo paralelo à ilha (±20°), centro na faixa (±0,9 m) e na altura
 * da bomba (±3 m — a mangueira alcança), parado (< 0,15 m/s).
 */
export const fuelBayState = (car: { x: number; z: number; yaw: number }, speed: number): FuelBay => {
  let best: FuelBay = { near: false, ok: false, pump: null, why: "" };
  for (const p of STATION.pumps) {
    for (const lz of p.lanes) {
      const dx = car.x - p.x, dz = car.z - lz;
      if (Math.abs(dx) > 9 || Math.abs(dz) > 3) continue;
      const along = Math.abs(Math.sin(car.yaw)); // paralelo ao eixo X ⇒ |sen(yaw)| ≈ 1
      const angOk = along > Math.cos(20 * Math.PI / 180);
      const why = !angOk ? "endireite o carro (paralelo à bomba)" : Math.abs(dz) > 0.9 ? "encoste mais perto da bomba" : Math.abs(dx) > 3 ? (dx > 0 ? "pare um pouco antes" : "avance um pouco") : speed > 0.15 ? "pare o carro" : "";
      const cand: FuelBay = { near: true, ok: why === "", pump: p, why };
      if (!best.near || (cand.ok && !best.ok)) best = cand;
    }
  }
  return best;
};
