// Moto aquática AR-J (jato d'água, 300 hp): flutuação, velocidade final, 0→60/0→100, curva, freio (iBR), ré, grade
// fora d'água (pulo), ECO e o desvirar. node tests/debug-jetski.ts
import { Speedboat } from "../src/sim/boat.ts";
import { JETSKI } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput, type VehicleInput } from "../src/gameplay/vehicleInput.ts";
import { v3, qFromAxisAngle } from "../src/sim/math.ts";
const world = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
const DT = 1 / 120;
const mk = (pax = 1) => {
  const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0.35;
  const b = new Speedboat(JETSKI, v3(0, 0.1, 0)); b.systems.fuelL = 50;
  b.occupants = [{ seat: "helm", mass: 80 }, ...(pax > 1 ? [{ seat: "passenger" as const, mass: 80 }] : []), ...(pax > 2 ? [{ seat: "rearLeft" as const, mass: 80 }] : [])];
  return { w, b };
};
const run = (b: Speedboat, w: GerstnerWater, s: number, inp: Partial<VehicleInput>, each?: (t: number) => void) => { for (let i = 0; i < s / DT; i++) { w.time += DT; b.step(DT, { ...emptyInput(), ...inp }, w, world); each?.(i * DT); } };
for (const pax of [1, 3]) {
  const { w, b } = mk(pax); run(b, w, 4, { gear: "N" });
  const h = w.getHeight(b.pos.x, b.pos.z);
  console.log(`${pax} pessoa(s) parada: CG ${(b.pos.y - h).toFixed(3)} m acima d'água · pitch ${b.telemetry.pitchDeg.toFixed(1)}° · roll ${b.telemetry.rollDeg.toFixed(1)}° · borda ${b.telemetry.freeboard.toFixed(2)} m · massa ${b.totalMass.toFixed(0)} kg`);
  run(b, w, 1, { gear: "F" }); let t60 = -1, t100 = -1;
  run(b, w, 40, { gear: "F", throttle: 1 }, (t) => { const v = b.telemetry.speedKmh; if (t60 < 0 && v >= 60) t60 = t; if (t100 < 0 && v >= 100) t100 = t; });
  const T = b.telemetry;
  console.log(`  a toda: ${T.speedKmh.toFixed(1)} km/h · rpm ${T.rpm.toFixed(0)} · pitch ${T.pitchDeg.toFixed(1)}° · 0→60 ${t60.toFixed(1)} s · 0→100 ${t100.toFixed(1)} s · ${T.fuelLph.toFixed(0)} L/h · empuxo ${T.thrustN.toFixed(0)} N · cav ${T.cavitation.toFixed(2)} · limitador ${T.revLimiter}`);
  run(b, w, 6, { gear: "F", throttle: 1, steering: 1 }); console.log(`  curva a toda: ${b.telemetry.speedKmh.toFixed(0)} km/h · roll ${b.telemetry.rollDeg.toFixed(1)}° · guinada ${(b.angVel.y * 57.3).toFixed(1)}°/s · virou ${b.capsized}`);
  run(b, w, 6, { gear: "F", throttle: 1 });
  const v0 = b.telemetry.speedKmh; let tStop = -1;
  run(b, w, 8, { gear: "R", throttle: 0.4 }, (t) => { if (tStop < 0 && b.telemetry.speedKmh < 5) tStop = t; });
  console.log(`  freio iBR de ${v0.toFixed(0)} km/h: < 5 km/h em ${tStop.toFixed(1)} s · depois ${b.telemetry.speedKmh.toFixed(1)} km/h (ré) · marcha ${b.telemetry.gear}`);
}
{ const { w, b } = mk(); run(b, w, 3, { gear: "N" }); const y0 = Math.atan2(b.forward.x, b.forward.z);
  run(b, w, 6, { gear: "N", steering: 1 }); console.log(`sem acelerar (N) com o guidão todo: rumo ${((Math.atan2(b.forward.x, b.forward.z) - y0) * 57.3).toFixed(1)}° em 6 s (sem empuxo, sem direção)`);
  run(b, w, 6, { gear: "F", throttle: 0, steering: 1 }); console.log(`lenta engatada + guidão: ${b.telemetry.speedKmh.toFixed(1)} km/h · guinada ${(b.angVel.y * 57.3).toFixed(1)}°/s`);
  run(b, w, 4, { gear: "N", throttle: 1, neutralThrottle: true }); console.log(`acelerando em N: ${b.telemetry.rpm.toFixed(0)} rpm · ${b.telemetry.speedKmh.toFixed(1)} km/h · empuxo ${b.telemetry.thrustN.toFixed(0)} N`);
}
{ const { w, b } = mk(); run(b, w, 2, { gear: "N" }); run(b, w, 30, { gear: "F", throttle: 1 });
  // pulo: levanta a moto (grade fora d'água) por 0,4 s
  b.pos = v3(b.pos.x, b.pos.y + 0.6, b.pos.z); let rmax = 0, thrMin = 1e9;
  run(b, w, 0.35, { gear: "F", throttle: 1 }, () => { rmax = Math.max(rmax, b.telemetry.rpm); thrMin = Math.min(thrMin, b.telemetry.thrustN); });
  console.log(`no ar (grade fora d'água): rpm até ${rmax.toFixed(0)} · empuxo mín ${thrMin.toFixed(0)} N · ventilação ${b.telemetry.ventilation.toFixed(2)}`);
}
{ const { w, b } = mk(); b.driveMode = "eco"; run(b, w, 2, { gear: "N" }); run(b, w, 40, { gear: "F", throttle: 1 });
  console.log(`ECO a toda: ${b.telemetry.speedKmh.toFixed(1)} km/h · acelerador ${b.telemetry.throttle.toFixed(2)} · ${b.telemetry.fuelLph.toFixed(0)} L/h`);
}
{ const { w, b } = mk(); run(b, w, 2, { gear: "N" });
  b.rot = qFromAxisAngle(v3(0, 0, 1), Math.PI * 0.97); b.pos = v3(0, 0.2, 0);
  let tUp = -1;
  run(b, w, 40, { gear: "N" }, (t) => { if (tUp < 0 && b.capsized && b.righted === 0 && false) tUp = t; if (tUp < 0 && b.righted > 0) tUp = t; });
  console.log(`virada: capsized ${b.capsized} · desvirou ${b.righted}× em ${tUp.toFixed(1)} s · água dentro ${b.telemetry.bilgeL.toFixed(1)} L · a bordo ${b.occupants.length} · na água ${b.swimmers.length} · cordão ${b.lanyard}`);
  b.toggleIgnition(); run(b, w, 3, { gear: "N" }); console.log(`  partida depois de subir: motor ${b.engine}`);
  run(b, w, 30, { gear: "N" }); console.log(`  30 s ligada: porão ${b.telemetry.bilgeL.toFixed(1)} L (sifão)`);
}
