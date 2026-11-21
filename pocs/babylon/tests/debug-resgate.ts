// Bote de resgate AR-R: velocidade, curva, giro no lugar (empuxo diferencial), giroflex e sirene nos 12 V.
// node tests/debug-resgate.ts [pessoas]
import { Speedboat } from "../src/sim/boat.ts";
import { RESCUE, PERSON_KG, type SeatId } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
declare const process: { argv: string[] };
const DT = 1 / 120, world = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
const n = Number(process.argv[2] ?? 1);
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); water.intensity = 0.35;
const seats: SeatId[] = ["helm", "passenger", "rearLeft", "rearRight", "p1"];
const mk = () => { const b = new Speedboat(RESCUE, v3(0, 0.3, 0)); b.occupants = seats.slice(0, n).map((seat) => ({ seat, mass: PERSON_KG })); b.systems.fuelL = 200; return b; };
const go = (b: Speedboat, s: number, inp: Partial<ReturnType<typeof emptyInput>>) => { for (let i = 0; i < s / DT; i++) { water.time += DT; b.step(DT, { ...emptyInput(), gear: "F", ...inp }, water, world); } };
const a = mk(); go(a, 35, { throttle: 1 });
console.log(`a toda: ${a.telemetry.speedKmh.toFixed(0)} km/h · ${Math.round(a.telemetry.rpms[0])}/${Math.round(a.telemetry.rpms[1])} rpm · arf ${a.telemetry.pitchDeg.toFixed(1)}°`);
let maxRoll = 0; for (let i = 0; i < 10 / DT; i++) { water.time += DT; a.step(DT, { ...emptyInput(), gear: "F", throttle: 1, steering: 1 }, water, world); maxRoll = Math.max(maxRoll, Math.abs(a.telemetry.rollDeg)); }
console.log(`curva fechada a toda: rolagem máx ${maxRoll.toFixed(1)}° · ${a.capsized ? "VIROU" : "de pé"} · ${a.telemetry.speedKmh.toFixed(0)} km/h`);
const b = mk(); const y0 = Math.atan2(b.forward.x, b.forward.z);
go(b, 6, { engineCmd: [{ gear: "F", throttle: 0.3 }, { gear: "R", throttle: 0.3 }] });
console.log(`giro no lugar (BB frente, BE ré, 6 s): ${(((Math.atan2(b.forward.x, b.forward.z) - y0) * 180) / Math.PI).toFixed(0)}° · deslocou ${Math.hypot(b.pos.x, b.pos.z).toFixed(1)} m`);
const c = mk(); c.engine = "off"; c.beacon = true; c.siren = "wail"; go(c, 2, { gear: "N" });
console.log(`giroflex + sirene com os motores parados: ${c.telemetry.batteryA.toFixed(1)} A · ${JSON.stringify(c.telemetry.rescue)}`);
