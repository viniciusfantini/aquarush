// Diagnóstico: curva e soltar o volante — a guinada deve morrer sem inverter de lado.
import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3, approach } from "../src/sim/math.ts";
declare const process: { argv: string[] };
const thr = Number(process.argv[2] ?? 0.5);
const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0;
const world = { groundHeight: () => -50, spheres: [], boxes: [] };
const b = new Speedboat(SPEEDBOAT, v3(0, 0.25, 0));
const DT = 1 / 120;
let steer = 0;
for (let i = 0; i < 120 * 32; i++) {
  const t = i * DT;
  // teclado: rampa de 2.8/s ao segurar, volta a 0 com 4/s
  const target = t > 20 && t < 23 ? 1 : 0;
  steer = approach(steer, target, (target === 0 ? 4 : 2.8) * DT);
  w.time += DT;
  b.step(DT, { ...emptyInput(), gear: "F", throttle: thr, steering: steer }, w, world);
  if (t > 19.5 && i % 30 === 0) {
    const T = b.telemetry;
    const heading = Math.atan2(b.forward.x, b.forward.z) * 57.3;
    const vdir = Math.atan2(b.vel.x, b.vel.z) * 57.3;
    console.log(`t=${t.toFixed(2)} steer=${steer.toFixed(2)} δ=${T.steerDeg.toFixed(1)} yawRate=${(b.angVel.y * 57.3).toFixed(1)}°/s roll=${T.rollDeg.toFixed(1)} rumo=${heading.toFixed(1)} deriva=${(heading - vdir).toFixed(1)} v=${T.speedKmh.toFixed(0)}`);
  }
}
