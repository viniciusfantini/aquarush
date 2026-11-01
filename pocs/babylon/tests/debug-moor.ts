// Atracar na vaga do píer e amarrar na poita (piloto simples). node tests/debug-moor.ts [lancha|bote]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { VESSELS, type VesselKind } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { buildWorld, groundHeight } from "../src/sim/world.ts";
import { pierBerth, pierBerthState, tieToPier, buoyState, tieToBuoy, BUOYS } from "../src/sim/mooring.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const kind = (process.argv[2] ?? "lancha") as VesselKind;
const P = VESSELS[kind];
const w = buildWorld();
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight }); water.intensity = 0.35;
const DT = 1 / 120;
const B = pierBerth(w.pier);
// vem do norte, paralelo ao píer, devagar, ~1 m afastado
const b = new Speedboat(P, v3(B.edgeX + P.beam / 2 + 0.9, 0.25, B.z + 14), Math.PI);
b.systems.fuelL = 20;
let tied = -1;
for (let i = 0; i < 40 / DT; i++) {
  const st = pierBerthState(b, w.pier);
  const along = b.pos.z - B.z;
  // piloto: lenta engatada até chegar, encostando aos poucos (leme para o píer = −X ⇒ rumo S: boreste)
  const gap = b.pos.x - B.edgeX - P.beam / 2;
  const inp = { ...emptyInput(), gear: (along > 7 ? "F" : "N") as "F" | "N", throttle: 0, steering: Math.max(-1, Math.min(1, (gap - 0.3) * 0.6 + Math.atan2(b.forward.x, -b.forward.z) * 2)) };
  water.time += DT; b.step(DT, inp, water, w);
  if (st.ok && tied < 0) { tied = i * DT; tieToPier(b, w.pier, st.side); }
  if (i % 240 === 0) console.log(`t=${(i * DT).toFixed(0)} along=${along.toFixed(1)} gap=${gap.toFixed(2)} v=${b.telemetry.speedKmh.toFixed(1)} ${st.near ? st.why || "OK" : "-"}`);
}
const gapF = b.pos.x - B.edgeX - P.beam / 2;
console.log(`píer: amarrado=${tied >= 0 ? tied.toFixed(1) + " s" : "NÃO"} folga final ${gapF.toFixed(2)} m, along ${(b.pos.z - B.z).toFixed(2)} m, casco ${(b.hullDamage * 100).toFixed(0)}%`);
// poita: solta, vai até a P2, encosta a proa devagar
b.mooringLines = [];
const buoy = BUOYS[1];
b.reset(v3(buoy.x, 0.25, buoy.z - 14), 0);
let tiedB = -1;
for (let i = 0; i < 60 / DT; i++) {
  const st = buoyState(b);
  const want = Math.atan2(buoy.x - b.pos.x, buoy.z - b.pos.z), yaw = Math.atan2(b.forward.x, b.forward.z);
  let err = want - yaw; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
  const inp = { ...emptyInput(), gear: (st.dist > 2.5 && tiedB < 0 ? "F" : "N") as "F" | "N", throttle: 0, steering: Math.max(-1, Math.min(1, err * 2)) };
  water.time += DT; b.step(DT, inp, water, w);
  if (st.ok && tiedB < 0) { tiedB = i * DT; tieToBuoy(b, buoy); }
}
const e = b.toWorld(P.contactPoints.reduce((a, c) => (c.z > a.z ? c : a)));
console.log(`poita: amarrado=${tiedB >= 0 ? tiedB.toFixed(1) + " s" : "NÃO"} proa a ${Math.hypot(e.x - buoy.x, e.z - buoy.z).toFixed(2)} m da poita após 60 s`);
