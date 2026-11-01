// Quantos litros de água dentro deixam o barco inavegável (borda na água) e quantos o afundam.
// node tests/debug-swamp.ts [lancha|bote]  — água calma, só o piloto, bomba desligada
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { VESSELS, type VesselKind } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const kind = (process.argv[2] ?? "lancha") as VesselKind;
const base = VESSELS[kind];
const P = { ...base, bilge: { ...base.bilge, pumpLph: 0 } };
const world = { groundHeight: () => -60, spheres: [], boxes: [] };
const DT = 1 / 120;
console.log(`${kind}: massa seca ${P.mass} kg · empuxo máximo do casco ${(1000 * P.waterplaneArea * P.pointMaxDepth).toFixed(0)} kg · capacidade alagável ${P.bilge.maxL} L`);
let unnav = -1, sink = -1;
for (let L = 0; L <= P.bilge.maxL; L += kind === "lancha" ? 250 : 50) {
  const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -60 }); water.intensity = 0;
  const b = new Speedboat(P, v3(0, 0.25, 0), 0);
  b.engine = "off"; b.systems.fuelL = 5;
  b.bilgeL = L;
  let fbMin = 9;
  for (let i = 0; i < 25 / DT; i++) { water.time += DT; b.step(DT, emptyInput(), water, world); if (i * DT > 15) fbMin = Math.min(fbMin, b.telemetry.freeboard); }
  const T = b.telemetry;
  if (unnav < 0 && fbMin < 0.03) unnav = L;
  if (sink < 0 && T.sunk) sink = L;
  console.log(`  ${String(L).padStart(5)} L dentro → borda livre ${(fbMin * 100).toFixed(0).padStart(4)} cm · trim ${T.pitchDeg.toFixed(1).padStart(5)}° · água final ${b.bilgeL.toFixed(0)} L · massa ${b.totalMass.toFixed(0)} kg${T.swamped ? " · ALAGADO" : ""}${T.sunk ? " · AFUNDOU" : ""}`);
  if (T.sunk) break;
}
console.log(`=> inavegável (borda na água) a partir de ~${unnav} L; afunda a partir de ~${sink} L`);
