// Manobra de colocar o barco na carretinha (piloto automático simples). node tests/debug-trailer.ts [lancha|bote] [acel] [desvio_lateral]
declare const process: { argv: string[] };
import { Speedboat } from "../src/sim/boat.ts";
import { VESSELS, PERSON_KG, type VesselKind } from "../src/sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "../src/sim/water.ts";
import { buildWorld, RAMP } from "../src/sim/world.ts";
import { buildTrailer, trailerLoadState } from "../src/sim/trailer.ts";
import { emptyInput } from "../src/gameplay/vehicleInput.ts";
import { v3, clamp } from "../src/sim/math.ts";
const kind = (process.argv[2] ?? "lancha") as VesselKind;
const thr = Number(process.argv[3] ?? 0.25), off = Number(process.argv[4] ?? 0.4);
const P = VESSELS[kind];
const world = buildWorld();
const tr = buildTrailer(P);
world.trailers = [tr.collider];
const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: world.groundHeight });
water.intensity = 0;
const b = new Speedboat(P, v3(RAMP.x + off, 0.25, tr.zRear + 14), Math.PI);
b.occupants = [{ seat: "helm", mass: PERSON_KG }];
b.systems.fuelL = 20;
// procedimento certo: motor levantado para a rampa (lancha: trim todo para cima + um pouco de tilt; bote: pino 3)
const tiltDeg = Number(process.argv[5] ?? 0);
if (kind === "lancha") { b.trim = 1; b.tilt = tiltDeg * Math.PI / 180; } else { b.trimPin = 2; }
const DT = 1 / 120;
let t = 0, loadedAt = -1;
for (let i = 0; i < 60 / DT; i++) {
  const st = trailerLoadState(b, tr);
  // mira o eixo da carretinha; acelera até apoiar e encostar no batente
  const steer = clamp((st.lateral * 1.2 + st.angleDeg / 25) * 1, -1, 1); // rumo −Z: desvio + → virar p/ a direita do barco
  // velocidade de aproximação de quem sabe: ~3 km/h longe, ~2 km/h subindo no berço (lenta engatada + toques)
  const vMax = st.bowGap > 8 ? 4 : 2.2;
  const inp = { ...emptyInput(), gear: "F" as const, throttle: st.bowGap > 0.3 && b.telemetry.speedKmh < vMax ? thr : 0, steering: steer };
  water.time += DT; b.step(DT, inp, water, world); t += DT;
  if (i % 240 === 0) console.log(`t=${t.toFixed(0)} z=${(b.pos.z - RAMP.z0).toFixed(2)} lat=${st.lateral.toFixed(2)} ang=${st.angleDeg.toFixed(1)} gap=${st.bowGap.toFixed(2)} bunks=${st.onBunks} v=${b.telemetry.speedKmh.toFixed(1)} pitch=${b.telemetry.pitchDeg.toFixed(1)} roll=${b.telemetry.rollDeg.toFixed(1)}`);
  if (st.loaded && loadedAt < 0) { loadedAt = t; console.log(`NA CARRETINHA em ${t.toFixed(1)} s: lat ${st.lateral.toFixed(2)} m, ângulo ${st.angleDeg.toFixed(1)}°, gap ${st.bowGap.toFixed(2)} m`); }
}
const st = trailerLoadState(b, tr);
console.log(`avarias: casco ${(b.hullDamage * 100).toFixed(0)}% motor ${(b.engineDamage * 100).toFixed(0)}% — ${b.telemetry.damageEvent}`);
console.log(`fim: loaded=${st.loaded} bunks=${st.onBunks} lat=${st.lateral.toFixed(2)} ang=${st.angleDeg.toFixed(1)} gap=${st.bowGap.toFixed(2)} pitch=${b.telemetry.pitchDeg.toFixed(1)} roll=${b.telemetry.rollDeg.toFixed(1)}`);
