// Lancha no ponto de partida: profundidade, calado e se o pé do motor toca o fundo ao acelerar.
import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT, DINGHY } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { buildWorld, groundHeight } from "../src/sim/world.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const w = buildWorld();
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight }); water.intensity = 0.35;
console.log(`partida (${w.spawn.x}, ${w.spawn.z}): profundidade ${(-groundHeight(w.spawn.x, w.spawn.z)).toFixed(2)} m`);
for (const P of [SPEEDBOAT, DINGHY]) {
  const b = new Speedboat(P, v3(w.spawn.x, 0.25, w.spawn.z), w.spawn.heading);
  let minClear = 9, firstHit = -1;
  for (let i = 0; i < 25 * 120; i++) {
    water.time += 1 / 120;
    b.step(1 / 120, { ...emptyInput(), gear: i > 240 ? "F" : "N", throttle: i > 240 ? 1 : 0 }, water, w);
    const tip = b.lowerUnitTip(), clear = tip.y - groundHeight(tip.x, tip.z);
    if (clear < minClear) minClear = clear;
    if (clear < 0 && firstHit < 0) firstHit = i / 120;
  }
  console.log(`${P.kind}: folga mínima pé↔fundo ${minClear.toFixed(2)} m ${firstHit >= 0 ? `(TOCA o fundo em ${firstHit.toFixed(1)} s)` : ""} · avaria motor ${(b.engineDamage * 100).toFixed(0)}% casco ${(b.hullDamage * 100).toFixed(0)}% · calado ${b.telemetry.draftHull.toFixed(2)} / pé ${b.telemetry.draftMotor.toFixed(2)}`);
}
