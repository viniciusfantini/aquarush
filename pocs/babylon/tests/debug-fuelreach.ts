// Até onde cada barco vai com X litros (rota píer → rio), em dois aceleradores. node tests/debug-fuelreach.ts
import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT, DINGHY } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { buildWorld, RIVER, RIVER_CURRENT, riverCenterX, groundHeight } from "../src/sim/world.ts";
import { CANYON_END } from "../src/sim/mooring.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const w = buildWorld();
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight, currents: [RIVER_CURRENT] }); water.intensity = 0.35;
const route: [number, number][] = [];
for (let z = w.spawn.z; z <= RIVER.z0; z += 10) route.push([w.spawn.x + (riverCenterX(RIVER.z0) - w.spawn.x) * ((z - w.spawn.z) / (RIVER.z0 - w.spawn.z)), z]);
for (let z = RIVER.z0; z <= CANYON_END.z + 30; z += 8) route.push([riverCenterX(z), z]);
for (const [P, fuels] of [[SPEEDBOAT, [0.25, 0.27]], [DINGHY, [0.05, 0.055]]] as const) {
  for (const fuel of fuels) {
    const out: string[] = [];
    for (const thr of [0.3, 0.6, 1]) {
      const b = new Speedboat(P, v3(w.spawn.x, 0.25, w.spawn.z), 0);
      b.systems.fuelL = fuel;
      let idx = 0;
      for (let i = 0; i < 400 * 120 && b.telemetry.engine !== "off"; i++) {
        while (idx < route.length - 1 && Math.hypot(route[idx][0] - b.pos.x, route[idx][1] - b.pos.z) < 15) idx++;
        const [tx, tz] = route[idx];
        let err = Math.atan2(tx - b.pos.x, tz - b.pos.z) - Math.atan2(b.forward.x, b.forward.z);
        while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
        water.time += 1 / 120; b.step(1 / 120, { ...emptyInput(), gear: "F", throttle: thr, steering: Math.max(-1, Math.min(1, err * 1.5)) }, water, w);
      }
      for (let i = 0; i < 20 * 120; i++) { water.time += 1 / 120; b.step(1 / 120, emptyInput(), water, w); } // deriva até parar
      out.push(`acel ${thr}: z=${b.pos.z.toFixed(0)}${b.pos.z > RIVER.z0 ? " (dentro do cânion)" : " (NÃO chegou à entrada)"}`);
    }
    console.log(`${P.kind} ${fuel} L → ${out.join(" · ")}   [entrada z=${RIVER.z0}, fim z=${CANYON_END.z}]`);
  }
}
