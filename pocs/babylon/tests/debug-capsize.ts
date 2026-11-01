// Emborcamento: força o bote a virar e acompanha as pessoas na água. node tests/debug-capsize.ts
import { Speedboat } from "../src/sim/boat.ts";
import { DINGHY, PERSON_KG } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3, qFromAxisAngle } from "../src/sim/math.ts";
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 });
water.intensity = 0;
const world = { groundHeight: () => -50, spheres: [], boxes: [] };
const b = new Speedboat(DINGHY, v3(0, 0.2, 0));
b.occupants = [{ seat: "helm", mass: PERSON_KG }, { seat: "passenger", mass: PERSON_KG }];
const DT = 1 / 120;
const run = (s: number, each?: (t: number) => void) => { for (let i = 0; i < s / DT; i++) { water.time += DT; b.step(DT, emptyInput(), water, world); each?.(i * DT); } };
run(3);
b.rot = qFromAxisAngle(v3(0, 0, 1), 2.6); // ~150°: virado
run(10, (t) => { if (Math.round(t * 120) % 120 === 0) console.log(`t=${t.toFixed(0)} up.y=${b.up.y.toFixed(2)} y=${b.pos.y.toFixed(2)} capsized=${b.capsized} eng=${b.engine} occ=${b.occupants.length} swim=${b.swimmers.map((s) => s.pos.y.toFixed(2)).join(",")}`); });
const B = b;
const loc = B.swimmers.map((s) => { const dx = s.pos.x - B.pos.x, dz = s.pos.z - B.pos.z; return Math.hypot(dx, dz).toFixed(2); });
console.log("distância horizontal do centro do barco (m):", loc.join(", "));
for (let k = 0; k < 6; k++) { run(5); console.log(`+5s esforço=${B.swimmers.map((s) => s.swim.toFixed(2)).join(",")} dist=${B.swimmers.map((s) => Math.hypot(s.pos.x - B.pos.x, s.pos.z - B.pos.z).toFixed(2)).join(",")}`); }
{
  const f = B.forward, yawB = Math.atan2(f.x, f.z);
  for (const s of B.swimmers) {
    const ex = B.params.beam / 2 + 0.5, ez = B.params.length / 2 + 0.4;
    const lx = Math.sin(s.slot) * ex, lz = Math.cos(s.slot) * ez;
    const tx = B.pos.x + lx * Math.cos(yawB) + lz * Math.sin(yawB), tz = B.pos.z - lx * Math.sin(yawB) + lz * Math.cos(yawB);
    console.log(`seat=${s.seat} slot=${(s.slot * 57.3).toFixed(0)} pos=(${(s.pos.x - B.pos.x).toFixed(2)},${(s.pos.z - B.pos.z).toFixed(2)}) alvo=(${(tx - B.pos.x).toFixed(2)},${(tz - B.pos.z).toFixed(2)}) vel=(${s.vel.x.toFixed(2)},${s.vel.z.toFixed(2)}) boatvel=(${B.vel.x.toFixed(2)},${B.vel.z.toFixed(2)})`);
  }
}
