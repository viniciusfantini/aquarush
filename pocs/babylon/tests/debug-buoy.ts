// Poita com física: o barco passa por cima/encosta e amarra; a boia nunca pode entrar no casco.
// node tests/debug-buoy.ts [lancha|bote]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { VESSELS, type VesselKind } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { buildWorld, groundHeight } from "../src/sim/world.ts";
import { BuoyField } from "../src/sim/mooring.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3, rotateInv } from "../src/sim/math.ts";
const kind = (process.argv[2] ?? "lancha") as VesselKind;
const P = VESSELS[kind];
const w = buildWorld();
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight }); water.intensity = 0.35;
const DT = 1 / 120;
const field = new BuoyField();
const bz = field.buoys[1];
// inside = quanto a boia está dentro do contorno do casco (>0 = dentro)
const inside = (b: Speedboat) => {
  const L = rotateInv(b.rot, { x: bz.x - b.pos.x, y: 0, z: bz.z - b.pos.z }), half = P.length / 2;
  if (Math.abs(L.z) > half) return -1;
  const taper = L.z > half * 0.3 ? Math.max(0.15, 1 - (L.z - half * 0.3) / (half * 0.7)) : 1;
  return (P.beam / 2) * taper - Math.abs(L.x);
};
for (const scen of ["passa por cima a 8 km/h", "encosta devagar e amarra"]) {
  field.reset();
  const b = new Speedboat(P, v3(bz.x + 0.2, 0.25, bz.z - 16), 0);
  b.systems.fuelL = 20;
  let worst = -9, tied = -1;
  for (let i = 0; i < 50 / DT; i++) {
    const near = field.nearest(b);
    const fast = scen.startsWith("passa");
    const inp = { ...emptyInput(), gear: (fast || (near.dist > 2.5 && tied < 0) ? "F" : "N") as "F" | "N", throttle: fast ? 0.12 : 0, steering: 0 };
    water.time += DT; b.step(DT, inp, water, w); field.step(DT, b);
    if (!fast && near.ok && tied < 0 && near.buoy) { tied = i * DT; field.tie(b, near.buoy.id); }
    worst = Math.max(worst, inside(b));
  }
  const e = b.toWorld(P.contactPoints.reduce((a, c) => (c.z > a.z ? c : a)));
  console.log(`${kind} · ${scen}: boia mais dentro do casco ${worst.toFixed(2)} m (≤0 = nunca entrou) · amarrado ${tied >= 0 ? tied.toFixed(1) + " s" : "-"} · proa↔boia ${Math.hypot(e.x - bz.x, e.z - bz.z).toFixed(2)} m · boia a ${Math.hypot(bz.x - bz.x0, bz.z - bz.z0).toFixed(2)} m da poita`);
}
