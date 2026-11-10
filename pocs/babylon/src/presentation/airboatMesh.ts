// Lancha pantaneira AR-P (airboat, 4,9 m). Origem = CG do barco seco (params AIRBOAT). X boreste, Y cima, Z proa.
// Casco chato de alumínio com a proa levantada (rampa), banco dos passageiros na frente, banco ALTO do piloto no meio
// (com apoio de pés e o bastão dos lemes à esquerda), motor de avião de 6 cilindros opostos atrás dele, hélice pusher
// de 2 pás (~1,9 m) numa gaiola redonda e 2 lemes de ar atrás da gaiola, ligados ao bastão.
// O PISO fica sobre longarinas, ACIMA da linha d'água (parado e lotado a água fica em y ≈ −0,23): a "tampa" só de
// profundidade logo acima do piso esconde a superfície da água dentro do casco — com o piso abaixo dela, parecia alagado.
// Nós do BoatVisual: `engine` = pivô dos lemes (o main gira pela direção real), `propeller` = hélice (gira pelo rpm).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3 } from "@babylonjs/core";
import { AIRBOAT } from "../sim/params.ts";
import type { BoatTelemetry } from "../sim/boat.ts";
import type { VehicleInput } from "../gameplay/vehicleInput.ts";
import { type BoatVisual, pbr, roundedBox, colorize, hpDecalMaterial } from "./boatMesh.ts";

/** apoio dos pés do piloto (banco alto) e piso do casco */
export const AIR_FOOT = 0.78;
export const AIR_FLOOR = -0.12;
const Z_STERN = -2.45, Z_BOW = 2.45, HB = 1.18; // meia-boca
const BOTTOM = -0.36, SIDE_TOP = 0.15;

export interface AirboatControls {
  meshes: Mesh[];
  /** punho do bastão dos lemes (mão esquerda) */
  wheelGrip: TransformNode;
  /** mão direita (no joelho) */
  leverGrip: TransformNode;
  update(dt: number, t: BoatTelemetry, input: VehicleInput, maxSteerDeg: number): void;
}

