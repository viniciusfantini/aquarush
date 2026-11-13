// Boia rebocada: tensão da corda, velocidade, queda nas curvas e no pulo, volta nadando. node tests/debug-boia.ts [acelerador] [volante]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { SPEEDBOAT } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput, type VehicleInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
import { TowTube } from "../src/sim/towTube.ts";
const world = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
const DT = 1 / 120;
const thr = Number(process.argv[2] ?? "0.6"), steerTurn = Number(process.argv[3] ?? "0.6");
const pier = { shoreX: 0, shoreZ: -40, length: 28, width: 2.4, deckY: 0.55, dirX: 0, dirZ: 1 };
const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0.2;
const tube = new TowTube(pier);
const d = tube.dockPos();
const b = new Speedboat(SPEEDBOAT, v3(d.x, 0.25, d.z + 4)); b.systems.fuelL = 60; b.occupants = [{ seat: "helm", mass: 80 }];
console.log("engatou:", tube.hook(b), "pessoa:", tube.rider);
const run = (s: number, inp: Partial<VehicleInput>, tag: string) => {
  let tMax = 0, latMax = 0, air = 0;
  for (let i = 0; i < s / DT; i++) { w.time += DT; b.step(DT, { ...emptyInput(), gear: "F", ...inp }, w, world); tube.step(DT, w, world);
    tMax = Math.max(tMax, tube.tension); latMax = Math.max(latMax, Math.abs(tube.latAcc)); if (tube.airborne) air += DT; }
  const tv = Math.hypot(tube.vel.x, tube.vel.z) * 3.6;
  console.log(`${tag}: barco ${b.telemetry.speedKmh.toFixed(0)} km/h · boia ${tv.toFixed(0)} km/h · tensão ${tube.tension.toFixed(0)} N (máx ${tMax.toFixed(0)}) · lat máx ${(latMax / 9.81).toFixed(2)} g · no ar ${air.toFixed(1)} s · pessoa ${tube.rider} · quedas ${tube.falls} ${tube.lastFall}`);
};
run(3, { throttle: 0 }, "lenta saindo do píer");
run(20, { throttle: thr }, `reta a ${thr * 100}%`);
run(6, { throttle: thr, steering: steerTurn }, `curva volante ${steerTurn}`);
run(6, { throttle: thr, steering: 0 }, "reta de novo");
run(12, { throttle: 0, gear: "N" }, "parou (neutro)");
{ let tBack = -1; const t0 = performance.now(); void t0;
  for (let i = 0; i < 120 / DT; i++) { w.time += DT; b.step(DT, { ...emptyInput(), gear: "N" }, w, world); tube.step(DT, w, world); if (tBack < 0 && tube.rider === "tube" && tube.falls > 0) tBack = i * DT; if (i % 1200 === 0) console.log(`   ${(i * DT).toFixed(0)}s ${tube.rider} nada ${tube.swimming} boia ${Math.hypot(tube.vel.x, tube.vel.z).toFixed(2)} m/s dist ${Math.hypot(tube.riderPos.x - tube.pos.x, tube.riderPos.z - tube.pos.z).toFixed(1)}`); }
  console.log(`esperando: a pessoa voltou para a boia em ${tBack.toFixed(0)} s (estado ${tube.rider}, ${Math.hypot(tube.riderPos.x - tube.pos.x, tube.riderPos.z - tube.pos.z).toFixed(1)} m da boia)`); }
run(15, { throttle: thr }, "o passeio continua");
