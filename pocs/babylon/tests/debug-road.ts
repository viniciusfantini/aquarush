// Dirigir da rampa até a bomba do posto pela estrada (perseguição pura). node tests/debug-road.ts [lancha|bote]
declare const process: { argv: string[] };
import { VESSELS, type VesselKind } from "../src/sim/params.ts";
import { groundHeight, ROAD_SAMPLES } from "../src/sim/world.ts";
import { buildTrailer } from "../src/sim/trailer.ts";
import { TowRig, TOW_SPECS } from "../src/sim/towVehicle.ts";
import { STATION, stationObstacles, fuelBayState } from "../src/sim/station.ts";
const kind = (process.argv[2] ?? "lancha") as VesselKind;
const tr = buildTrailer(VESSELS[kind]);
const rig = new TowRig(tr, TOW_SPECS[kind === "lancha" ? "pickup" : "car"], groundHeight);
rig.obstacles = stationObstacles();
const DT = 1 / 120;
const lane = STATION.pumps[1].lanes[1], pumpX = STATION.pumps[1].x; // faixa sul (mais alinhada com a entrada)
const path = [...ROAD_SAMPLES.filter((p) => p.x > -128).map((p) => ({ x: p.x, z: p.z })), { x: -134, z: lane }, { x: pumpX + 4, z: lane }, { x: pumpX - 20, z: lane }];
let idx = 0, t = 0, maxGrade = 0, blockedT = 0;
for (; t < 120; t += DT) {
  const c = rig.carPose();
  while (idx < path.length - 1 && Math.hypot(path[idx].x - c.x, path[idx].z - c.z) < 7) idx++;
  const p = path[idx];
  const want = Math.atan2(p.x - c.x, p.z - c.z);
  let err = want - rig.yaw; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
  const bay = fuelBayState(c, Math.abs(rig.v));
  const nearPump = Math.abs(c.z - lane) < 2 && c.x < pumpX + 8;
  const vWant = nearPump ? (Math.abs(c.x - pumpX) < 0.8 ? 0 : 1.2) : 6;
  const up = rig.v < vWant ? 0.7 : 0, down = rig.v > vWant + 0.5 || (nearPump && Math.abs(c.x - pumpX) < 0.8) ? 1 : 0;
  rig.update(DT, { up, down: rig.v > 0.05 ? down : 0, steer: Math.max(-1, Math.min(1, err * 2.5)) });
  if (rig.blocked) blockedT += DT;
  maxGrade = Math.max(maxGrade, Math.abs(c.pitch));
  if (Math.round(t * 120) % 600 === 0) console.log(`t=${t.toFixed(0)} car (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) y=${c.y.toFixed(1)} v=${(rig.v * 3.6).toFixed(0)} km/h idx=${idx}/${path.length} bay=${bay.near ? (bay.ok ? "OK" : bay.why) : "-"}`);
  if (bay.ok) { console.log(`PARADO NA BOMBA em ${t.toFixed(1)} s · carro (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) · rampa máx ${(Math.tan(maxGrade) * 100).toFixed(1)}% · bloqueado ${blockedT.toFixed(1)} s`); break; }
}
if (t >= 120) console.log(`NÃO chegou: idx ${idx}/${path.length}, bloqueado ${blockedT.toFixed(1)} s`);
