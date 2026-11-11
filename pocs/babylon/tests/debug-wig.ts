// Ekranoplano AR-W (asa com efeito solo): flutuação, corrida na água, decolagem, altura e velocidade em voo com o
// profundor, curva, perda de motor em voo, estol. node tests/debug-wig.ts [profundor]
import { Speedboat } from "../src/sim/boat.ts";
declare const process: { argv: string[] };
import { WIG } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput, type VehicleInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const deep = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
const DT = 1 / 120;
const elev = Number(process.argv[2] ?? "0");
const mk = (pax = 1, waves = 0.35) => {
  const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = waves;
  const b = new Speedboat(WIG, v3(0, 0.1, 0)); b.systems.fuelL = 60;
  b.occupants = [{ seat: "helm", mass: 80 }, ...(pax > 1 ? [{ seat: "passenger" as const, mass: 80 }] : [])];
  return { w, b };
};
const run = (b: Speedboat, w: GerstnerWater, s: number, inp: Partial<VehicleInput>, each?: (t: number) => void) => { for (let i = 0; i < s / DT; i++) { w.time += DT; b.step(DT, { ...emptyInput(), ...inp }, w, deep); each?.(i * DT); } };
const fmt = (b: Speedboat) => { const T = b.telemetry; return `${T.speedKmh.toFixed(0)} km/h · asa a ${T.wingH.toFixed(2)} m · pitch ${T.pitchDeg.toFixed(1)}° · roll ${T.rollDeg.toFixed(1)}° · α ${T.aoaDeg.toFixed(1)}° · kSolo ${T.groundEffect.toFixed(2)} · L/W ${T.wingLoad.toFixed(2)} · voando ${T.airborne} · molhado ${T.wetFraction.toFixed(2)} · ${T.rpm.toFixed(0)} rpm · empuxo ${T.thrustN.toFixed(0)} N`; };
for (const pax of [1, 2]) {
  const { w, b } = mk(pax); run(b, w, 5, { throttle: 0 });
  const h = w.getHeight(b.pos.x, b.pos.z);
  console.log(`${pax} pessoa(s), lenta: CG ${(b.pos.y - h).toFixed(2)} m acima d'água · ${fmt(b)} · borda ${b.telemetry.freeboard.toFixed(2)}`);
  b.elevator = elev;
  let tOff = -1, vOff = 0, hMax = 0, hMinFly = 99, pMax = -99, pMin = 99;
  run(b, w, 50, { throttle: 1 }, (t) => {
    const T = b.telemetry;
    if (tOff < 0 && T.airborne) { tOff = t; vOff = T.speedKmh; }
    if (t > 30) { hMax = Math.max(hMax, T.wingH); hMinFly = Math.min(hMinFly, T.wingH); pMax = Math.max(pMax, T.pitchDeg); pMin = Math.min(pMin, T.pitchDeg); }
    if (Math.floor(t * 120) % 600 === 0) console.log(`   t=${t.toFixed(0)}s ${fmt(b)}`);
  });
  console.log(`  decolou em ${tOff.toFixed(1)} s a ${vOff.toFixed(0)} km/h · a toda (profundor ${elev}): ${fmt(b)} · altura ${hMinFly.toFixed(2)}–${hMax.toFixed(2)} m · pitch ${pMin.toFixed(1)}…${pMax.toFixed(1)}° · ${b.telemetry.fuelLph.toFixed(0)} L/h · virou ${b.capsized}`);
  run(b, w, 8, { throttle: 1, steering: 1 });
  console.log(`  curva no ar: ${fmt(b)} · guinada ${(b.angVel.y * 57.3).toFixed(1)}°/s · virou ${b.capsized}`);
  run(b, w, 6, { throttle: 1 });
  b.engine = "off"; let tDown = -1;
  run(b, w, 15, {}, (t) => { if (tDown < 0 && !b.telemetry.airborne) tDown = t; });
  console.log(`  motor cortado em voo: pousou em ${tDown.toFixed(1)} s · ${fmt(b)} · avaria ${(b.hullDamage * 100).toFixed(0)} % · virou ${b.capsized}`);
}
