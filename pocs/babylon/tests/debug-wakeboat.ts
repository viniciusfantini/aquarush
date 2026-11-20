// Lancha de wakeboard AR-8: velocidade, lastro (tempo de encher, calado) e tamanho da esteira com/sem lastro.
// node tests/debug-wakeboat.ts
import { Speedboat } from "../src/sim/boat.ts";
import { WAKEBOAT } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { WakeField } from "../src/sim/wake.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const DT = 1 / 120, world = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); water.intensity = 0;
const run = (ballast: boolean, thr: number, s: number) => {
  const b = new Speedboat(WAKEBOAT, v3(0, 0.3, 0)); b.systems.fuelL = 100;
  const f = new WakeField();
  if (ballast) { b.ballastCmd = 1; let t = 0; while ((b.ballastCmd as number) !== 0 && t < 300) { b.step(DT, { ...emptyInput(), gear: "N" }, water, world); t += DT; } console.log(`  lastro cheio em ${t.toFixed(0)} s (${b.ballastL.reduce((a, v) => a + v, 0).toFixed(0)} L)`); }
  for (let i = 0; i < s / DT; i++) { water.time += DT; b.step(DT, { ...emptyInput(), gear: "F", throttle: thr }, water, world); f.update(DT, b); }
  // maior marola da esteira 15–25 m atrás (onde o wakeboarder anda)
  let hm = 0; const fw = b.forward, r = b.right;
  for (let d = 12; d <= 25; d += 0.5) for (let x = -8; x <= 8; x += 0.25) { const px = b.pos.x - fw.x * d + r.x * x, pz = b.pos.z - fw.z * d + r.z * x; hm = Math.max(hm, Math.abs(f.heightAtYoung(px, pz))); }
  return { kmh: b.telemetry.speedKmh, hm };
};
const top = run(false, 1, 40); console.log(`a toda: ${top.kmh.toFixed(0)} km/h`);
for (const thr of [0.4, 0.55, 0.7]) { const a = run(false, thr, 25), c = run(true, thr, 25); console.log(`acel ${thr}: sem lastro ${a.kmh.toFixed(0)} km/h onda ${(a.hm * 100).toFixed(0)} cm · com lastro ${c.kmh.toFixed(0)} km/h onda ${(c.hm * 100).toFixed(0)} cm`); }
