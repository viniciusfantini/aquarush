import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
declare const process: { argv: string[] };
const thr = Number(process.argv[2] ?? 1), steerT = Number(process.argv[3] ?? 25);
const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0;
const world = { groundHeight: () => -50, spheres: [], boxes: [] };
const b = new Speedboat(SPEEDBOAT, v3(0, 0.25, 0));
const DT = 1 / 120;
for (let i = 0; i < 120 * (steerT + 10); i++) {
  const t = i * DT;
  w.time += DT;
  b.step(DT, { ...emptyInput(), throttle: thr, steering: t > steerT ? 1 : 0 }, w, world);
  if (i % 60 === 0) { const T = b.telemetry; console.log(`t=${t.toFixed(1)} v=${T.speedKmh.toFixed(1)} pitch=${T.pitchDeg.toFixed(2)} roll=${T.rollDeg.toFixed(2)} yaw=${b.angVel.y.toFixed(2)} wet=${T.wetFraction.toFixed(2)} sub=${T.submergedPoints.map(x=>x?1:0).join("")} y=${b.pos.y.toFixed(3)}`); }
}
