// Lancha rápida (2 motores): velocidade final, 0→80, curva, giro no lugar (empuxo diferencial) e um motor só.
// node tests/debug-rapida.ts
import { Speedboat } from "../src/sim/boat.ts";
import { RAPIDA } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput, type VehicleInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const world = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
const DT = 1 / 120;
const mk = () => { const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0.35; const b = new Speedboat(RAPIDA, v3(0, 0.3, 0)); b.systems.fuelL = 300; b.occupants = [{ seat: "helm", mass: 80 }, { seat: "passenger", mass: 80 }]; return { w, b }; };
const run = (b: Speedboat, w: GerstnerWater, s: number, inp: Partial<VehicleInput>, each?: (t: number) => void) => { for (let i = 0; i < s / DT; i++) { w.time += DT; b.step(DT, { ...emptyInput(), ...inp }, w, world); each?.(i * DT); } };
{ const { w, b } = mk(); run(b, w, 2, { gear: "N" }); let t80 = -1, t60 = -1;
  run(b, w, 60, { gear: "F", throttle: 1 }, (t) => { const v = b.telemetry.speedKmh; if (t60 < 0 && v >= 60) t60 = t; if (t80 < 0 && v >= 80) t80 = t; });
  const T = b.telemetry; console.log(`a toda: ${T.speedKmh.toFixed(1)} km/h · rpm ${T.rpms.map((r) => r.toFixed(0)).join("/")} · pitch ${T.pitchDeg.toFixed(1)}° · 0→60 ${t60.toFixed(1)} s · 0→80 ${t80.toFixed(1)} s · consumo ${T.fuelLph.toFixed(0)} L/h`);
  run(b, w, 15, { gear: "F", throttle: 1, steering: 1 }); console.log(`curva a toda: ${b.telemetry.speedKmh.toFixed(0)} km/h · roll ${b.telemetry.rollDeg.toFixed(1)}° · guinada ${(b.angVel.y * 57.3).toFixed(1)}°/s`);
}
{ const { w, b } = mk(); run(b, w, 2, { gear: "N" }); const y0 = Math.atan2(b.forward.x, b.forward.z);
  // giro no lugar: bombordo em ré, boreste em frente (lenta) → gira para bombordo
  run(b, w, 10, { engineCmd: [{ gear: "R", throttle: 0.45 }, { gear: "F", throttle: 0.18 }] });
  const dy = (Math.atan2(b.forward.x, b.forward.z) - y0) * 57.3; console.log(`giro no lugar 10 s (BB ré, BE frente): rumo ${dy.toFixed(0)}° · deslocou ${Math.hypot(b.pos.x, b.pos.z).toFixed(1)} m · guinada ${(b.angVel.y * 57.3).toFixed(1)}°/s`);
}
{ const { w, b } = mk(); run(b, w, 2, { gear: "N" }); b.units[0].engine = "off";
  run(b, w, 30, { gear: "F", throttle: 0.6 }); console.log(`só o motor de boreste a 60 % (volante no meio), 30 s: ${b.telemetry.speedKmh.toFixed(0)} km/h · guinada ${(b.angVel.y * 57.3).toFixed(1)}°/s (puxa para bombordo)`);
}
