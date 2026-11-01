import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0;
const world = { groundHeight: () => -50, spheres: [], boxes: [] };
const b = new Speedboat(SPEEDBOAT, v3(0, 0.25, 0));
b.debugEnabled = true;
const DT = 1 / 120;
for (let i = 0; i < 120 * 30; i++) { w.time += DT; b.step(DT, { ...emptyInput(), throttle: 1, steering: i*DT > 20 ? 1 : 0 }, w, world); }
console.log("u", b.telemetry.waterSpeed, "up", b.up, "fwd", b.forward, "pos", b.pos, "gear", b.gear);
const sum: Record<string, {x:number,y:number,z:number}> = {};
for (const f of b.debugForces) { const s = sum[f.kind] ??= {x:0,y:0,z:0}; s.x+=f.f.x; s.y+=f.f.y; s.z+=f.f.z; }
console.log(sum);
for (const f of b.debugForces.filter(f=>f.kind==="buoy"||f.kind==="lift")) console.log(f.kind, f.p.y.toFixed(3), f.f.x.toFixed(0), f.f.y.toFixed(0), f.f.z.toFixed(0));
