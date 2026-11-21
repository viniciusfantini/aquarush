// Long-tail tailandês AR-T: partida diesel (com/sem velas), turbo, velocidade, eixo levantado, curva.
// node tests/debug-longtail.ts [acelerador] [pessoas]
import { Speedboat } from "../src/sim/boat.ts";
import { LONGTAIL, PERSON_KG, type SeatId } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
declare const process: { argv: string[] };
const DT = 1 / 120, world = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
const thr = Number(process.argv[2] ?? 1), people = Number(process.argv[3] ?? 1);
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); water.intensity = 0;
const mk = () => {
  const b = new Speedboat(LONGTAIL, v3(0, 0.15, 0));
  b.occupants = (["helm", ...Array.from({ length: people - 1 }, (_, i) => `p${i + 1}`)] as SeatId[]).map((seat) => ({ seat, mass: PERSON_KG }));
  return b;
};
const f1 = (x: number, d = 1) => x.toFixed(d);
const line = (b: Speedboat, t: number) => {
  const T = b.telemetry, D = T.diesel;
  return `t ${f1(t)} · ${f1(T.speedKmh, 0)} km/h · ${f1(T.rpm, 0)} rpm · turbo ${D ? f1(T.boostBar, 2) : "-"} bar · fumaça ${D ? f1(D.soot, 2) : "-"} · empuxo ${f1(T.thrustN, 0)} N · imersão ${f1(T.propImmersion, 2)} · arf ${f1(T.pitchDeg)}° rol ${f1(T.rollDeg)}° · eixo ${f1(T.tiltDeg)}° · ${f1(T.coolantC, 0)} °C${b.capsized ? " VIROU" : ""}`;
};
const go = (b: Speedboat, s: number, inp: Partial<ReturnType<typeof emptyInput>>, every = 2, t0 = 0) => {
  let t = t0;
  for (let i = 0; i < s / DT; i++) { water.time += DT; t += DT; b.step(DT, { ...emptyInput(), gear: "F", ...inp }, water, world); if (every > 0 && Math.abs(t / every - Math.round(t / every)) < DT / 2 / every) console.log(line(b, t)); }
  return t;
};
// partida a frio pelo P (pré-aquece) e sem esperar as velas (chave direto em START)
{
  const b = mk(); b.engine = "off"; b.coldEngines(); b.systems.coolantC = 22;
  const r = b.toggleIgnition(); let tRun = -1, t = 0;
  for (let i = 0; i < 12 / DT && tRun < 0; i++) { t += DT; b.step(DT, { ...emptyInput(), gear: "F" }, water, world); if ((b.engine as string) === "running") tRun = t; }
  console.log(`P a frio: ${r} → pegou em ${f1(tRun)} s (pré-aquecimento ${f1(b.glowNeed)} s)`);
  const c = mk(); c.engine = "off"; c.coldEngines(); c.systems.coolantC = 22;
  c.setKey(0, "on"); c.setKey(0, "start"); let t2 = -1; t = 0;
  for (let i = 0; i < 12 / DT && t2 < 0; i++) { t += DT; c.step(DT, { ...emptyInput(), gear: "F" }, water, world); if ((c.engine as string) === "running") t2 = t; }
  console.log(`chave direto em START a frio (sem velas): pegou em ${f1(t2)} s · fumaça branca ${f1(c.telemetry.diesel?.white ?? 0, 2)}`);
}
console.log(`== acelerador ${thr}, ${people} pessoas`);
const b = mk(); b.engine = "running";
let t = go(b, 30, { throttle: thr });
console.log("== curva (cana 60 %)");
t = go(b, 8, { throttle: thr, steering: 0.6 }, 1, t);
console.log("== reto, levanta o eixo (E) 0,5 s");
t = go(b, 4, { throttle: thr }, 0, t);
t = go(b, 0.5, { throttle: thr, trim: 1 }, 0.25, t);
t = go(b, 4, { throttle: thr }, 2, t);
console.log("== solta o acelerador");
go(b, 8, { throttle: 0 }, 2, t);
