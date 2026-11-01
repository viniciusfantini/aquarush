// Calibração do bote: node tests/debug-dinghy.ts [pessoas]
import { Speedboat } from "../src/sim/boat.ts";
import { DINGHY, PERSON_KG, type SeatId } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";

declare const process: { argv: string[] };
const people = Number(process.argv[2] ?? 1);
const seats: SeatId[] = ["helm", "passenger", "rearLeft"].slice(0, people) as SeatId[];
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 });
water.intensity = 0;
const world = { groundHeight: () => -50, spheres: [], boxes: [] };
const b = new Speedboat(DINGHY, v3(0, 0.2, 0));
b.occupants = seats.map((seat) => ({ seat, mass: PERSON_KG }));
b.systems.fuelL = 6;
const DT = 1 / 120;
const run = (s: number, inp: ReturnType<typeof emptyInput>, each?: (t: number) => void) => { for (let i = 0; i < s / DT; i++) { water.time += DT; b.step(DT, inp, water, world); each?.(i * DT); } };
run(5, emptyInput());
const T = b.telemetry;
console.log(`massa ${b.totalMass.toFixed(0)} kg  parado: y=${b.pos.y.toFixed(3)} pitch=${T.pitchDeg.toFixed(2)} roll=${T.rollDeg.toFixed(2)} prop imm=${T.propImmersion.toFixed(2)}`);
const inp = { ...emptyInput(), gear: "F" as const, throttle: 1 };
let t30 = -1;
run(25, inp, (t) => { if (t30 < 0 && T.speedKmh > 30) t30 = t; if (Math.round(t * 120) % 240 === 0) console.log(`t=${t.toFixed(0)} v=${T.speedKmh.toFixed(1)} rpm=${T.rpm.toFixed(0)} pitch=${T.pitchDeg.toFixed(1)} wet=${T.wetFraction.toFixed(2)} thrust=${T.thrustN.toFixed(0)} plan=${T.planing}`); });
console.log(`máx ${T.speedKmh.toFixed(1)} km/h, 0→30 em ${t30.toFixed(1)} s, rpm ${T.rpm.toFixed(0)}, consumo ${T.fuelLph.toFixed(1)} L/h`);
let rollMax = 0, rollSum = 0, n = 0; const h0 = b.forward;
run(8, { ...inp, steering: 1 }, (t) => { if (t > 3) { rollMax = Math.max(rollMax, Math.abs(T.rollDeg)); rollSum += T.rollDeg; n++; } });
console.log(`curva a toda: v=${T.speedKmh.toFixed(1)} roll médio ${(rollSum / n).toFixed(1)} máx ${rollMax.toFixed(1)} up.y=${b.up.y.toFixed(2)} yawRate=${(b.angVel.y * 57.3).toFixed(0)}°/s`);
void h0;
