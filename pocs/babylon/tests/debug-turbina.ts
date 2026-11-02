// Lancha de turbina AR-10: partida (sequência da turbina), velocidade final, trim da hélice de superfície, curva.
// node tests/debug-turbina.ts [trim]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { TURBINA } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput, type VehicleInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const world = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
const DT = 1 / 120;
const mk = () => { const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0.35; const b = new Speedboat(TURBINA, v3(0, 0.3, 0)); b.systems.fuelL = 400; b.occupants = [{ seat: "helm", mass: 80 }]; return { w, b }; };
const run = (b: Speedboat, w: GerstnerWater, s: number, inp: Partial<VehicleInput>, each?: (t: number) => void) => { for (let i = 0; i < s / DT; i++) { w.time += DT; b.step(DT, { ...emptyInput(), ...inp }, w, world); each?.(i * DT); } };
const trimArg = Number(process.argv[2] ?? "0");
{ // partida a frio
  const { w, b } = mk(); b.coldEngines(); b.systems.batterySoc = 0.6;
  console.log("partida:", b.toggleIgnition());
  let minV = 99; const ev: string[] = [];
  run(b, w, 40, { gear: "N" }, (t) => { minV = Math.min(minV, b.systems.batteryV); for (const e of b.units[0].turb!.drainEvents()) { const T = b.telemetry.turbine!; ev.push(`${t.toFixed(1)}s ${e} N1 ${T.n1.toFixed(0)}% EGT ${T.egt.toFixed(0)} V ${b.systems.batteryV.toFixed(1)}`); } });
  const T = b.telemetry.turbine!;
  console.log(ev.join("\n"), `\n→ ${T.phase} N1 ${T.n1.toFixed(1)} N2 ${T.n2.toFixed(0)} EGT ${T.egt.toFixed(0)} óleo ${T.oilPsi.toFixed(0)} psi · tensão mín ${minV.toFixed(1)} V · bateria ${b.systems.batteryV.toFixed(1)} V ${b.systems.batteryA.toFixed(0)} A`);
}
{ const { w, b } = mk(); run(b, w, 3, { gear: "N" }); let t60 = -1, t100 = -1, maxP = -99, minP = 99;
  run(b, w, 70, { gear: "F", throttle: 1, trim: 0 }, (t) => { const v = b.telemetry.speedKmh; if (t60 < 0 && v >= 60) t60 = t; if (t100 < 0 && v >= 100) t100 = t; });
  if (trimArg) run(b, w, 30, { gear: "F", throttle: 1, trim: trimArg }, (t) => { if (t > 6) { maxP = Math.max(maxP, b.telemetry.pitchDeg); minP = Math.min(minP, b.telemetry.pitchDeg); } });
  run(b, w, 10, { gear: "F", throttle: 1 }, (t) => { maxP = Math.max(maxP, b.telemetry.pitchDeg); minP = Math.min(minP, b.telemetry.pitchDeg); });
  const T = b.telemetry, tb = T.turbine!;
  console.log(`a toda (trim ${T.trimDeg.toFixed(1)}°): ${T.speedKmh.toFixed(1)} km/h · N1 ${tb.n1.toFixed(1)} N2 ${tb.n2.toFixed(1)} TQ ${tb.torque.toFixed(0)}% EGT ${tb.egt.toFixed(0)} · imersão ${T.propImmersion.toFixed(2)} · pitch ${T.pitchDeg.toFixed(1)}° (${minP.toFixed(1)}..${maxP.toFixed(1)}) roll ${T.rollDeg.toFixed(1)}° · 0→60 ${t60.toFixed(1)} s · 0→100 ${t100.toFixed(1)} s · ${T.fuelLph.toFixed(0)} L/h · hélice ${T.propRpm.toFixed(0)} rpm`);
  run(b, w, 12, { gear: "F", throttle: 1, steering: 0.6 }); console.log(`curva a toda: ${b.telemetry.speedKmh.toFixed(0)} km/h · roll ${b.telemetry.rollDeg.toFixed(1)}° · guinada ${(b.angVel.y * 57.3).toFixed(1)}°/s · up.y ${b.up.y.toFixed(2)}`);
}
{ const { w, b } = mk(); run(b, w, 3, { gear: "N" });
  run(b, w, 20, { gear: "F", throttle: 0 }); const T = b.telemetry;
  console.log(`marcha lenta engatada: ${T.speedKmh.toFixed(1)} km/h · N2 ${T.turbine!.n2.toFixed(0)}% · hélice ${T.propRpm.toFixed(0)} rpm · imersão ${T.propImmersion.toFixed(2)}`);
  run(b, w, 20, { gear: "F", throttle: 0.3 }); console.log(`30 %: ${b.telemetry.speedKmh.toFixed(1)} km/h · N1 ${b.telemetry.turbine!.n1.toFixed(0)} N2 ${b.telemetry.turbine!.n2.toFixed(0)} · pitch ${b.telemetry.pitchDeg.toFixed(1)}°`);
  run(b, w, 20, { gear: "N", throttle: 0 }); console.log(`neutro: ${b.telemetry.speedKmh.toFixed(1)} km/h · N2 ${b.telemetry.turbine!.n2.toFixed(0)}%`);
}
