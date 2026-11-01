// Consumo por km de cada barco (melhor acelerador) e comprimento da rota píer → fim do cânion.
import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT, DINGHY } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
import { RIVER, riverCenterX, buildWorld } from "../src/sim/world.ts";
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); water.intensity = 0.35;
const world = { groundHeight: () => -50, spheres: [], boxes: [] };
for (const P of [SPEEDBOAT, DINGHY]) {
  let best = { thr: 0, lpk: 1e9, kmh: 0 };
  for (const thr of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1]) {
    const b = new Speedboat(P, v3(0, 0.25, 0), 0);
    for (let i = 0; i < 30 * 120; i++) { water.time += 1 / 120; b.step(1 / 120, { ...emptyInput(), gear: "F", throttle: thr }, water, world); }
    const kmh = b.telemetry.speedKmh, lph = b.telemetry.fuelLph;
    const lpk = lph / Math.max(kmh, 0.1);
    console.log(`${P.kind} acel ${thr}: ${kmh.toFixed(1)} km/h, ${lph.toFixed(1)} L/h → ${lpk.toFixed(3)} L/km`);
    if (lpk < best.lpk) best = { thr, lpk, kmh };
  }
  console.log(`>> ${P.kind}: melhor ${best.lpk.toFixed(3)} L/km a ${best.kmh.toFixed(0)} km/h (acel ${best.thr})`);
}
const w = buildWorld();
let L = 0, px = w.spawn.x, pz = w.spawn.z;
const pts: [number, number][] = [];
for (let z = w.spawn.z; z <= RIVER.z0; z += 10) pts.push([px + (riverCenterX(RIVER.z0) - px) * ((z - w.spawn.z) / (RIVER.z0 - w.spawn.z)), z]);
for (let z = RIVER.z0; z <= RIVER.z1; z += 5) pts.push([riverCenterX(z), z]);
for (const [x, z] of pts) { L += Math.hypot(x - px, z - pz); px = x; pz = z; }
console.log(`rota píer → fim do cânion: ${(L / 1000).toFixed(2)} km (rio ${(RIVER.z1 - RIVER.z0)} m com correnteza de 1,6 m/s contra)`);
