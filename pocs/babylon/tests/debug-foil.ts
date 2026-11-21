// Barco elétrico com foils AR-E: decolagem, altura de voo, potência, curva, pouso e modo casco (foils recolhidos).
// node tests/debug-foil.ts [acelerador] [pessoas]
import { Speedboat } from "../src/sim/boat.ts";
import { FOILER, PERSON_KG, type SeatId } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const DT = 1 / 120, world = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
declare const process: { argv: string[] };
const thr = Number(process.argv[2] ?? 0.7), people = Number(process.argv[3] ?? 13);
const waves = process.argv[4] ?? "calma";
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); water.intensity = waves === "calma" ? 0 : 1;
const mk = (foils: boolean) => {
  const b = new Speedboat(FOILER, v3(0, 0.2, 0));
  const seats: SeatId[] = ["helm", ...Array.from({ length: people - 1 }, (_, i) => `p${i + 1}` as SeatId)];
  b.occupants = seats.map((seat) => ({ seat, mass: PERSON_KG }));
  b.foilDeploy = foils ? 1 : 0; b.foilDown = foils;
  return b;
};
const f1 = (x: number, d = 1) => x.toFixed(d);
const line = (b: Speedboat, t: number) => {
  const T = b.telemetry, F = T.foil!, H = T.hv!;
  return `t ${f1(t)} s · ${f1(T.speedKmh, 0)} km/h · altura ${f1(F.rideH, 2)} m (alvo ${F.target}) · voando ${F.foilborne ? "S" : "n"} · arf ${f1(T.pitchDeg)}° rol ${f1(T.rollDeg)}° · flaps ${f1(F.flapL * 57.3)}/${f1(F.flapR * 57.3)}/${f1(F.flapRear * 57.3)}° · sust ${f1(F.liftFrac * 100, 0)} % · ${f1(H.kw, 0)} kW (eixo ${f1(H.shaftKw, 0)}) · ${f1(H.packA, 0)} A · prof.foil ${f1(F.minDepth, 2)}${F.vent ? " VENT" : ""}`;
};
const go = (b: Speedboat, s: number, inp: Partial<ReturnType<typeof emptyInput>>, every = 2, t0 = 0) => {
  let t = t0;
  for (let i = 0; i < s / DT; i++) {
    water.time += DT; t += DT;
    b.step(DT, { ...emptyInput(), gear: "F", ...inp }, water, world);
    if (every > 0 && Math.abs(t / every - Math.round(t / every)) < DT / 2 / every) console.log(line(b, t));
  }
  return t;
};
console.log(`== decolagem e voo: acelerador ${thr}, ${people} pessoas, água ${waves}`);
const b = mk(true);
let t = go(b, 40, { throttle: thr });
console.log(`== curva (direção 60 %) por 15 s`);
t = go(b, 15, { throttle: thr, steering: 0.6 }, 1.5, t);
console.log(`== reto e solta o acelerador (pouso)`);
t = go(b, 20, { throttle: 0 }, 2, t);
console.log(`== a toda com foils: velocidade máxima`);
const c = mk(true); go(c, 60, { throttle: 1 }, 0); console.log(line(c, 60));
console.log(`== modo casco (foils recolhidos), a toda`);
const d = mk(false); go(d, 60, { throttle: 1 }, 0); console.log(`${f1(d.telemetry.speedKmh, 0)} km/h · ${f1(d.telemetry.hv!.kw, 0)} kW · arf ${f1(d.telemetry.pitchDeg)}°`);
