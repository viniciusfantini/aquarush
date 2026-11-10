// Lancha pantaneira AR-P (airboat, hélice pusher no ar): flutuação, velocidade, curva (derrapa), lenta empurrando,
// sem acelerar não vira, subir num banco de lama/capim e voltar para a água. node tests/debug-airboat.ts
import { Speedboat } from "../src/sim/boat.ts";
import { AIRBOAT } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput, type VehicleInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const deep = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
// margem: fundo sobe em rampa suave a partir de z = 40 até virar terra (capim/lama) a +0,5 m em z ≥ 70
const bank = { groundHeight: (_x: number, z: number) => (z < 40 ? -3 : Math.min(0.5, -3 + (z - 40) * 0.12)), spheres: [], boxes: [] } as never;
const DT = 1 / 120;
const mk = (pax = 1) => {
  const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0.35;
  const b = new Speedboat(AIRBOAT, v3(0, 0.1, 0)); b.systems.fuelL = 60;
  b.occupants = [{ seat: "helm", mass: 80 }, ...(pax > 1 ? [{ seat: "passenger" as const, mass: 80 }] : []), ...(pax > 2 ? [{ seat: "rearLeft" as const, mass: 80 }] : [])];
  return { w, b };
};
const run = (b: Speedboat, w: GerstnerWater, s: number, inp: Partial<VehicleInput>, world = deep, each?: (t: number) => void) => { for (let i = 0; i < s / DT; i++) { w.time += DT; b.step(DT, { ...emptyInput(), ...inp }, w, world); each?.(i * DT); } };
for (const pax of [1, 3]) {
  const { w, b } = mk(pax); run(b, w, 4, { throttle: 0 });
  const h = w.getHeight(b.pos.x, b.pos.z);
  console.log(`${pax} pessoa(s), lenta: CG ${(b.pos.y - h).toFixed(2)} m acima d'água · pitch ${b.telemetry.pitchDeg.toFixed(1)}° · roll ${b.telemetry.rollDeg.toFixed(1)}° · borda ${b.telemetry.freeboard.toFixed(2)} m · ${b.telemetry.speedKmh.toFixed(1)} km/h na lenta (${b.telemetry.rpm.toFixed(0)} rpm)`);
  let t40 = -1;
  run(b, w, 40, { throttle: 1 }, deep, (t) => { if (t40 < 0 && b.telemetry.speedKmh >= 40) t40 = t; });
  const T = b.telemetry;
  console.log(`  a toda: ${T.speedKmh.toFixed(1)} km/h · ${T.rpm.toFixed(0)} rpm · pitch ${T.pitchDeg.toFixed(1)}° · 0→40 ${t40.toFixed(1)} s · ${T.fuelLph.toFixed(0)} L/h · empuxo ${T.thrustN.toFixed(0)} N · molhado ${T.wetFraction.toFixed(2)}`);
  run(b, w, 6, { throttle: 1, steering: 1 });
  const vLat = Math.abs(b.vel.x * b.right.x + b.vel.z * b.right.z);
  console.log(`  curva a toda: ${b.telemetry.speedKmh.toFixed(0)} km/h · guinada ${(b.angVel.y * 57.3).toFixed(1)}°/s · derrapagem ${vLat.toFixed(1)} m/s · roll ${b.telemetry.rollDeg.toFixed(1)}° · virou ${b.capsized}`);
}
{ const { w, b } = mk(); run(b, w, 6, { throttle: 0 }); b.engine = "off"; run(b, w, 10, {});
  const y0 = Math.atan2(b.forward.x, b.forward.z);
  run(b, w, 6, { steering: 1 }); console.log(`motor desligado, lemes todos: rumo ${((Math.atan2(b.forward.x, b.forward.z) - y0) * 57.3).toFixed(1)}° em 6 s`);
  b.toggleIgnition(); run(b, w, 3, {}); console.log(`partida (sem neutro): ${b.engine} · ${b.telemetry.gear}`);
  const y1 = Math.atan2(b.forward.x, b.forward.z);
  run(b, w, 6, { throttle: 0, steering: 1 }); console.log(`lenta + lemes: ${b.telemetry.speedKmh.toFixed(1)} km/h · guinada ${(b.angVel.y * 57.3).toFixed(1)}°/s · rumo ${((Math.atan2(b.forward.x, b.forward.z) - y1) * 57.3).toFixed(0)}°`);
  run(b, w, 4, { throttle: 0.5, steering: 1 }); console.log(`gatilho 50 % + lemes, quase parado: guinada ${(b.angVel.y * 57.3).toFixed(1)}°/s`);
}
{ const { w, b } = mk(); w.intensity = 0; run(b, w, 3, { throttle: 0 }, bank);
  let zMax = 0, dmg = 0, onLand = 0;
  run(b, w, 25, { throttle: 1 }, bank, () => { zMax = Math.max(zMax, b.pos.z); if (b.pos.z > 70) onLand += DT; dmg = Math.max(dmg, b.hullDamage); });
  console.log(`subindo no barranco de lama/capim a toda: avançou até z=${zMax.toFixed(0)} m (terra a partir de z≈64) · ${onLand.toFixed(1)} s no seco · ${b.telemetry.speedKmh.toFixed(0)} km/h · avaria do casco ${(dmg * 100).toFixed(0)} %`);
  const z0 = b.pos.z; run(b, w, 8, { throttle: 0 }, bank); console.log(`  no seco na lenta: andou ${(b.pos.z - z0).toFixed(1)} m em 8 s`);
}
