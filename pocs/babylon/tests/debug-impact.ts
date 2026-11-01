// Calibração das avarias: pico de força de contato em cenários normais e em batidas. node tests/debug-impact.ts
import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT, DINGHY, PERSON_KG, type SpeedboatParams } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { buildWorld, RAMP, type PhysicsWorld } from "../src/sim/world.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); water.intensity = 0;
const DT = 1 / 120;
const scen = (name: string, P: SpeedboatParams, world: PhysicsWorld, pos: { x: number; z: number }, heading: number, v: number, thr: number, secs: number) => {
  const b = new Speedboat(P, v3(pos.x, 0.25, pos.z), heading);
  b.occupants = [{ seat: "helm", mass: PERSON_KG }];
  b.vel = v3(Math.sin(heading) * v, 0, Math.cos(heading) * v);
  let peak = 0, sum = 0, n = 0;
  for (let i = 0; i < secs / DT; i++) { water.time += DT; b.step(DT, { ...emptyInput(), gear: "F", throttle: thr }, water, world); peak = Math.max(peak, b.impactN); if (b.impactN > 0) { sum += b.impactN; n++; } }
  console.log(`${name.padEnd(42)} pico ${(peak / 1000).toFixed(1)} kN  (massa ${b.totalMass.toFixed(0)} kg, pico/peso ${(peak / (b.totalMass * 9.81)).toFixed(1)})`);
};
const w = buildWorld();
const flatWorld: PhysicsWorld = { groundHeight: () => -0.6, spheres: [], boxes: [] };
const rockWorld: PhysicsWorld = { groundHeight: () => -50, spheres: [{ x: 0, y: 0, z: 30, r: 3 }], boxes: [] };
for (const P of [SPEEDBOAT, DINGHY]) {
  const k = P.kind;
  scen(`${k}: encalhar devagar na rampa (4 km/h)`, P, w, { x: RAMP.x, z: RAMP.z0 + 14 }, Math.PI, 1.1, 0.05, 15);
  scen(`${k}: encalhar na praia a 15 km/h`, P, w, { x: 30, z: RAMP.z0 + 14 }, Math.PI, 4.2, 0.2, 10);
  scen(`${k}: raspar o fundo raso a 30 km/h`, P, flatWorld, { x: 0, z: 0 }, 0, 8.3, 0.6, 3);
  scen(`${k}: bater na pedra a 15 km/h`, P, rockWorld, { x: 0, z: 20 }, 0, 4.2, 0.2, 4);
  scen(`${k}: bater na pedra a 40 km/h`, P, rockWorld, { x: 0, z: 10 }, 0, 11, 0.8, 3);
}
// avarias resultantes
const dmg = (name: string, P: SpeedboatParams, world: PhysicsWorld, pos: { x: number; z: number }, heading: number, v: number, thr: number, secs: number) => {
  const b = new Speedboat(P, v3(pos.x, 0.25, pos.z), heading);
  b.vel = v3(Math.sin(heading) * v, 0, Math.cos(heading) * v);
  for (let i = 0; i < secs / DT; i++) { water.time += DT; b.step(DT, { ...emptyInput(), gear: "F", throttle: thr }, water, world); }
  console.log(`${name.padEnd(42)} casco ${(b.hullDamage * 100).toFixed(0)}%  motor ${(b.engineDamage * 100).toFixed(0)}%`);
};
const shallow: PhysicsWorld = { groundHeight: () => -0.75, spheres: [], boxes: [] };
for (const P of [SPEEDBOAT, DINGHY]) {
  const k = P.kind;
  dmg(`${k}: encalhar na praia a 15 km/h`, P, w, { x: 30, z: RAMP.z0 + 14 }, Math.PI, 4.2, 0.2, 10);
  dmg(`${k}: raso (0,75 m) a 30 km/h`, P, shallow, { x: 0, z: 0 }, 0, 8.3, 0.6, 3);
  dmg(`${k}: bater na pedra a 15 km/h`, P, rockWorld, { x: 0, z: 20 }, 0, 4.2, 0.2, 4);
  dmg(`${k}: bater na pedra a 40 km/h`, P, rockWorld, { x: 0, z: 10 }, 0, 11, 0.8, 3);
}
