// Porão: entrada de água (furo = orifício, borda = vertedouro) e bomba. node tests/debug-bilge.ts [lancha|bote]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { VESSELS, type VesselKind } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const P = VESSELS[(process.argv[2] ?? "lancha") as VesselKind];
const world = { groundHeight: () => -30, spheres: [], boxes: [] };
const sc = (name: string, waves: number, dmg: number, inp: Partial<ReturnType<typeof emptyInput>>, secs = 120, occ = 1) => {
  const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: () => -30 }); water.intensity = waves;
  const b = new Speedboat(P, v3(0, 0.25, 0), 0);
  b.systems.fuelL = 60;
  if (occ > 1) b.occupants = Object.keys(P.seats).slice(0, occ).map((seat) => ({ seat: seat as any, mass: 80 }));
  for (let i = 0; i < 3 * 120; i++) { water.time += 1 / 120; b.step(1 / 120, emptyInput(), water, world); }
  b.hullDamage = dmg;
  let hole = 0, over = 0, maxL = 0, n = 0, pump = 0;
  for (let i = 0; i < secs * 120; i++) {
    water.time += 1 / 120; b.step(1 / 120, { ...emptyInput(), ...inp }, water, world);
    hole += b.bilgeHole; over += b.bilgeOver; n++; maxL = Math.max(maxL, b.bilgeL); pump += b.telemetry.bilgeFlowLps;
  }
  console.log(`${name.padEnd(42)} furo ${(hole / n).toFixed(2)} L/s · borda ${(over / n).toFixed(2)} L/s · bomba ${(pump / n).toFixed(2)} L/s · água final ${b.bilgeL.toFixed(0)} L (máx ${maxL.toFixed(0)})`);
};
sc("calma parado", 0.35, 0, { gear: "N" });
sc("ondas fortes parado", 2.5, 0, { gear: "N" });
sc("ondas fortes parado lotado", 2.5, 0, { gear: "N" }, 120, 4);
sc("ondas fortes 30% de frente", 2.5, 0, { gear: "F", throttle: 0.3 });
sc("ondas fortes ré a toda", 2.5, 0, { gear: "R", throttle: 1 }, 30);
sc("ondas fortes ré lenta", 2.5, 0, { gear: "R" }, 60);
sc("calma, casco 17%", 0.35, 0.17, { gear: "N" });
sc("calma, casco 30%", 0.35, 0.3, { gear: "N" });
sc("calma, casco 60%", 0.35, 0.6, { gear: "N" });
sc("calma, casco 100%", 0.35, 1, { gear: "N" }, 300);
sc("calma ré a toda", 0.35, 0, { gear: "R", throttle: 1 }, 30);
sc("lago ré a toda", 1, 0, { gear: "R", throttle: 1 }, 30);
sc("lago ré 50%", 1, 0, { gear: "R", throttle: 0.5 }, 30);
sc("ondas fortes ré 50%", 2.5, 0, { gear: "R", throttle: 0.5 }, 30);
