import { smoothstep } from "../src/sim/math.ts";
const Z_STERN = -2.95, Z_BOW = 3.2;
const halfBeam = (z: number) => z <= 0 ? 1.13 - 0.06 * (z / Z_STERN) : 1.13 * Math.pow(Math.max(0, 1 - (z / Z_BOW) ** 2.3), 0.55);
const keelY = (z: number) => -0.47 + 0.62 * Math.pow(smoothstep(0.6, Z_BOW, z), 1.7);
const chineY = (z: number) => -0.25 + 0.55 * Math.pow(smoothstep(1.0, Z_BOW, z), 1.5);
const sheerY = (z: number) => 0.44 + 0.2 * Math.pow(smoothstep(-0.5, Z_BOW, z), 2.2);
const half = (z: number): [number, number][] => {
  const hb = Math.max(halfBeam(z), 0.001), k = keelY(z), s = sheerY(z), c = Math.min(chineY(z), s - 0.03), ch = hb * 0.93;
  const p: [number, number][] = [[0, k], [ch, c]];
  const xl = ch + 0.03 * (hb / 1.13), yl = c + 0.015;
  p.push([xl, yl]);
  for (let i = 1; i <= 16; i++) { const t = i / 16; p.push([xl + (hb - xl) * (1 - (1 - t) ** 2.2), yl + (s - yl) * t]); }
  return p;
};
const area = (z: number, yw: number) => { const p = half(z); let A = 0; for (let i = 1; i < p.length; i++) { const [x0, y0] = p[i - 1], [x1, y1] = p[i]; if (y0 >= yw) break; const ya = y0, yb = Math.min(y1, yw); if (yb <= ya) { continue; } const xb = x0 + (x1 - x0) * ((yb - y0) / Math.max(1e-9, y1 - y0)); A += (yb - ya) * (x0 + xb) / 2; if (y1 > yw) { break; } } return 2 * A; };
// área abaixo de yw = ∫ largura(y) dy, onde x(y) é o contorno: integrar "largura total" em y
const areaW = (z: number, yw: number) => { const p = half(z); let A = 0; for (let i = 1; i < p.length; i++) { const [x0, y0] = p[i - 1], [x1, y1] = p[i]; const yb = Math.min(y1, yw); if (yb <= y0) break; const xb = x0 + (x1 - x0) * ((yb - y0) / Math.max(1e-9, y1 - y0)); A += (yb - y0) * (x0 + xb); } // largura = 2x; trapézio: (yb-y0)*(2x0+2xb)/2
  // acima do último ponto (sheer) não há casco
  return A; };
const vol = (yw: number) => { let V = 0; const N = 300; for (let i = 0; i < N; i++) { const z = Z_STERN + (Z_BOW - Z_STERN) * (i + 0.5) / N; V += areaW(z, yw) * (Z_BOW - Z_STERN) / N; } return V; };
for (const yw of [-0.3, -0.25, -0.237, -0.2, -0.15, -0.1, 0, 0.1, 0.2, 0.3, 0.44, 0.5, 0.64]) {
  const box = 10 * Math.min(Math.max(0, yw + 0.35), 0.85);
  console.log(`linha d'água y=${yw.toFixed(3)}  volume real ${vol(yw).toFixed(3)} m³  modelo de pontos ${box.toFixed(3)} m³`);
}
// cockpit alagável (dentro do costado interno, do piso 0.02 até a borda), z de -2.45 a 1.15
const inBeam = (z: number) => Math.max(0.25, halfBeam(z) - 0.16);
let Vc = 0; for (let i = 0; i < 200; i++) { const z = -2.45 + 3.6 * (i + 0.5) / 200; Vc += 2 * inBeam(z) * (sheerY(z) - 0.02) * 3.6 / 200; }
console.log("cockpit até a borda:", Vc.toFixed(2), "m³");
