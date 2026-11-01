// Largada amarrada na vaga do píer: o barco fica parado, sem encostar no fundo nem avariar? node tests/debug-berthstart.ts
import { Speedboat } from "../src/sim/boat.ts";
import { VESSELS, type VesselKind, PERSON_KG } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { buildWorld, groundHeight } from "../src/sim/world.ts";
import { berthStartPose, tieToPier, pierBerthState } from "../src/sim/mooring.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
const w = buildWorld();
for (const kind of ["lancha", "bote"] as VesselKind[]) {
  const P = VESSELS[kind];
  const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight }); water.intensity = 0.35;
  const s = berthStartPose(w.pier, P);
  const b = new Speedboat(P, s.pos, s.heading);
  b.occupants = Object.keys(P.seats).map((seat) => ({ seat: seat as keyof typeof P.seats, mass: PERSON_KG }));
  tieToPier(b, w.pier, s.side);
  let minDepth = 9;
  for (let i = 0; i < 30 * 120; i++) { water.time += 1 / 120; b.step(1 / 120, { ...emptyInput(), gear: "N" }, water, w); minDepth = Math.min(minDepth, b.telemetry.depth); }
  const st = pierBerthState(b, w.pier);
  console.log(`${kind}: fundo sob o barco ${groundHeight(s.pos.x, s.pos.z).toFixed(2)} m · prof. mín ${minDepth.toFixed(2)} m · deslocou ${Math.hypot(b.pos.x - s.pos.x, b.pos.z - s.pos.z).toFixed(2)} m · casco ${(b.hullDamage * 100).toFixed(0)}% motor ${(b.engineDamage * 100).toFixed(0)}% · vaga ${st.ok ? "ok" : st.why}`);
}
