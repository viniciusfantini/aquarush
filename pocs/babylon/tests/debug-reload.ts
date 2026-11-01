// Ciclo completo: carregar → rebocar para fora → voltar de ré → soltar → sair de ré → carregar de novo.
// node tests/debug-reload.ts [lancha|bote]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { VESSELS, type VesselKind } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { buildWorld, RAMP, groundHeight, fromFrame, toFrameLocal } from "../src/sim/world.ts";
import { buildTrailer, trailerLoadState, attachWinch } from "../src/sim/trailer.ts";
import { TowRig, TOW_SPECS } from "../src/sim/towVehicle.ts";
import { emptyInput, type VehicleInput } from "../src/gameplay/vehicleInput.ts";
import { v3 } from "../src/sim/math.ts";
const kind = (process.argv[2] ?? "lancha") as VesselKind;
const P = VESSELS[kind];
const w = buildWorld(); const tr = buildTrailer(P); w.trailers = [tr.collider];
const rig = new TowRig(tr, TOW_SPECS[kind === "lancha" ? "pickup" : "car"], groundHeight);
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight }); water.intensity = 0;
const DT = 1 / 120;
const b = new Speedboat(P, v3(RAMP.x + 0.4, 0.25, tr.zRear + 14), Math.PI);
b.systems.fuelL = 20; if (kind === "lancha") { b.trim = 1; b.tilt = 0.14; } else b.trimPin = 2;
const load = (label: string, secs: number) => {
  const inp: VehicleInput = { ...emptyInput(), gear: "F" };
  let attached = -1;
  for (let i = 0; i < secs / DT; i++) {
    const st = trailerLoadState(b, tr);
    // piloto: mira um rumo proporcional ao desvio (corrige antes de chegar nos postes)
    const want = Math.max(-25, Math.min(25, -st.lateral * 15));
    inp.steering = Math.max(-1, Math.min(1, (st.angleDeg - want) / 12));
    inp.throttle = st.bowGap > 0.3 && b.telemetry.speedKmh < (st.bowGap > 8 ? 4 : 2.2) ? 0.3 : 0;
    water.time += DT; b.step(DT, inp, water, w);
    if (st.loaded && attached < 0) { attached = i * DT; attachWinch(b, tr); }
    if (label === "2ª carga") { const L = toFrameLocal(tr.collider.pose, b.toWorld(P.contactPoints[0])); if (L.z < 0.5 && L.z > -1.2 && i % 6 === 0) console.log(`    t=${(i*DT).toFixed(2)} bow local (${L.x.toFixed(2)},${L.y.toFixed(2)},${L.z.toFixed(3)}) v=${b.telemetry.speedKmh.toFixed(2)} thr=${inp.throttle} strap=${!!b.winchStrap} pitch=${b.telemetry.pitchDeg.toFixed(1)}`); }
    if (i % 120 === 0 && st.bowGap < 6) console.log(`  ${label} t=${(i * DT).toFixed(0)} lat=${st.lateral.toFixed(2)} ang=${st.angleDeg.toFixed(1)} gap=${st.bowGap.toFixed(2)} near=${st.near} bunks=${st.onBunks} keel-clear=? v=${b.telemetry.speedKmh.toFixed(1)}`);
  }
  const st = trailerLoadState(b, tr);
  console.log(`${label}: cinta=${attached >= 0 ? attached.toFixed(1) + " s" : "NÃO"} loaded=${st.loaded} bunks=${st.onBunks} lat=${st.lateral.toFixed(2)} ang=${st.angleDeg.toFixed(1)} gap=${st.bowGap.toFixed(2)}`);
};
load("1ª carga", 40);
// rebocar para fora (barco preso, pose fixa no referencial da carretinha)
const rel = (() => { const p0 = tr.collider.pose; return { dz: b.pos.z - p0.z, dy: b.pos.y - p0.y, dx: b.pos.x - p0.x }; })();
const drive = (up: number, down: number, secs: number) => { for (let i = 0; i < secs / DT; i++) { rig.update(DT, { up, down, steer: 0 }); tr.collider.pose = rig.trailerPose(); } };
drive(1, 0, 6); drive(0, 1, 3); drive(0, 1, 9);
const pz = tr.collider.pose;
console.log(`avarias após 1ª carga: casco ${(b.hullDamage*100).toFixed(0)} motor ${(b.engineDamage*100).toFixed(0)}`);
console.log(`carretinha voltou: z=${(pz.z - RAMP.z0).toFixed(2)} (estacionada ${tr.sFront}) yaw=${(pz.yaw * 57.3).toFixed(1)} pitch=${(pz.pitch * 57.3).toFixed(1)} y=${pz.y.toFixed(2)}`);
// barco solto na carretinha (na pose atual) e sai de ré
b.winchStrap = null;
b.reset(v3(pz.x + rel.dx, pz.y + rel.dy + 0.05, pz.z + rel.dz), Math.PI);
if (kind === "lancha") { b.trim = 1; b.tilt = 0.14; } else b.trimPin = 2;
for (let i = 0; i < 12 / DT; i++) { water.time += DT; b.step(DT, { ...emptyInput(), gear: "R", throttle: 0.3 }, water, w); }
console.log(`saiu de ré: gap=${trailerLoadState(b, tr).bowGap.toFixed(1)} m`);
for (let i = 0; i < 3 / DT; i++) { water.time += DT; b.step(DT, { ...emptyInput(), gear: "N" }, water, w); }
// recoloca o barco 14 m atrás da carretinha (onde ela está agora), 0,4 m fora do eixo, como na 1ª carga
{ const back = fromFrame(tr.collider.pose, { x: 0.4, y: 0, z: tr.length + 14 }); b.reset(v3(back.x, 0.25, back.z), Math.PI); if (kind === "lancha") { b.trim = 1; b.tilt = 0.14; } else b.trimPin = 2; }
load("2ª carga", 45);
console.log(`avarias: casco ${(b.hullDamage*100).toFixed(0)}% motor ${(b.engineDamage*100).toFixed(0)}% — ${b.telemetry.damageEvent}`);
{
  const bx = tr.collider.boxes[4];
  console.log(`batente local: x ±${bx.maxX} y ${bx.minY.toFixed(2)}..${bx.maxY.toFixed(2)} z ${bx.minZ}..${bx.maxZ}; pose y=${tr.collider.pose.y.toFixed(2)} pitch=${(tr.collider.pose.pitch * 57.3).toFixed(1)}`);
  for (const p of P.contactPoints.filter((q) => q.z > 1.5)) { const L = toFrameLocal(tr.collider.pose, b.toWorld(p)); console.log(`  ponto ${JSON.stringify(p)} → local (${L.x.toFixed(2)}, ${L.y.toFixed(2)}, ${L.z.toFixed(2)})`); }
}
