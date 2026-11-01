// Forma do casco da lancha (seções) — fonte única para o visual (presentation/boatMesh.ts) e para a
// hidrostática (volume submerso por linha d'água, volume alagável sob o piso). Sem Babylon.
//
// Convenção: local do barco, X boreste, Y cima, Z proa. Casco de Z_STERN (espelho) a Z_BOW (bico).

import { smoothstep } from "./math.ts";

export const Z_STERN = -2.95;
export const Z_BOW = 3.2;
export const halfBeam = (z: number) => z <= 0 ? 1.13 - 0.06 * (z / Z_STERN) : 1.13 * Math.pow(Math.max(0, 1 - (z / Z_BOW) ** 2.3), 0.55);
export const keelY = (z: number) => -0.47 + 0.62 * Math.pow(smoothstep(0.6, Z_BOW, z), 1.7);
export const chineY = (z: number) => -0.25 + 0.55 * Math.pow(smoothstep(1.0, Z_BOW, z), 1.5);
export const sheerY = (z: number) => 0.44 + 0.2 * Math.pow(smoothstep(-0.5, Z_BOW, z), 2.2);

/** Contorno externo de meia seção, da quilha à borda (y crescente): fundo em V → quina → costado com flare. */
export const halfOutline = (z: number): [number, number][] => {
  const hb = Math.max(halfBeam(z), 0.001), k = keelY(z), s = sheerY(z), c = Math.min(chineY(z), s - 0.03), ch = hb * 0.93;
  const p: [number, number][] = [[0, k], [ch, c]];
  const xl = ch + 0.03 * (hb / 1.13), yl = c + 0.015;
  p.push([xl, yl]);
  for (let i = 1; i <= 16; i++) { const t = i / 16; p.push([xl + (hb - xl) * (1 - (1 - t) ** 2.2), yl + (s - yl) * t]); }
  return p;
};

/** Área da seção (m²) abaixo da altura y (sem nada acima da borda). */
export const sectionAreaBelow = (z: number, y: number): number => {
  const p = halfOutline(z);
  let A = 0;
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i];
    const yb = Math.min(y1, y);
    if (yb <= y0) break;
    const xb = x0 + (x1 - x0) * ((yb - y0) / Math.max(1e-9, y1 - y0));
    A += (yb - y0) * (x0 + xb); // largura 2x, trapézio
  }
  return A;
};

/** Volume do casco abaixo da altura y (m³), entre z0 e z1. */
export const hullVolumeBelow = (y: number, z0 = Z_STERN, z1 = Z_BOW, n = 160): number => {
  let V = 0;
  for (let i = 0; i < n; i++) V += sectionAreaBelow(z0 + (z1 - z0) * (i + 0.5) / n, y);
  return (V * (z1 - z0)) / n;
};

/**
 * Tabela nível → litros alagáveis sob o piso: o porão ocupa o fundo do casco, mas tanque, longarinas e
 * espuma tomam parte (`frac` = fração livre). Do espelho até a antepara do paiol de proa (zFwd).
 */
export const floodTable = (floorY: number, frac: number, zFwd: number, step = 0.02): { levels: number[]; liters: number[] } => {
  const levels: number[] = [], liters: number[] = [];
  const k0 = keelY(Z_STERN);
  for (let y = k0; y <= floorY + 1e-6; y += step) { levels.push(y); liters.push(frac * hullVolumeBelow(y, Z_STERN, zFwd) * 1000); }
  return { levels, liters };
};
