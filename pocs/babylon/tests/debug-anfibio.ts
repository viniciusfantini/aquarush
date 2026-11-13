// Anfíbio AR-A (avião anfíbio leve): flutuação, corrida na água, decolagem, subida, cruzeiro, estol, motor cortado.
// node tests/debug-anfibio.ts [manche_decolagem] [manche_cruzeiro]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { AMPHIB } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput, type VehicleInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const deep = { groundHeight: () => -50, spheres: [], boxes: [] } as never;
const DT = 1 / 120;
const pTO = Number(process.argv[2] ?? "0.5"), pCr = Number(process.argv[3] ?? "0");
const w = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -50 }); w.intensity = 0.35;
const b = new Speedboat(AMPHIB, v3(0, 0.1, 0)); b.systems.fuelL = 40;
b.occupants = process.argv[4] === "1" ? [{ seat: "helm", mass: 80 }] : [{ seat: "helm", mass: 80 }, { seat: "passenger", mass: 80 }];
const run = (s: number, inp: Partial<VehicleInput>, each?: (t: number) => void) => { for (let i = 0; i < s / DT; i++) { w.time += DT; b.step(DT, { ...emptyInput(), ...inp }, w, deep); each?.(i * DT); } };
const f = () => { const T = b.telemetry; return `${T.speedKmh.toFixed(0)} km/h ar ${(T.airspeed * 3.6).toFixed(0)} · alt ${T.altitude.toFixed(1)} m · vs ${T.vsi.toFixed(1)} · pitch ${T.pitchDeg.toFixed(1)}° roll ${T.rollDeg.toFixed(1)}° · α ${T.aoaDeg.toFixed(1)}° · L/W ${T.wingLoad.toFixed(2)} · voando ${T.airborne} · ${T.rpm.toFixed(0)} rpm · estol ${T.stallWarn}`; };
run(5, {});
console.log(`parado: ${f()} · borda ${b.telemetry.freeboard.toFixed(2)}`);
let tOff = -1, vOff = 0;
// corrida: manete a pleno; a ~70 km/h puxa o manche (pTO) até sair da água, depois volta para pCr
let rot = false;
for (let i = 0; i < 60 / DT; i++) {
  const t = i * DT, T = b.telemetry;
  if (!rot && T.speedKmh > 70) rot = true;
  const pitch = !rot ? 0 : tOff < 0 || t < tOff + 2 ? pTO : pCr;
  w.time += DT; b.step(DT, { ...emptyInput(), throttle: 1, pitch }, w, deep);
  if (tOff < 0 && T.airborne) { tOff = t; vOff = T.speedKmh; }
  if (i % 600 === 0) console.log(`  t=${t.toFixed(0)} ${f()}`);
}
console.log(`decolou ${tOff.toFixed(1)} s a ${vOff.toFixed(0)} km/h · depois de 60 s (manche ${pCr}): ${f()}`);
// cruzeiro: 30 s a 75 % de manete (deve ficar ~nivelado), curva com ailerons + leme, solta
run(30, { throttle: 0.75 });
console.log(`cruzeiro 75 %: ${f()} · wet ${b.telemetry.wetFraction} impact ${b.impactN.toFixed(0)} stall "${b.telemetry.stall}" eng ${b.engine}`);
const h0 = Math.atan2(b.forward.x, b.forward.z);
run(1.5, { throttle: 0.75, roll: 1, steering: 0.3 });
console.log(`[stall "${b.telemetry.stall}" capsized ${b.capsized} up.y ${b.up.y.toFixed(2)}] depois de 1,5 s de aileron à direita: ${f()} · rumo ${((Math.atan2(b.forward.x, b.forward.z) - h0) * 57.3).toFixed(0)}°`);
run(10, { throttle: 0.75, roll: 0, steering: 0, pitch: 0.2 });
console.log(`10 s em curva (manche solto lateral): ${f()} · rumo ${((Math.atan2(b.forward.x, b.forward.z) - h0) * 57.3).toFixed(0)}°`);
run(1.5, { throttle: 0.75, roll: -1 });
run(15, { throttle: 0.75 });
console.log(`nivelou de novo: ${f()}`);
// motor cortado: planeio até a água
{ b.engine = "off"; let tDown = -1, vsTouch = 0;
  run(120, { pitch: 0.1 }, (t) => { if (tDown < 0 && b.telemetry.wetFraction > 0.05) { tDown = t; vsTouch = b.telemetry.vsi; } });
  console.log(`motor cortado: tocou a água em ${tDown.toFixed(0)} s (vs ${vsTouch.toFixed(1)} m/s) · ${f()} · avaria ${(b.hullDamage * 100).toFixed(0)} % · virou ${b.capsized}`);
}
// estol: manete na lenta e manche todo puxado (de novo no ar)
run(20, { throttle: 0, pitch: 1 }, (t) => { if (Math.floor(t * 120) % 240 === 0) console.log(`  estol t=${t.toFixed(0)} ${f()}`); });
