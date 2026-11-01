// Vento: deriva, banda e giro do barco parado em cada nível; âncora segurando. node tests/debug-wind.ts [lancha|bote]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { VESSELS, type VesselKind } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { Wind, WIND_LEVELS } from "../src/sim/wind.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const kind = (process.argv[2] ?? "lancha") as VesselKind;
const P = VESSELS[kind];
const DT = 1 / 120;
for (let L = 0; L < WIND_LEVELS.length; L++) {
  const wind = new Wind(); wind.setLevel(L);
  const world = { groundHeight: () => -4, spheres: [], boxes: [], wind: wind.v };
  const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -4 }); water.intensity = 0;
  const b = new Speedboat(P, v3(0, 0.25, 0), 0);
  let maxRoll = 0;
  for (let i = 0; i < 60 / DT; i++) { wind.update(DT); world.wind = wind.v; water.time += DT; b.step(DT, { ...emptyInput(), gear: "N" }, water, world); if (i * DT > 5) maxRoll = Math.max(maxRoll, Math.abs(b.telemetry.rollDeg)); }
  const drift = Math.hypot(b.vel.x, b.vel.z);
  const yaw = Math.atan2(b.forward.x, b.forward.z) * 57.3;
  // ancorado: 20 m de cabo em 4 m (filame ~4,5:1)
  const a = new Speedboat(P, v3(0, 0.25, 0), wind.dirTo + Math.PI);
  let dragged = 0, maxT = 0;
  for (let i = 0; i < 40 / DT; i++) { wind.update(DT); world.wind = wind.v; water.time += DT; a.step(DT, { ...emptyInput(), gear: "N", anchor: a.anchor.out < 20 ? 1 : 0 }, water, world); }
  const d0 = a.anchor.dragged;
  for (let i = 0; i < 60 / DT; i++) { wind.update(DT); world.wind = wind.v; water.time += DT; a.step(DT, { ...emptyInput(), gear: "N" }, water, world); maxT = Math.max(maxT, a.anchor.tension); }
  dragged = a.anchor.dragged - d0;
  console.log(`${WIND_LEVELS[L].key.padEnd(11)} vento ${wind.speed.toFixed(1)} m/s · deriva ${drift.toFixed(2)} m/s (${(drift * 3.6).toFixed(1)} km/h) · banda máx ${maxRoll.toFixed(1)}° · rumo ${yaw.toFixed(0)}° · ancorado: ${a.anchor.state}, tração máx ${maxT.toFixed(0)} N, arou ${dragged.toFixed(2)} m`);
}
