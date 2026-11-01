// Pátio no fim da estrada: posto de combustível (cobertura + 2 ilhas de bombas), loja de conveniência,
// oficina e vagas (onde fica o OUTRO veículo com o outro barco). Geometria em coordenadas do mundo, usada
// pela física do veículo (obstáculos) e pelo visual (presentation/station.ts).

import { LOT } from "./world.ts";

/** Retângulo orientado no plano XZ (yaw: rumo do eixo "comprimento", +Z = 0). */
export interface Obb { x: number; z: number; hw: number; hl: number; yaw: number }

/** Bombas de combustível (uma por ilha) e as faixas onde o veículo para ao lado delas. */
export interface Pump { x: number; z: number; lanes: number[] /* z do centro de cada faixa */ }

const L = LOT;
export const STATION = {
  canopy: { x: L.cx + 10, z: L.cz + 9, w: 16, d: 16, h: 5.2 },          // cobertura do posto
  pumps: [
    { x: L.cx + 10, z: L.cz + 12, lanes: [L.cz + 14.2, L.cz + 9] },
    { x: L.cx + 10, z: L.cz + 6, lanes: [L.cz + 9, L.cz + 3.8] },
  ] as Pump[],
  islandLen: 4, islandW: 1.0,
  shop: { x: L.cx - 16, z: L.cz + 11, w: 12, d: 9, h: 3.6 },             // loja (porta para +X)
  workshop: { x: L.cx - 16, z: L.cz - 7, w: 12, d: 12, h: 5.0 },         // oficina (portões para +X)
  /** vaga do outro veículo + carretinha (de frente para a saída, +X) */
  parking: { x: L.cx + 17, z: L.cz - 10, yaw: Math.PI / 2 },
};

/** Obstáculos fixos para o veículo de reboque (prédios, ilhas das bombas, colunas da cobertura). */
export const stationObstacles = (): Obb[] => {
  const S = STATION, o: Obb[] = [];
  o.push({ x: S.shop.x, z: S.shop.z, hw: S.shop.w / 2, hl: S.shop.d / 2, yaw: 0 });
  o.push({ x: S.workshop.x, z: S.workshop.z, hw: S.workshop.w / 2, hl: S.workshop.d / 2, yaw: 0 });
  for (const p of S.pumps) o.push({ x: p.x, z: p.z, hw: S.islandLen / 2, hl: S.islandW / 2, yaw: 0 });
  const c = S.canopy;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.push({ x: c.x + sx * (c.w / 2 - 0.4), z: c.z + sz * (c.d / 2 - 0.4), hw: 0.2, hl: 0.2, yaw: 0 });
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
