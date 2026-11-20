// Parasail: decolagem do píer, altura, tensão, corda solta (descida), queda e decolagem da água.
// node tests/debug-parasail.ts [acelerador] [acelerador_lento]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput, type VehicleInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
import { Parasail } from "../src/sim/parasail.ts";
const DT = 1 / 120;
const thr = Number(process.argv[2] ?? "0.5"), slow = Number(process.argv[3] ?? "0.12");
const pier = { shoreX: 0, shoreZ: -40, length: 30, width: 3, deckY: 1.3, dirX: 0, dirZ: 1 };
const gh = (x: number, z: number) => (z < -40 ? 2 : -20); void 0;
const world = { groundHeight: gh, spheres: [], boxes: [] } as never;
const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: gh }); w.intensity = 0.2;
const mk = () => { const ps = new Parasail(pier); const L = ps.launchPos();
  const b = new Speedboat(SPEEDBOAT, v3(L.x + 3, 0.25, L.z + 9)); b.systems.fuelL = 60; b.occupants = [{ seat: "helm", mass: 80 }]; return { ps, b }; };
const run = (ps: Parasail, b: Speedboat, s: number, inp: Partial<VehicleInput>, tag: string) => {
  let tMax = 0, altMax = 0;
  for (let i = 0; i < s / DT; i++) { w.time += DT; b.step(DT, { ...emptyInput(), gear: "F", ...inp }, w, world); ps.step(DT, w, world);
    tMax = Math.max(tMax, ps.tension); altMax = Math.max(altMax, ps.altitude); }
  console.log(`${tag}: barco ${b.telemetry.speedKmh.toFixed(0)} km/h · ${ps.state} alt ${ps.altitude.toFixed(1)} m (máx ${altMax.toFixed(1)}) · vel ${(Math.hypot(ps.vel.x, ps.vel.z) * 3.6).toFixed(0)} km/h vy ${ps.vel.y.toFixed(1)} · velame ${(ps.infl * 100).toFixed(0)}% · corda ${ps.tension.toFixed(0)} N (máx ${tMax.toFixed(0)}) · quedas ${ps.splashes} (${ps.lastSplashV.toFixed(1)} m/s)`);
};
{ const { ps, b } = mk(); console.log("engatou:", ps.hook(b));
  run(ps, b, 10, { throttle: 0.05 }, "esticando a corda devagar");
  run(ps, b, 25, { throttle: thr }, `acelera a ${thr * 100}%`);
  for (let k = 0; k < 3; k++) run(ps, b, 5, { throttle: thr }, "  voando");
  run(ps, b, 10, { throttle: thr, steering: 0.4 }, "curva no ar");
  ps.unhook(); console.log("SOLTOU a corda no ar");
  let sink = 0, n = 0; for (let i = 0; i < 20 / DT; i++) { w.time += DT; b.step(DT, { ...emptyInput(), gear: "N" }, w, world); ps.step(DT, w, world); if (ps.state === "air" && ps.altitude < 15 && ps.altitude > 3) { sink += ps.vel.y; n++; } }
  console.log(`descida de paraquedas: ${(sink / Math.max(1, n)).toFixed(2)} m/s; estado ${ps.state}, quedas ${ps.splashes}, tocou a ${ps.lastSplashV.toFixed(1)} m/s`); }
{ const { ps, b } = mk(); ps.hook(b);
  run(ps, b, 10, { throttle: 0.05 }, "LENTO: esticando");
  run(ps, b, 20, { throttle: slow }, `LENTO a ${slow * 100}%`);
  run(ps, b, 25, { throttle: 1 }, "acelera da água a toda"); }
