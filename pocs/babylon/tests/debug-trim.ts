// Diagnóstico: forças por ponto em regime permanente para trim -1, 0, +1.
import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const world = { groundHeight: () => -50, spheres: [], boxes: [] };
for (const trim of [-1, 0, 1]) {
  const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0;
  const b = new Speedboat(SPEEDBOAT, v3(0, 0.25, 0));
  b.trim = trim; b.debugEnabled = true;
  for (let i = 0; i < 120 * 40; i++) { w.time += 1 / 120; b.step(1 / 120, { ...emptyInput(), throttle: 0.85 }, w, world); }
  const T = b.telemetry;
  console.log(`trim ${trim}: v=${T.speedKmh.toFixed(1)} pitch=${T.pitchDeg.toFixed(2)} wet=${T.wetFraction.toFixed(2)} thrust=${T.thrustN.toFixed(0)} vent=${T.ventilation.toFixed(2)} y=${b.pos.y.toFixed(3)}`);
  for (const f of b.debugForces) console.log(`   ${f.kind.padEnd(7)} y=${f.p.y.toFixed(3)} F=(${f.f.x.toFixed(0)}, ${f.f.y.toFixed(0)}, ${f.f.z.toFixed(0)})`);
}
