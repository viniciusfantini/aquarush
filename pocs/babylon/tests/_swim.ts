import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { v3 } from "../src/sim/math.ts";
import { TowTube } from "../src/sim/towTube.ts";
const world = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0.2;
const t = new TowTube({ shoreX: 0, shoreZ: -40, length: 28, width: 2.4, deckY: 0.55, dirX: 0, dirZ: 1 });
t.docked = false; t.pos = v3(0, 0.1, 0); t.rider = "water"; t.riderPos = v3(30, 0, 0); t.riderVel = v3(5, 0, 0);
for (let i = 0; i < 40 * 120; i++) { w.time += 1 / 120; t.step(1 / 120, w, world); if (i % 600 === 0) console.log(`${i / 120}s ${t.rider} swim ${t.swimming} pos ${t.riderPos.x.toFixed(1)},${t.riderPos.z.toFixed(1)} vel ${t.riderVel.x.toFixed(2)} tube v ${Math.hypot(t.vel.x, t.vel.z).toFixed(2)}`); }
