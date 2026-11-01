// Amarração: vaga de atracação no píer (cabos de proa e popa nos cunhos) e poitas (boias de amarração
// fundeadas, do lado oposto ao da rampa, em ~2 m de água). Os cabos são molas só de tração aplicadas pela
// física do barco (Speedboat.mooringLines) — o barco fica preso mas ainda balança com ondas e correnteza.

import type { Speedboat } from "./boat.ts";
import type { PierLayout } from "./world.ts";
import type { Vec3 } from "./math.ts";

export interface MooringLine { anchor: Vec3; local: Vec3; length: number }

/** Poitas (boias de amarração) a leste do píer, onde a água passa de 2 m. */
export const BUOYS: { id: string; x: number; z: number }[] = [
  { id: "P1", x: 16, z: -203 }, { id: "P2", x: 32, z: -198 }, { id: "P3", x: 48, z: -203 },
];

/** Vaga no lado leste da ponta do píer (≈1 m de água). */
export const pierBerth = (pier: PierLayout) => ({
  edgeX: pier.shoreX + pier.width / 2,  // face do píer onde o barco encosta
  z: pier.shoreZ + pier.length - 7,      // meio da vaga
  len: 8,                                // comprimento marcado no píer
  deckY: pier.deckY,
});

const bowEye = (b: Speedboat): Vec3 => b.params.contactPoints.reduce((a, c) => (c.z > a.z ? c : a));

export interface BerthState { near: boolean; ok: boolean; why: string; side: number }

/** Barco na posição certa da vaga do píer: paralelo, encostado (folga ≤ ~0,8 m), centralizado e devagar. */
export const pierBerthState = (b: Speedboat, pier: PierLayout): BerthState => {
  const B = pierBerth(pier), P = b.params;
  const f = b.forward, fl = Math.hypot(f.x, f.z) || 1;
  const parallel = Math.abs(f.z / fl);                      // 1 = paralelo ao píer (rumo N ou S)
  const gap = b.pos.x - B.edgeX - P.beam / 2;               // folga entre o costado e o píer
  const along = b.pos.z - B.z;
  const speed = Math.hypot(b.vel.x, b.vel.z);
  const near = gap > -0.5 && gap < 6 && Math.abs(along) < B.len;
  const why = parallel < Math.cos(12 * Math.PI / 180) ? "fique paralelo ao píer" : gap > 0.8 ? "encoste mais no píer" : Math.abs(along) > 2.5 ? (along * f.z < 0 ? "avance um pouco" : "recue um pouco") : speed > 0.9 ? "devagar…" : ""; // atracação real: ≤ ~3 km/h
  // lado do barco que encosta no píer (o píer fica a −X do barco no mundo)
  const r = b.right;
  const side = r.x < 0 ? 1 : -1;  // +1: o píer está do lado de boreste do barco
  return { near, ok: near && why === "", why, side };
};

/** Amarra na vaga do píer: cabo de proa e de popa até os cunhos do píer (folga de ~10 cm). */
export const tieToPier = (b: Speedboat, pier: PierLayout, side: number): void => {
  const B = pierBerth(pier), P = b.params;
  const lines: MooringLine[] = [];
  for (const zl of [P.length * 0.32, -P.length * 0.36]) {
    const local = { x: side * P.beam * 0.46, y: P.kind === "lancha" ? 0.42 : 0.3, z: zl };
    const w = b.toWorld(local);
    const anchor = { x: B.edgeX, y: B.deckY, z: w.z };
    lines.push({ anchor, local, length: Math.hypot(w.x - anchor.x, w.y - anchor.y, w.z - anchor.z) + 0.1 });
  }
  b.mooringLines = lines;
};

/** Poita mais próxima da proa (e se dá para amarrar: proa a ≤ 2 m, devagar). */
export const buoyState = (b: Speedboat): { buoy: (typeof BUOYS)[number] | null; dist: number; ok: boolean } => {
  const e = b.toWorld(bowEye(b));
  let best: (typeof BUOYS)[number] | null = null, bd = Infinity;
  for (const y of BUOYS) { const d = Math.hypot(e.x - y.x, e.z - y.z); if (d < bd) { bd = d; best = y; } }
  const speed = Math.hypot(b.vel.x, b.vel.z);
  return { buoy: best, dist: bd, ok: bd < 2.0 && speed < 1.0 };
};

/** Amarra a proa na poita (cabo de ~3 m: o barco "gira" em volta dela com o vento/correnteza). */
export const tieToBuoy = (b: Speedboat, buoy: { x: number; z: number }): void => {
  const local = bowEye(b);
  const w = b.toWorld(local);
  const anchor = { x: buoy.x, y: 0, z: buoy.z };
  b.mooringLines = [{ anchor, local: { ...local }, length: Math.max(3, Math.hypot(w.x - anchor.x, w.y, w.z - anchor.z)) }];
};