export const buildAirboat = (scene: Scene): BoatVisual & { controls: AirboatControls } => {
  const root = new TransformNode("boat", scene);
  const meshes: Mesh[] = [];
  const add = (m: Mesh, mat: StandardMaterial | PBRMaterial, parent: TransformNode = root) => { m.material = mat; m.parent = parent; meshes.push(m); return m; };

  const alu = pbr(scene, "airAlu", new Color3(0.78, 0.8, 0.82), 0.85, 0.35);
  alu.backFaceCulling = false;
  const paint = pbr(scene, "airPaint", new Color3(1, 1, 1), 0.2, 0.3, 0.6);
  paint.backFaceCulling = false;
  const floorMat = pbr(scene, "airFloor", new Color3(0.32, 0.34, 0.33), 0.5, 0.7);
  floorMat.backFaceCulling = false;
  const seatMat = pbr(scene, "airSeat", new Color3(0.42, 0.27, 0.12), 0, 0.6);   // couro marrom
  const frame = pbr(scene, "airFrame", new Color3(0.12, 0.13, 0.14), 0.6, 0.35);
  const steel = pbr(scene, "airSteel", new Color3(0.9, 0.91, 0.93), 0.9, 0.22);
  const engineMat = pbr(scene, "airEngine", new Color3(0.55, 0.57, 0.6), 0.8, 0.35);
  const finMat = pbr(scene, "airFins", new Color3(0.2, 0.21, 0.22), 0.7, 0.4);
  const propMat = pbr(scene, "airProp", new Color3(0.36, 0.22, 0.1), 0, 0.35, 0.8); // pás de madeira laminada envernizada
  const tipMat = pbr(scene, "airPropTip", new Color3(0.95, 0.85, 0.1), 0, 0.4);
  const rudderMat = pbr(scene, "airRudder", new Color3(1, 1, 1), 0.3, 0.35);
  rudderMat.backFaceCulling = false;
  const GREEN = new Color3(0.12, 0.38, 0.22), CAMO = new Color3(0.36, 0.42, 0.24), ALU = new Color3(0.8, 0.82, 0.84);

  // ---------- casco chato (fundo plano + costado reto + proa em rampa) ----------
  const keel = (z: number) => (z < 1.2 ? BOTTOM : BOTTOM + 0.46 * ((z - 1.2) / (Z_BOW - 1.2)) ** 1.6);
  const half = (z: number) => (z < 1.6 ? HB : HB - 0.12 * ((z - 1.6) / (Z_BOW - 1.6)));
  const sec = (z: number) => {
    const h = half(z), k = keel(z);
    return [new Vector3(-h, SIDE_TOP, z), new Vector3(-h, k + 0.04, z), new Vector3(-h + 0.04, k, z), new Vector3(h - 0.04, k, z), new Vector3(h, k + 0.04, z), new Vector3(h, SIDE_TOP, z)];
  };
  const hz: number[] = [];
  for (let i = 0; i <= 28; i++) hz.push(Z_STERN + (Z_BOW - Z_STERN) * (i / 28));
  const hull = add(MeshBuilder.CreateRibbon("airHull", { pathArray: hz.map(sec), sideOrientation: Mesh.DOUBLESIDE }, scene), paint);
  colorize(hull, (_x, y) => (y < -0.2 ? ALU : y > 0.02 ? GREEN : CAMO));
  // proa (fecha a rampa) e espelho
  const bowS = sec(Z_BOW);
  add(MeshBuilder.CreateRibbon("airBowCap", { pathArray: [bowS, bowS.map((p) => new Vector3(0, SIDE_TOP, Z_BOW))], sideOrientation: Mesh.DOUBLESIDE }, scene), alu);
  const sternS = sec(Z_STERN);
  add(MeshBuilder.CreateRibbon("airTransom", { pathArray: [sternS, sternS.map((p) => new Vector3(0, Math.max(p.y, BOTTOM), Z_STERN))], sideOrientation: Mesh.DOUBLESIDE }, scene), alu);
  // piso, borda (corrimão de alumínio) e "skeg" (placa de desgaste do fundo, para as gotas)
  add(MeshBuilder.CreateBox("airFloor", { width: 2 * HB - 0.1, height: 0.02, depth: 4.3 }, scene), floorMat).position.set(0, AIR_FLOOR, -0.2);
  for (const x of [-0.8, -0.27, 0.27, 0.8]) add(MeshBuilder.CreateBox("airStringer", { width: 0.05, height: AIR_FLOOR - BOTTOM, depth: 4.2 }, scene), alu).position.set(x, (AIR_FLOOR + BOTTOM) / 2, -0.25);
  for (const s of [-1, 1]) {
    const rail = add(MeshBuilder.CreateCylinder("airRail", { height: Z_BOW - Z_STERN - 0.2, diameter: 0.05, tessellation: 10 }, scene), alu);
    rail.rotation.x = Math.PI / 2; rail.position.set(s * (HB - 0.02), SIDE_TOP + 0.02, 0);
  }
  add(MeshBuilder.CreateBox("skeg", { width: 1.8, height: 0.01, depth: 0.5 }, scene), alu).position.set(0, BOTTOM - 0.005, -2.0);

  // ---------- banco dos passageiros (frente) ----------
  const bench = add(roundedBox("airBench", scene, 1.5, 0.12, 0.5, 0.04), seatMat);
  bench.position.set(0, AIR_FLOOR + 0.5, AIRBOAT.seats.passenger.z - 0.05);
  const benchBack = add(roundedBox("airBenchBack", scene, 1.5, 0.42, 0.08, 0.03), seatMat);
  benchBack.position.set(0, AIR_FLOOR + 0.8, AIRBOAT.seats.passenger.z - 0.32); benchBack.rotation.x = -0.12;
  for (const s of [-0.65, 0.65]) add(MeshBuilder.CreateBox("airBenchLeg", { width: 0.05, height: 0.48, depth: 0.4 }, scene), frame).position.set(s, AIR_FLOOR + 0.24, AIRBOAT.seats.passenger.z - 0.05);

  // ---------- banco alto do piloto + apoio de pés ----------
  const hs = AIRBOAT.seats.helm;
  const seatY = AIR_FOOT + 0.42;
  const seat = add(roundedBox("airPilotSeat", scene, 0.55, 0.12, 0.5, 0.04), seatMat);
  seat.position.set(0, seatY, hs.z - 0.05);
  const seatBack = add(roundedBox("airPilotBack", scene, 0.55, 0.5, 0.08, 0.03), seatMat);
  seatBack.position.set(0, seatY + 0.3, hs.z - 0.33); seatBack.rotation.x = -0.15;
  // estrutura tubular: 4 pernas até o piso + travessas
  for (const sx of [-0.28, 0.28]) for (const sz of [hs.z - 0.3, hs.z + 0.2]) {
    const leg = add(MeshBuilder.CreateCylinder("airSeatLeg", { height: seatY - AIR_FLOOR, diameter: 0.045, tessellation: 8 }, scene), frame);
    leg.position.set(sx, (seatY + AIR_FLOOR) / 2, sz);
  }
  const foot = add(MeshBuilder.CreateBox("airFootrest", { width: 0.7, height: 0.03, depth: 0.32 }, scene), frame);
  foot.position.set(0, AIR_FOOT, hs.z + 0.42);
  for (const sx of [-0.32, 0.32]) add(MeshBuilder.CreateCylinder("airFootLeg", { height: AIR_FOOT - AIR_FLOOR, diameter: 0.04, tessellation: 8 }, scene), frame).position.set(sx, (AIR_FOOT + AIR_FLOOR) / 2, hs.z + 0.42);
  // pedal do acelerador (direita) — anda com o acelerador real
  const pedalPivot = new TransformNode("airPedal", scene); pedalPivot.parent = root; pedalPivot.position.set(0.16, AIR_FOOT + 0.02, hs.z + 0.5);
  add(MeshBuilder.CreateBox("airPedalM", { width: 0.1, height: 0.02, depth: 0.22 }, scene), steel, pedalPivot).position.set(0, 0.0, 0.08);

  // ---------- motor de avião (6 cilindros opostos) num berço tubular ----------
  const ex = 0, ey = 0.95, ez = -1.45;
  const crank = add(roundedBox("airEngineCase", scene, 0.42, 0.34, 0.8, 0.06), engineMat);
  crank.position.set(ex, ey, ez);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const cyl = add(MeshBuilder.CreateCylinder("airCylinder", { height: 0.34, diameter: 0.18, tessellation: 14 }, scene), finMat);
    cyl.rotation.z = Math.PI / 2; cyl.position.set(ex + s * 0.36, ey + 0.02, ez - 0.25 + k * 0.25);
    const head = add(roundedBox("airCylHead", scene, 0.1, 0.2, 0.2, 0.03), engineMat);
    head.position.set(ex + s * 0.56, ey + 0.02, ez - 0.25 + k * 0.25);
  }
  // escapes (tubos curtos para cima) e filtro de ar
  for (const s of [-1, 1]) {
    const exh = add(MeshBuilder.CreateCylinder("airExhaust", { height: 0.45, diameter: 0.06, tessellation: 8 }, scene), steel);
    exh.position.set(ex + s * 0.5, ey + 0.32, ez - 0.4); exh.rotation.x = 0.4;
  }
  add(MeshBuilder.CreateCylinder("airFilter", { height: 0.12, diameter: 0.26, tessellation: 18 }, scene), frame).position.set(ex, ey + 0.26, ez + 0.1);
  const hpDecal = add(MeshBuilder.CreatePlane("decalHp", { width: 0.3, height: 0.19 }, scene), hpDecalMaterial(scene, AIRBOAT.enginePowerHp));
  hpDecal.position.set(ex, ey + 0.1, ez + 0.41);
  // berço: 4 pés do motor até o piso
  for (const sx of [-0.3, 0.3]) for (const sz of [ez - 0.3, ez + 0.3]) {
    const st = add(MeshBuilder.CreateCylinder("airMount", { height: ey - AIR_FLOOR - 0.15, diameter: 0.05, tessellation: 8 }, scene), frame);
    st.position.set(sx, (ey - 0.15 + AIR_FLOOR) / 2, sz);
  }
  // tanque de combustível sob o banco do piloto
  add(roundedBox("airTank", scene, 0.6, 0.3, 0.5, 0.06), alu).position.set(0, AIR_FLOOR + 0.17, AIRBOAT.fuelTankPos.z);

  // ---------- hélice pusher (2 pás) ----------
  const pp = AIRBOAT.propPos, R = AIRBOAT.propRadius;
  const hub = add(MeshBuilder.CreateCylinder("airShaft", { height: 0.5, diameter: 0.09, tessellation: 12 }, scene), steel);
  hub.rotation.x = Math.PI / 2; hub.position.set(pp.x, pp.y, (ez - 0.4 + pp.z) / 2);
  // sobe a hélice: o eixo do motor está mais baixo — redutor por correia (polias) até a altura da hélice
  const belt = add(roundedBox("airBeltDrive", scene, 0.16, pp.y - ey + 0.3, 0.12, 0.05), frame);
  belt.position.set(pp.x, (pp.y + ey) / 2, ez - 0.45);
  const propeller = new TransformNode("airPropeller", scene);
  propeller.parent = root; propeller.position.set(pp.x, pp.y, pp.z);
  add(MeshBuilder.CreateSphere("airSpinner", { diameter: 0.2, segments: 12 }, scene), steel, propeller).scaling.z = 1.4;
  for (const s of [0, Math.PI]) {
    const blade = new TransformNode("airBladeRoot", scene); blade.parent = propeller; blade.rotation.z = s;
    const b = add(MeshBuilder.CreateBox("airBlade", { width: 0.16, height: R - 0.08, depth: 0.03 }, scene), propMat, blade);
    b.position.y = (R - 0.08) / 2 + 0.06; b.rotation.y = 0.32; // passo
    const tip = add(MeshBuilder.CreateBox("airBladeTip", { width: 0.16, height: 0.08, depth: 0.032 }, scene), tipMat, blade);
    tip.position.y = R - 0.04; tip.rotation.y = 0.32;
  }
  // disco de borrão da hélice (alpha pelo rpm, no main)
  const propBlur = new PBRMaterial("airPropBlur", scene);
  propBlur.albedoColor = new Color3(0.35, 0.3, 0.25); propBlur.metallic = 0; propBlur.roughness = 0.6; propBlur.alpha = 0; propBlur.backFaceCulling = false;
  const disc = MeshBuilder.CreateDisc("propDisc", { radius: R, tessellation: 48 }, scene);
  disc.material = propBlur; disc.parent = propeller; disc.position.z = -0.01; meshes.push(disc);

  // ---------- gaiola da hélice (anel + raios em grade) ----------
  const cz = pp.z - 0.12, cr = R + 0.12;
  for (const z of [cz + 0.05, cz - 0.28]) { // anel da frente e anel de trás
    const ring = add(MeshBuilder.CreateTorus("airCageRing", { diameter: 2 * cr, thickness: 0.05, tessellation: 48 }, scene), frame);
    ring.rotation.x = Math.PI / 2; ring.position.set(pp.x, pp.y, z);
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    // longarinas da gaiola (entre os dois anéis)
    const bar = add(MeshBuilder.CreateCylinder("airCageBar", { height: 0.33, diameter: 0.025, tessellation: 6 }, scene), frame);
    bar.rotation.x = Math.PI / 2; bar.position.set(pp.x + Math.cos(a) * cr, pp.y + Math.sin(a) * cr, cz - 0.115);
    // grade da frente (raios do cubo ao anel) — protege quem está no barco
    const spoke = add(MeshBuilder.CreateCylinder("airCageSpoke", { height: cr, diameter: 0.012, tessellation: 4 }, scene), frame);
    spoke.position.set(pp.x + Math.cos(a) * cr / 2, pp.y + Math.sin(a) * cr / 2, cz + 0.06); spoke.rotation.z = a - Math.PI / 2;
  }
  for (const rr of [0.35, 0.7]) {
    const ring = add(MeshBuilder.CreateTorus("airCageGrid", { diameter: 2 * cr * rr, thickness: 0.012, tessellation: 32 }, scene), frame);
    ring.rotation.x = Math.PI / 2; ring.position.set(pp.x, pp.y, cz + 0.06);
  }
  // suportes da gaiola até o casco
  for (const s of [-1, 1]) {
    const st = add(MeshBuilder.CreateCylinder("airCageStrut", { height: 1.9, diameter: 0.05, tessellation: 8 }, scene), frame);
    st.position.set(s * 0.75, (pp.y - 0.6 + AIR_FLOOR) / 2 + 0.2, cz - 0.1); st.rotation.z = -s * 0.28;
  }

  // ---------- lemes de ar (2 placas atrás da gaiola) — pivô = "engine" (o main gira pela direção real) ----------
  const rp = AIRBOAT.airProp!.rudderPos;
  const engine = new TransformNode("enginePivot", scene);
  engine.parent = root; engine.position.set(rp.x, rp.y, rp.z);
  const rudders: TransformNode[] = [];
  for (const x of [-0.42, 0.42]) {
    const pv = new TransformNode("airRudderPivot", scene); pv.parent = root; pv.position.set(rp.x + x, rp.y, rp.z);
    const plate = add(MeshBuilder.CreateBox("airRudder", { width: 0.02, height: 1.5, depth: 0.58 }, scene), rudderMat, pv);
    plate.position.z = -0.22;
    colorize(plate, (_x, y) => (y > 0.5 ? new Color3(0.95, 0.42, 0.05) : new Color3(0.95, 0.96, 0.97)));
    rudders.push(pv);
  }
  // barra de ligação dos lemes + haste até o bastão
  add(MeshBuilder.CreateBox("airRudderLink", { width: 0.95, height: 0.025, depth: 0.025 }, scene), frame).position.set(rp.x, rp.y - 0.65, rp.z - 0.15);
  const pushrod = add(MeshBuilder.CreateCylinder("airPushrod", { height: Math.abs(rp.z - hs.z) - 0.2, diameter: 0.02, tessellation: 6 }, scene), steel);
  pushrod.rotation.x = Math.PI / 2; pushrod.position.set(-0.6, AIR_FOOT + 0.25, (rp.z + hs.z) / 2);

  // ---------- bastão (stick) dos lemes à esquerda do piloto ----------
  const stickPivot = new TransformNode("airStick", scene);
  stickPivot.parent = root; stickPivot.position.set(-0.45, AIR_FOOT + 0.05, hs.z + 0.15);
  add(MeshBuilder.CreateCylinder("airStickRod", { height: 0.55, diameter: 0.03, tessellation: 8 }, scene), steel, stickPivot).position.y = 0.27;
  add(MeshBuilder.CreateSphere("airStickGrip", { diameter: 0.07, segments: 10 }, scene), frame, stickPivot).position.y = 0.56;
  const stickGrip = new TransformNode("airStickGripPt", scene); stickGrip.parent = stickPivot; stickGrip.position.y = 0.55;
  const kneeRest = new TransformNode("airKneeRest", scene); kneeRest.parent = root; kneeRest.position.set(0.12, seatY + 0.18, hs.z + 0.32);

  // tampa só-profundidade do casco aberto (a água não aparece dentro)
  const lidMat = new StandardMaterial("airLidMat", scene);
  lidMat.disableColorWrite = true; lidMat.forceDepthWrite = true; lidMat.alpha = 0.01; lidMat.backFaceCulling = false;
  const cockpitLid = MeshBuilder.CreateBox("cockpitLid", { width: 2 * HB - 0.06, height: 0.005, depth: 4.6 }, scene);
  cockpitLid.material = lidMat; cockpitLid.parent = root; cockpitLid.position.set(0, AIR_FLOOR + 0.01, -0.1); cockpitLid.alphaIndex = 0;

  // esguicho: não tem (refrigerado a ar) — o nó existe por contrato, fora de vista
  const telltale = new TransformNode("telltale", scene); telltale.parent = root; telltale.position.set(0, -5, 0);

  for (const m of meshes) m.isPickable = false;
  let stickAng = 0, pedal = 0;
  const controls: AirboatControls = {
    meshes: [],
    wheelGrip: stickGrip,
    leverGrip: kneeRest,
    update(dt, t, _input, maxSteerDeg) {
      // os lemes seguem a direção real; o bastão vai para a frente/para trás (puxar = leme para a esquerda)
      const a = (t.steerDeg * Math.PI) / 180;
      for (const r of rudders) r.rotation.y = -a;
      const target = (t.steerDeg / Math.max(1, maxSteerDeg)) * 0.45;
      stickAng += (target - stickAng) * Math.min(1, dt * 12);
      stickPivot.rotation.x = stickAng;
      pedal += (t.throttle - pedal) * Math.min(1, dt * 12);
      pedalPivot.rotation.x = 0.45 * pedal;
    },
  };
  return { root, engine, propeller, telltale, propBlur, lights: null, cockpitLid, meshes, controls };
};
