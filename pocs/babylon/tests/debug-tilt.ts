// Diagnóstico: tilt engatado em movimento (lenta) x em velocidade.
import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const world = { groundHeight: () => -50, spheres: [], boxes: [] };
for (const thr of [0, 0.15, 0.5]) {
  const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0;
  const b = new Speedboat(SPEEDBOAT, v3(0, 0.25, 0));
  b.trim = 1;
  for (let i = 0; i < 120 * 20; i++) { w.time += 1 / 120; b.step(1 / 120, { ...emptyInput(), gear: "F", throttle: thr }, w, world); }
  const v0 = b.telemetry.speedKmh;
  for (let i = 0; i < 120 * 3; i++) { w.time += 1 / 120; b.step(1 / 120, { ...emptyInput(), gear: "F", throttle: thr, trim: 1 }, w, world); }
  const T = b.telemetry;
  console.log(`engatado acel=${thr}: vel=${v0.toFixed(1)} km/h rpm=${T.rpm.toFixed(0)} → tilt após 3 s segurando trim+ = ${T.tiltDeg.toFixed(0)}° ${T.tiltBlocked ? "(bloqueado)" : ""}`);
}
