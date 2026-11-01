// Âncora: lançar, unhar, segurar contra correnteza e motor, garrar com pouco cabo, recolher. node tests/debug-anchor.ts [lancha|bote]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { VESSELS, type VesselKind } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { buildWorld, groundHeight } from "../src/sim/world.ts";
import { BUOYS } from "../src/sim/mooring.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const kind = (process.argv[2] ?? "lancha") as VesselKind;
const P = VESSELS[kind];
const w = buildWorld();
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight }); water.intensity = 0.35;
const DT = 1 / 120;
const b = new Speedboat(P, v3(BUOYS[1].x + 15, 0.25, BUOYS[1].z + 15), 0);
console.log(`fundo ${(-groundHeight(b.pos.x, b.pos.z)).toFixed(1)} m`);
const run = (s: number, inp: Partial<ReturnType<typeof emptyInput>>, tag: string) => {
  let maxT = 0;
  for (let i = 0; i < s / DT; i++) { water.time += DT; b.step(DT, { ...emptyInput(), ...inp }, water, w); maxT = Math.max(maxT, b.anchor.tension); }
  const T = b.telemetry;
  console.log(`${tag.padEnd(28)} cabo ${T.anchorOut.toFixed(1)} m · ${T.anchorState} · prof ${T.anchorDepth.toFixed(1)} · filame ${T.anchorScope.toFixed(1)} · tração máx ${maxT.toFixed(0)} N · arou ${b.anchor.dragged.toFixed(1)} m · bat ${T.batteryA.toFixed(0)} A · v ${T.speedKmh.toFixed(1)} km/h · dist âncora ${Math.hypot(b.pos.x - b.anchor.pos.x, b.pos.z - b.anchor.pos.z).toFixed(1)} m`);
};
b.engine = "running";
run(6, { gear: "N", anchor: 1 }, "pagando 6 s");
run(10, { gear: "N", anchor: 1 }, "pagando +10 s");
run(15, { gear: "R" }, "ré lenta 15 s (unhar)");
run(10, { gear: "N" }, "parado 10 s");
run(10, { gear: "F", throttle: 0.4 }, "frente 40% contra");
run(5, { gear: "N" }, "N");
run(10, { gear: "R", throttle: 0.6 }, "ré 60% (puxando)");
run(5, { gear: "N" }, "N");
run(40, { gear: "N", anchor: -1 }, "recolhendo 40 s");
run(20, { gear: "N", anchor: -1 }, "recolhendo +20 s");
