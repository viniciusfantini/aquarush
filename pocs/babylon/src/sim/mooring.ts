// Amarração: vaga de atracação no píer (cabos de proa e popa nos cunhos) e poitas (boias de amarração
// fundeadas, do lado oposto ao da rampa, em ~2 m de água). Os cabos são molas só de tração aplicadas pela
// física do barco (Speedboat.mooringLines) — o barco fica preso mas ainda balança com ondas e correnteza.

import type { Speedboat } from "./boat.ts";
import type { SpeedboatParams } from "./params.ts";
import { type PierLayout, RIVER, riverCenterX } from "./world.ts";
import { clamp, rotateInv, type Vec3 } from "./math.ts";

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

/** meia-largura que encosta no píer: o costado — ou, no ekranoplano, a ponta da asa (o flutuador encosta na defensa) */
export const halfWidth = (P: SpeedboatParams): number => (P.wing ? P.wing.span / 2 : P.beam / 2);

/** Barco na posição certa da vaga do píer: paralelo, encostado (folga ≤ ~0,8 m), centralizado e devagar. */
export const pierBerthState = (b: Speedboat, pier: PierLayout): BerthState => {
  const B = pierBerth(pier), P = b.params;
  const f = b.forward, fl = Math.hypot(f.x, f.z) || 1;
  const parallel = Math.abs(f.z / fl);                      // 1 = paralelo ao píer (rumo N ou S)
  const gap = b.pos.x - B.edgeX - halfWidth(P);             // folga entre o costado (ekranoplano: a ponta da asa) e o píer
  const along = b.pos.z - B.z;
  const speed = Math.hypot(b.vel.x, b.vel.z);
  const near = gap > -0.5 && gap < 6 && Math.abs(along) < B.len;
  const why = parallel < Math.cos(12 * Math.PI / 180) ? "fique paralelo ao píer" : gap > (P.wing ? 1.5 : 0.8) ? "encoste mais no píer" : Math.abs(along) > 2.5 ? (along * f.z < 0 ? "avance um pouco" : "recue um pouco") : speed > 0.9 ? "devagar…" : ""; // atracação real: ≤ ~3 km/h
  // lado do barco que encosta no píer (o píer fica a −X do barco no mundo)
  const r = b.right;
  const side = r.x < 0 ? 1 : -1;  // +1: o píer está do lado de boreste do barco
  return { near, ok: near && why === "", why, side };
};

/**
 * Largada na vaga do píer: proa para o norte (para o lago), costado de bombordo a ~25 cm do píer (o píer fica a −X).
 * É ali que os passageiros esperam para embarcar (a lotação só muda com o barco atracado na vaga).
 */
export const berthStartPose = (pier: PierLayout, P: SpeedboatParams): { pos: Vec3; heading: number; side: number } => {
  const B = pierBerth(pier);
  // (ekranoplano: o flutuador da ponta fica ~0,8 m longe dos pilares — encostado, a asa raspa neles e gira o barco)
  return { pos: { x: B.edgeX + halfWidth(P) + (P.wing ? 0.8 : 0.25), y: 0.25, z: B.z }, heading: 0, side: -1 };
};

/** Pontos do píer onde os passageiros esperam em pé (mundo), ao lado da vaga, virados para o barco. */
export const pierWaitSpots = (pier: PierLayout): { x: number; y: number; z: number; yaw: number }[] => {
  const B = pierBerth(pier);
  return [0, 1, 2, 3].map((i) => ({ x: B.edgeX - 0.75 - (i % 2) * 0.55, y: B.deckY, z: B.z + [2.4, 1.5, -1.5, -2.4][i], yaw: Math.PI / 2 }));
};

