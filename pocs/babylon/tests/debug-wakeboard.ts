// Wakeboard: saída da água, velocidade, pulos/manobras na esteira, quedas e pegar o manete de novo.
// node tests/debug-wakeboard.ts [acelerador] [lastro 0..1]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { WAKEBOAT } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { WakeField } from "../src/sim/wake.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
import { Wakeboard } from "../src/sim/wakeboard.ts";
const DT = 1 / 120, world = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
const thr = Number(process.argv[2] ?? "0.6"), bal = Number(process.argv[3] ?? "1");
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); water.intensity = 0.2;
const pier = { shoreX: 0, shoreZ: -40, length: 28, width: 2.4, deckY: 0.55, dirX: 0, dirZ: 1 };
const wb = new Wakeboard(pier); const W = wb.waitPos();
const b = new Speedboat(WAKEBOAT, v3(W.x + 3, 0.3, W.z + 8)); b.systems.fuelL = 150;
b.ballastL = WAKEBOAT.ballast!.tanks.map((t) => t.maxL * bal);
const f = new WakeField();
console.log("engatou:", wb.hook(b), wb.state);
const run = (s: number, inp: object, tag: string, each?: () => void) => {
  let tMax = 0;
  for (let i = 0; i < s / DT; i++) { water.time += DT; b.step(DT, { ...emptyInput(), gear: "F", ...inp }, water, world); f.update(DT, b); wb.step(DT, water, world, f); tMax = Math.max(tMax, wb.tension); each?.(); }
  console.log(`${tag}: barco ${b.telemetry.speedKmh.toFixed(0)} km/h · ${wb.state} · ${(wb.speed * 3.6).toFixed(0)} km/h · lado ${wb.offset.toFixed(1)} m · corda ${wb.tension.toFixed(0)} N (máx ${tMax.toFixed(0)}) · pulos ${wb.jumps} (máx ${wb.maxAir.toFixed(2)} m, último ${wb.lastTrick}) · quedas ${wb.falls} ${wb.lastFall}`);
};
run(4, { gear: "N" }, "parado (ela afundada)");
run(6, { throttle: 0.05 }, "esticando a corda");
let tStand = -1, t = 0;
run(12, { throttle: thr }, `acelera ${thr}`, () => { t += DT; if (tStand < 0 && wb.state === "riding") tStand = t; });
console.log(`  em pé em ${tStand.toFixed(1)} s depois de acelerar`);
const tricks: Record<string, number> = {};
let last = wb.jumps;
run(60, { throttle: thr }, "andando 60 s", () => { if (wb.jumps !== last) { last = wb.jumps; tricks[wb.lastTrick] = (tricks[wb.lastTrick] ?? 0) + 1; } });
console.log("  manobras:", JSON.stringify(tricks));
// ---- caiu: o barco volta devagar passando com a corda perto dela ----
{
  const w2 = new Wakeboard(pier); const b2 = new Speedboat(WAKEBOAT, v3(0, 0.3, 0)); b2.systems.fuelL = 100;
  w2.hook(b2); w2.state = "fallen"; w2.pos = v3(0, 0, 0); (w2 as unknown as { docked: boolean }).docked = false;
  // barco 40 m ao sul do ponto, indo para o norte, passando 1,5 m ao lado dela
  b2.pos = v3(1.5, 0.3, -45); w2.handle = v3(1.5, 0, -65);
  let grabbed = -1, t = 0, closest = 1e9;
  for (let i = 0; i < 60 / DT; i++) {
    water.time += DT; b2.step(DT, { ...emptyInput(), gear: "F", throttle: 0 }, water, world); w2.step(DT, water, world, null); t += DT;
    closest = Math.min(closest, Math.hypot(w2.handle.x - w2.pos.x, w2.handle.z - w2.pos.z));
    if (grabbed < 0 && (w2.state as string) === "water") grabbed = t;
  }
  console.log(`regrab: barco em lenta ${(Math.hypot(b2.vel.x, b2.vel.z) * 3.6).toFixed(1)} km/h · manete passou a ${closest.toFixed(1)} m · pegou em ${grabbed.toFixed(1)} s · estado ${w2.state}`);
}
