// Diagnóstico: roll máximo no cenário de ondas fortes (teste 6) com diferentes cargas.
import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const world = { groundHeight: () => -50, spheres: [], boxes: [] };
const cases: [string, (b: Speedboat) => void][] = [
  ["piloto em boreste (padrão)", () => {}],
  ["piloto no centro (x=0)", (b) => { (b.params.seats as any).helm = v3(0, 0.42, -0.08); }],
  ["sem ocupantes", (b) => { b.occupants = []; }],
];
for (const [name, setup] of cases) {
  const params = structuredClone(SPEEDBOAT);
  const b = new Speedboat(params, v3(0, 0.25, 0));
  setup(b);
  const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 2.5;
  let maxRoll = 0, sum = 0, n = 0;
  for (let i = 0; i < 120 * 40; i++) { w.time += 1 / 120; b.step(1 / 120, { ...emptyInput(), gear: "F", throttle: 0.8, steering: 0.3 }, w, world); maxRoll = Math.max(maxRoll, Math.abs(b.telemetry.rollDeg)); sum += b.telemetry.rollDeg; n++; }
  console.log(`${name.padEnd(28)} roll máx=${maxRoll.toFixed(1)}° roll médio=${(sum / n).toFixed(2)}°`);
}