/** Amarra na vaga do píer: cabo de proa e de popa até os cunhos do píer (folga de ~10 cm). */
export const tieToPier = (b: Speedboat, pier: PierLayout, side: number): void => {
  const B = pierBerth(pier), P = b.params;
  const lines: MooringLine[] = [];
  for (const zl of [P.length * 0.32, -P.length * 0.36]) {
    // (ekranoplano: o cabo vai da ponta da asa, no flutuador)
    const local = P.wing ? { x: side * (P.wing.span / 2 - 0.05), y: -0.05, z: P.wing.floats[0].pos.z + (zl > 0 ? 0.7 : -0.7) } : { x: side * P.beam * 0.46, y: P.kind === "lancha" ? 0.42 : 0.3, z: zl };
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

/**
 * Poitas com física: boia leve (30 kg) presa por corrente de 2 m a uma poita (peso) no fundo. Forças: corrente
 * (só tração além do comprimento), arrasto da água, empurrão do casco (a boia nunca entra no barco: é afastada
 * para o lado mais próximo do costado) e a tração do cabo de amarração (reação ao cabo do barco).
 * Os cabos do barco amarrado na poita usam a posição ATUAL da boia como âncora.
 */
export interface BuoyBody { id: string; kind: "mooring" | "red" | "green"; x0: number; z0: number; x: number; z: number; vx: number; vz: number; chain: number }

/**
 * Balizamento do canal do cânion (rio, da boca no lago até o fim): pares de boias laterais a cada 60 m,
 * VERMELHA à direita de quem SOBE o rio (vindo do lago, sistema IALA B usado no Brasil) e VERDE à esquerda.
 */
export const CHANNEL_MARKERS: { id: string; kind: "red" | "green"; x: number; z: number }[] = (() => {
  const out: { id: string; kind: "red" | "green"; x: number; z: number }[] = [];
  let n = 1;
  for (let z = RIVER.z0 - 20; z <= RIVER.z1 - 20; z += 60) {
    const cx = riverCenterX(z);
    out.push({ id: "V" + n, kind: "red", x: cx + 10, z }, { id: "G" + n, kind: "green", x: cx - 10, z });
    n++;
  }
  return out;
})();
/** Fim do cânion: onde o jogo de verdade começa (largada). */
export const CANYON_END = { x: riverCenterX(RIVER.z1 - 10), z: RIVER.z1 - 10 };

export class BuoyField {
  readonly buoys: BuoyBody[] = [
    ...BUOYS.map((b) => ({ id: b.id, kind: "mooring" as const, x0: b.x, z0: b.z, x: b.x, z: b.z, vx: 0, vz: 0, chain: 2.0 })),
    ...CHANNEL_MARKERS.map((b) => ({ id: b.id, kind: b.kind, x0: b.x, z0: b.z, x: b.x, z: b.z, vx: 0, vz: 0, chain: 1.5 })),
  ];
  static readonly CHAIN = 2.0;
  static readonly R = 0.35;     // raio da boia
  static readonly MASS = 30;

  /** id da poita onde o barco está amarrado ("" = nenhuma) */
  mooredTo = "";

  get(id: string) { return this.buoys.find((b) => b.id === id); }

  step(dt: number, boat: Speedboat): void {
    const P = boat.params;
    for (const b of this.buoys) {
      let fx = 0, fz = 0;
      // corrente até a poita do fundo
      const dx = b.x - b.x0, dz = b.z - b.z0, d = Math.hypot(dx, dz);
      if (d > b.chain) { const k = 4000 * (d - b.chain); fx -= (dx / d) * k; fz -= (dz / d) * k; }
      // arrasto da água
      fx -= 90 * b.vx; fz -= 90 * b.vz;
      // cabo do barco amarrado nesta boia: puxa a boia em direção ao olhal de proa
      if (this.mooredTo === b.id && boat.mooringLines.length) {
        const ml = boat.mooringLines[0];
        const eye = boat.toWorld(ml.local);
        const lx = eye.x - b.x, lz = eye.z - b.z, ll = Math.hypot(lx, lz);
        if (ll > ml.length) { const k = Math.min(6000, 2500 * (ll - ml.length)); fx += (lx / ll) * k; fz += (lz / ll) * k; }
      }
      b.vx += (fx / BuoyField.MASS) * dt; b.vz += (fz / BuoyField.MASS) * dt;
      // casco × boia: contato por mola (a boia é afastada para o lado mais próximo do costado) com REAÇÃO no
      // barco — com a corrente esticada a boia segura o casco (não é arrastada nem atravessada)
      const L = rotateInv(boat.rot, { x: b.x - boat.pos.x, y: 0, z: b.z - boat.pos.z });
      const half = P.length / 2;
      let cfx = 0, cfz = 0;
      if (Math.abs(L.z) < half + BuoyField.R) {
        const taper = L.z > half * 0.3 ? clamp(1 - (L.z - half * 0.3) / (half * 0.7), 0.15, 1) : 1;
        const hw = (P.beam / 2) * taper + BuoyField.R;
        if (Math.abs(L.x) < hw) {
          const s = Math.sign(L.x) || 1;
          const penX = hw - Math.abs(L.x), penZ = half + BuoyField.R - Math.abs(L.z);
          const r = boat.right, f = boat.forward;
          const rl = Math.hypot(r.x, r.z) || 1, fl = Math.hypot(f.x, f.z) || 1;
          // proa em V: na metade da frente a boia sempre escorrega para o lado (e um pouco para a frente)
          let nx: number, nz: number, pen: number;
          if (L.z > 0 || penX <= penZ) {
            const fw = L.z > 0 ? 0.5 : 0;
            const ux = (r.x / rl) * s + (f.x / fl) * fw, uz = (r.z / rl) * s + (f.z / fl) * fw, ul = Math.hypot(ux, uz);
            nx = ux / ul; nz = uz / ul; pen = penX;
          } else { nx = (f.x / fl) * Math.sign(L.z); nz = (f.z / fl) * Math.sign(L.z); pen = penZ; }
          const bv = boat.pointVelocity({ x: b.x, y: boat.pos.y, z: b.z });
          const vrel = (b.vx - bv.x) * nx + (b.vz - bv.z) * nz;
          const fn = Math.max(0, 20000 * pen - 600 * vrel);
          cfx = nx * fn; cfz = nz * fn;
          boat.externalForces.push({ p: { x: b.x, y: boat.pos.y - 0.1, z: b.z }, f: { x: -cfx, y: 0, z: -cfz } });
        }
      }
      b.vx += (cfx / BuoyField.MASS) * dt; b.vz += (cfz / BuoyField.MASS) * dt;
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (this.mooredTo === b.id && boat.mooringLines.length) boat.mooringLines[0].anchor = { x: b.x, y: 0, z: b.z };
    }
  }

  /** boia mais próxima da proa e se dá para amarrar (proa a ≤ 2 m da boia, devagar) */
  nearest(boat: Speedboat): { buoy: BuoyBody | null; dist: number; ok: boolean } {
    const e = boat.toWorld(bowEye(boat));
    let best: BuoyBody | null = null, bd = Infinity;
    for (const y of this.buoys) { if (y.kind !== "mooring") continue; const d = Math.hypot(e.x - y.x, e.z - y.z); if (d < bd) { bd = d; best = y; } }
    return { buoy: best, dist: bd, ok: bd < 2.0 && Math.hypot(boat.vel.x, boat.vel.z) < 1.0 };
  }

  tie(boat: Speedboat, id: string): void {
    const b = this.get(id);
    if (!b) return;
    tieToBuoy(boat, b);
    this.mooredTo = id;
  }
  release(): void { this.mooredTo = ""; }
  reset(): void { for (const b of this.buoys) { b.x = b.x0; b.z = b.z0; b.vx = b.vz = 0; } this.mooredTo = ""; }
}
