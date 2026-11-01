// Bote de apoio AR-3: inflável com fundo rígido (RIB) de 3,1 m e motor de popa de 15 hp com cana do leme.
// Origem = CG do bote seco (mesma origem da física, params DINGHY). X boreste, Y cima, Z proa.
// Tudo procedural (sem assets). Os comandos ficam no MOTOR: a cana do leme gira o motor inteiro
// (direção), a manopla gira com o acelerador e a alavanca de câmbio fica na lateral do capô.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3, SpotLight } from "@babylonjs/core";
import { DINGHY } from "../sim/params.ts";
import type { BoatTelemetry } from "../sim/boat.ts";
import type { VehicleInput } from "../gameplay/vehicleInput.ts";
import { type BoatVisual, pbr, roundedBox, roundedRect, colorize, hpDecalMaterial, buildPropeller } from "./boatMesh.ts";

export const DINGHY_FLOOR = -0.08;      // piso interno (pés dos ocupantes)
const TUBE_R = 0.21;                    // raio dos flutuadores
const TUBE_X = 0.6;                     // afastamento dos flutuadores (centro)
const TUBE_Y = 0.12;
const Z_TUBE_STERN = -1.55, Z_ARC = 0.3, Z_BOW = 1.45;
const Z_TRANSOM = -1.2;
export const DINGHY_BENCH_Y = DINGHY_FLOOR + 0.38; // topo dos bancos (mesma altura relativa do banco da lancha)

/** Linha de centro do flutuador de um bordo: reto até Z_ARC, depois arco elíptico que fecha na proa. */
const tubePath = (side: number): Vector3[] => {
  const pts: Vector3[] = [];
  for (let i = 0; i <= 10; i++) { const z = Z_TUBE_STERN + (Z_ARC - Z_TUBE_STERN) * (i / 10); pts.push(new Vector3(side * TUBE_X, TUBE_Y, z)); }
  for (let i = 1; i <= 18; i++) {
    const th = (i / 18) * Math.PI / 2;
    pts.push(new Vector3(side * TUBE_X * Math.cos(th), TUBE_Y + 0.17 * Math.pow(Math.sin(th), 3), Z_ARC + (Z_BOW - Z_ARC) * Math.sin(th)));
  }
  return pts;
};
/** meia-largura interna (entre os flutuadores) numa estação z */
const innerHalf = (z: number) => {
  if (z <= Z_ARC) return TUBE_X - TUBE_R * 0.9;
  const s = Math.min(1, (z - Z_ARC) / (Z_BOW - Z_ARC));
  return Math.max(0.02, TUBE_X * Math.cos(Math.asin(s)) - TUBE_R * 0.9);
};

export interface DinghyControls {
  meshes: Mesh[];
  /** ponto da manopla da cana do leme (mão esquerda do piloto) */
  wheelGrip: TransformNode;
  /** apoio da mão direita (coxa) */
  leverGrip: TransformNode;
  update(dt: number, t: BoatTelemetry, input: VehicleInput, maxSteerDeg: number): void;
  /** lanterna de mão do piloto (o bote não tem luzes de navegação fixas) */
  setLantern(on: boolean): void;
  /** piloto caiu na água: some a lanterna */
  pilotAboard: boolean;
}

export const buildDinghy = (scene: Scene): BoatVisual & { controls: DinghyControls } => {
  const root = new TransformNode("boat", scene);
  const meshes: Mesh[] = [];
  const add = (m: Mesh, mat: StandardMaterial | PBRMaterial, parent: TransformNode = root) => { m.material = mat; m.parent = parent; meshes.push(m); return m; };

  const hypalon = pbr(scene, "hypalon", new Color3(0.56, 0.58, 0.6), 0, 0.5);       // tecido dos flutuadores
  const rubStrake = pbr(scene, "rubStrake", new Color3(0.12, 0.13, 0.14), 0, 0.55);
  const fiber = pbr(scene, "ribHull", new Color3(1, 1, 1), 0, 0.25, 0.8);
  fiber.backFaceCulling = false;
  const floorMat = pbr(scene, "ribFloor", new Color3(0.3, 0.31, 0.32), 0, 0.85);
  floorMat.backFaceCulling = false;
  const wood = pbr(scene, "benchWood", new Color3(0.62, 0.45, 0.28), 0, 0.55);
  const steel = pbr(scene, "stainless", new Color3(0.92, 0.93, 0.95), 0.9, 0.22);
  const blackGloss = pbr(scene, "blackGloss", new Color3(0.03, 0.035, 0.04), 0, 0.2, 0.8);
  const blackMatte = pbr(scene, "blackMatte", new Color3(0.05, 0.05, 0.055), 0, 0.6);
  const gelcoat = pbr(scene, "cowlWhite", new Color3(1, 1, 1), 0, 0.22, 1);
  gelcoat.backFaceCulling = false;
  const rope = pbr(scene, "rope", new Color3(0.85, 0.82, 0.72), 0, 0.9);
  const tankRed = pbr(scene, "fuelTank", new Color3(0.75, 0.08, 0.06), 0, 0.45, 0.3);
  const WHITE = new Color3(0.95, 0.96, 0.97), NAVY = new Color3(0.05, 0.12, 0.3), RED = new Color3(0.75, 0.06, 0.08);

  // ---------- flutuadores (cones na popa, unidos na proa) ----------
  for (const side of [-1, 1]) {
    const path = tubePath(side);
    const n = path.length;
    add(MeshBuilder.CreateTube("tube", {
      path, tessellation: 24, cap: Mesh.CAP_ALL,
      radiusFunction: (i) => { const z = path[i].z; const stern = Math.min(1, (z - Z_TUBE_STERN) / 0.22); return TUBE_R * (0.55 + 0.45 * Math.sqrt(Math.max(0, stern))) * (i === n - 1 ? 0.97 : 1); },
    }, scene), hypalon);
    // verdugo (faixa de borracha) e cabo de mão (corda nos olhais)
    add(MeshBuilder.CreateTube("tubeStrake", { path: path.map((p) => p.add(new Vector3(side * TUBE_R * 0.98 * (Math.abs(p.x) > 0.1 ? Math.abs(p.x) / TUBE_X : 0.3), -0.02, 0))), radius: 0.035, tessellation: 8, cap: Mesh.CAP_ALL }, scene), rubStrake);
    const lifeline = path.filter((_, i) => i > 1 && i < n - 4).map((p, i) => p.add(new Vector3(side * 0.06, TUBE_R + 0.01 - (i % 3 === 1 ? 0.03 : 0), 0)));
    add(MeshBuilder.CreateTube("lifeline", { path: lifeline, radius: 0.008, tessellation: 6 }, scene), rope);
    // cones de popa
    const cone = add(MeshBuilder.CreateSphere("tubeCone", { diameter: 1, segments: 12 }, scene), hypalon);
    cone.scaling.set(TUBE_R * 1.15, TUBE_R * 1.15, 0.28);
    cone.position.set(side * TUBE_X, TUBE_Y, Z_TUBE_STERN);
  }

  // ---------- casco rígido (fundo em V) ----------
  const hullSec = (z: number) => {
    const w = innerHalf(z) + 0.1;
    const t = Math.max(0, (z - 0.6) / (Z_BOW - 0.6));
    const keel = -0.2 + 0.26 * t * t;
    return [new Vector3(-w, TUBE_Y - TUBE_R * 0.6, z), new Vector3(-w * 0.85, -0.1 + 0.15 * t, z), new Vector3(0, keel, z), new Vector3(w * 0.85, -0.1 + 0.15 * t, z), new Vector3(w, TUBE_Y - TUBE_R * 0.6, z)];
  };
  const hz: number[] = [];
  for (let i = 0; i <= 22; i++) hz.push(Z_TRANSOM + (Z_BOW - 0.05 - Z_TRANSOM) * (i / 22));
  const hull = add(MeshBuilder.CreateRibbon("ribHull", { pathArray: hz.map(hullSec), sideOrientation: Mesh.DOUBLESIDE }, scene), fiber);
  colorize(hull, (_x, y) => (y < -0.14 ? new Color3(0.9, 0.9, 0.88) : WHITE));

  // ---------- piso, espelho de popa, bancos ----------
  const fz: number[] = [];
  for (let i = 0; i <= 16; i++) fz.push(Z_TRANSOM + 0.03 + (1.05 - Z_TRANSOM) * (i / 16));
  add(MeshBuilder.CreateRibbon("ribFloor", { pathArray: fz.map((z) => [new Vector3(-innerHalf(z), DINGHY_FLOOR, z), new Vector3(innerHalf(z), DINGHY_FLOOR, z)]), sideOrientation: Mesh.DOUBLESIDE }, scene), floorMat);
  const transom = add(roundedBox("transom", scene, 1.02, 0.52, 0.06, 0.03), fiber);
  transom.position.set(0, 0.1, Z_TRANSOM - 0.03);
  colorize(transom, () => WHITE);
  // placa de madeira onde o motor prende (grampos)
  add(MeshBuilder.CreateBox("transomPad", { width: 0.42, height: 0.2, depth: 0.03 }, scene), wood).position.set(0, 0.26, Z_TRANSOM + 0.01);
  const bench = (z: number) => {
    const w = innerHalf(z) * 2 + 0.08;
    add(MeshBuilder.CreateBox("bench", { width: w, height: 0.035, depth: 0.28 }, scene), wood).position.set(0, DINGHY_BENCH_Y - 0.06, z);
    for (const s of [-1, 1]) add(MeshBuilder.CreateBox("benchLeg", { width: 0.03, height: DINGHY_BENCH_Y - 0.06 - DINGHY_FLOOR, depth: 0.22 }, scene), blackMatte)
      .position.set(s * (w / 2 - 0.12), (DINGHY_BENCH_Y - 0.06 + DINGHY_FLOOR) / 2, z);
  };
  bench(DINGHY.seats.helm.z - 0.02);
  bench(DINGHY.seats.passenger.z - 0.02);
  // tanque portátil + mangueira até o motor
  const tank = add(roundedBox("fuelTank", scene, 0.32, 0.24, 0.42, 0.04), tankRed);
  tank.position.set(DINGHY.fuelTankPos.x, DINGHY_FLOOR + 0.12, DINGHY.fuelTankPos.z - 0.08);
  add(MeshBuilder.CreateCylinder("tankCap", { height: 0.03, diameter: 0.07, tessellation: 12 }, scene), blackMatte).position.set(DINGHY.fuelTankPos.x + 0.07, DINGHY_FLOOR + 0.255, DINGHY.fuelTankPos.z - 0.18);
  add(MeshBuilder.CreateTube("fuelHose", { path: [new Vector3(DINGHY.fuelTankPos.x + 0.1, DINGHY_FLOOR + 0.2, DINGHY.fuelTankPos.z - 0.28), new Vector3(-0.12, DINGHY_FLOOR + 0.05, Z_TRANSOM + 0.1), new Vector3(-0.08, 0.2, Z_TRANSOM + 0.02)], radius: 0.009, tessellation: 6 }, scene), blackMatte);
  // olhal de proa e alças
  add(MeshBuilder.CreateTorus("bowEye", { diameter: 0.07, thickness: 0.012, tessellation: 12 }, scene), steel).position.set(0, TUBE_Y + 0.22, Z_BOW + 0.12);
  for (const s of [-1, 1]) {
    const h = add(MeshBuilder.CreateTorus("handle", { diameter: 0.14, thickness: 0.02, tessellation: 12 }, scene), blackMatte);
    h.position.set(s * TUBE_X, TUBE_Y + TUBE_R + 0.01, -0.95); h.scaling.y = 0.4; h.rotation.y = Math.PI / 2;
  }

  // tampa só-profundidade: a água não aparece dentro do bote
  const lidMat = new StandardMaterial("lidMat", scene);
  lidMat.disableColorWrite = true;
  lidMat.forceDepthWrite = true;
  lidMat.alpha = 0.01;
  lidMat.backFaceCulling = false;
  const cockpitLid = MeshBuilder.CreateRibbon("cockpitLid", { pathArray: fz.map((z) => [new Vector3(-innerHalf(z) - 0.05, TUBE_Y - 0.02, z), new Vector3(innerHalf(z) + 0.05, TUBE_Y - 0.02, z)]) }, scene);
  cockpitLid.material = lidMat;
  cockpitLid.parent = root;
  cockpitLid.alphaIndex = 0;

  // (sem luzes de navegação fixas: no bote, no máximo uma lanterna na mão do piloto — ver controls.setLantern)

  // ---------- motor de popa 15 hp com cana do leme (pivô = DINGHY.drivePivot) ----------
  const pv = DINGHY.drivePivot;
  const engine = new TransformNode("enginePivot", scene);
  engine.parent = root;
  engine.position.set(pv.x, pv.y, pv.z);
  // suporte com grampos (fica no espelho — no mundo real o suporte não gira, mas é pequeno)
  add(MeshBuilder.CreateBox("bracket", { width: 0.16, height: 0.24, depth: 0.08 }, scene), blackMatte, engine).position.set(0, -0.04, -0.04);
  for (const s of [-1, 1]) {
    const screw = add(MeshBuilder.CreateCylinder("clampScrew", { height: 0.12, diameter: 0.016, tessellation: 8 }, scene), steel, engine);
    screw.rotation.x = Math.PI / 2; screw.position.set(s * 0.06, -0.1, 0.05);
    add(MeshBuilder.CreateCylinder("clampHandle", { height: 0.07, diameter: 0.012, tessellation: 6 }, scene), blackMatte, engine).position.set(s * 0.06, -0.1, 0.11);
  }
  const prop = DINGHY.propPos;
  const pz = prop.z - pv.z, py = prop.y - pv.y; // hélice em relação ao pivô
  // capô (loft arredondado, menor que o da lancha)
  const cowlSecs: Vector3[][] = [];
  const NC = 14, ZF = 0.02, ZB = -0.46;
  const cowlSec = (t: number, z: number, scale = 1) => {
    const front = Math.sqrt(Math.min(1, t / 0.25));
    const w = 0.32 * (0.55 + 0.45 * front) * scale;
    const h = (0.34 * (0.6 + 0.4 * front) + 0.03 * t) * scale;
    return roundedRect(w, h, 0.07 * scale, 5).map((p) => new Vector3(p.x, p.y + 0.36 + 0.02 * t, z));
  };
  for (let i = 0; i <= NC; i++) { const t = i / NC; const z = ZF + (ZB - ZF) * t; cowlSecs.push(i === 0 ? cowlSec(0, z).map(() => new Vector3(0, 0.36, z)) : cowlSec(t, z)); }
  cowlSecs.push(cowlSec(1, ZB - 0.015, 0.9));
  cowlSecs.push(cowlSec(1, ZB - 0.02, 0).map((p) => new Vector3(0, p.y, p.z)));
  const cowl = add(MeshBuilder.CreateRibbon("cowl", { pathArray: cowlSecs, sideOrientation: Mesh.DOUBLESIDE }, scene), gelcoat, engine);
  colorize(cowl, (x, y) => (y > 0.36 && y < 0.385 && Math.abs(x) > 0.12 ? RED : y > 0.31 && y < 0.36 && Math.abs(x) > 0.13 ? NAVY : y < 0.24 ? new Color3(0.08, 0.08, 0.09) : WHITE));
  const lowerCowl = add(roundedBox("lowerCowl", scene, 0.26, 0.14, 0.38, 0.04), blackGloss, engine);
  lowerCowl.position.set(0, 0.16, -0.24);
  const decal = add(MeshBuilder.CreatePlane("decalHp", { width: 0.2, height: 0.125 }, scene), hpDecalMaterial(scene, DINGHY.enginePowerHp), engine);
  decal.position.set(0, 0.38, ZB - 0.025);
  // esguicho de refrigeração (lado de boreste)
  const telltale = new TransformNode("telltale", scene);
  telltale.parent = engine;
  telltale.position.set(0.135, 0.12, -0.32);
  add(MeshBuilder.CreateCylinder("telltaleNozzle", { height: 0.025, diameter: 0.014, tessellation: 8 }, scene), steel, telltale).rotation.z = Math.PI / 2;
  // perna (eixo curto), placa anti-ventilação, pé, quilha
  const legTop = 0.09, legBot = py + 0.13;
  const mid = add(MeshBuilder.CreateCylinder("midsection", { height: 1, diameter: 1, tessellation: 18 }, scene), blackGloss, engine);
  mid.scaling.set(0.075, legTop - legBot, 0.2);
  mid.position.set(0, (legTop + legBot) / 2, pz + 0.12);
  const plate = add(MeshBuilder.CreateCylinder("antiVentPlate", { height: 0.012, diameter: 1, tessellation: 24 }, scene), blackGloss, engine);
  plate.scaling.set(0.22, 1, 0.36);
  plate.position.set(0, py + 0.12, pz + 0.08);
  const torpedo = add(MeshBuilder.CreateCapsule("gearcase", { radius: 0.048, height: 0.34, orientation: new Vector3(0, 0, 1) }, scene), blackGloss, engine);
  torpedo.position.set(0, py, pz + 0.15);
  const strut = add(MeshBuilder.CreateCylinder("lowerStrut", { height: 0.13, diameter: 1, tessellation: 14 }, scene), blackGloss, engine);
  strut.scaling.set(0.055, 1, 0.17);
  strut.position.set(0, py + 0.06, pz + 0.14);
  const skeg = add(MeshBuilder.CreateBox("skeg", { width: 0.012, height: 0.14, depth: 0.13 }, scene), blackGloss, engine);
  skeg.position.set(0, py - 0.11, pz + 0.12);
  skeg.rotation.x = 0.25;
  const { propeller, propBlur } = buildPropeller(scene, engine, new Vector3(0, py, pz), DINGHY.propRadius, 0.3, steel, add, meshes);

  // cana do leme: sai da frente do motor, levemente para cima; manopla de acelerador (gira) na ponta
  const tillerPivot = new TransformNode("tillerPivot", scene);
  tillerPivot.parent = engine;
  tillerPivot.position.set(0, 0.17, -0.02);
  tillerPivot.rotation.x = -0.12; // aponta para a proa subindo um pouco
  const arm = add(MeshBuilder.CreateCylinder("tillerArm", { height: 0.5, diameterTop: 0.04, diameterBottom: 0.06, tessellation: 12 }, scene), blackGloss, tillerPivot);
  arm.rotation.x = Math.PI / 2; arm.position.z = 0.27;
  const grip = new TransformNode("twistGrip", scene);
  grip.parent = tillerPivot; grip.position.z = 0.58;
  const gripM = add(MeshBuilder.CreateCylinder("twistGripRubber", { height: 0.13, diameter: 0.045, tessellation: 14 }, scene), blackMatte, grip);
  gripM.rotation.x = Math.PI / 2;
  const gripMark = add(MeshBuilder.CreateBox("gripMark", { width: 0.006, height: 0.006, depth: 0.12 }, scene), gelcoat, grip);
  gripMark.position.set(0, 0.023, 0);
  const tillerHand = new TransformNode("tillerHand", scene);
  tillerHand.parent = tillerPivot; tillerHand.position.set(0, 0.025, 0.58);
  // alavanca de câmbio na lateral de boreste do capô inferior
  const shiftPivot = new TransformNode("shiftPivot", scene);
  shiftPivot.parent = engine; shiftPivot.position.set(0.14, 0.16, -0.12);
  const shift = add(MeshBuilder.CreateCylinder("shiftLever", { height: 0.12, diameter: 0.014, tessellation: 8 }, scene), blackMatte, shiftPivot);
  shift.position.y = 0.05;
  add(MeshBuilder.CreateSphere("shiftKnob", { diameter: 0.03, segments: 8 }, scene), blackMatte, shiftPivot).position.y = 0.11;
  // manopla da corda de partida (frente do capô)
  const pullHandle = add(MeshBuilder.CreateCapsule("pullHandle", { radius: 0.012, height: 0.08, orientation: new Vector3(1, 0, 0) }, scene), blackMatte, engine);
  pullHandle.position.set(0.04, 0.4, 0.035);

  // mão direita do piloto: na coxa ou segurando a lanterna à frente
  const thighRest = new TransformNode("thighRest", scene);
  thighRest.parent = root;
  const hs = DINGHY.seats.helm;
  const restR = new Vector3(hs.x + 0.12, DINGHY_FLOOR + 0.6, hs.z + 0.3);
  const holdR = new Vector3(hs.x + 0.16, DINGHY_FLOOR + 0.92, hs.z + 0.5);
  thighRest.position.copyFrom(restR);
  // lanterna de mão (corpo amarelo, lente) + foco de luz para a frente
  const lanternMat = pbr(scene, "lanternBody", new Color3(0.95, 0.75, 0.1), 0, 0.4);
  const lensMat = new StandardMaterial("lanternLens", scene);
  lensMat.diffuseColor = new Color3(0.9, 0.9, 0.8); lensMat.emissiveColor = Color3.Black();
  const lantern = new TransformNode("lantern", scene);
  lantern.parent = thighRest;
  lantern.rotation.x = 0.12;
  const lBody = add(MeshBuilder.CreateCylinder("lanternBodyM", { height: 0.2, diameterTop: 0.075, diameterBottom: 0.045, tessellation: 14 }, scene), lanternMat, lantern);
  lBody.rotation.x = Math.PI / 2; lBody.position.z = 0.05;
  const lens = add(MeshBuilder.CreateDisc("lanternLensM", { radius: 0.034, tessellation: 18 }, scene), lensMat, lantern);
  lens.position.z = 0.152; lens.rotation.y = Math.PI;
  const beam = new SpotLight("lanternBeam", new Vector3(0, 0, 0.16), new Vector3(0, -0.05, 1), 0.55, 8, scene);
  beam.parent = lantern;
  beam.diffuse = new Color3(1, 0.95, 0.82);
  beam.intensity = 6;
  beam.range = 60;
  beam.setEnabled(false);
  lantern.setEnabled(false);
  let lanternOn = false;
  // mão esquerda: manopla da cana (ou a coxa esquerda quando o motor está levantado)
  const leftRest = new TransformNode("leftRest", scene);
  leftRest.parent = root;
  leftRest.position.set(hs.x - 0.12, DINGHY_FLOOR + 0.6, hs.z + 0.3);
  const leftHand = new TransformNode("leftHand", scene);
  leftHand.parent = root;

  for (const m of meshes) m.isPickable = false;
  let twist = 0, shiftAng = 0;
  const controls: DinghyControls = {
    meshes: [],
    wheelGrip: leftHand,
    leverGrip: thighRest,
    pilotAboard: true,
    setLantern(on) { lanternOn = on; },
    update(dt, t) {
      const show = lanternOn && controls.pilotAboard;
      lantern.setEnabled(show); beam.setEnabled(show);
      lensMat.emissiveColor = show ? new Color3(1, 0.97, 0.85) : Color3.Black();
      thighRest.position = Vector3.Lerp(thighRest.position, show ? holdR : restR, Math.min(1, dt * 6));
      // manopla do acelerador gira com o acelerador real; câmbio F/N/R com o motor
      twist += (t.throttle * 1.6 - twist) * Math.min(1, dt * 12);
      grip.rotation.z = -twist;
      const target = t.gear === "F" ? 0.45 : t.gear === "R" ? -0.45 : 0;
      shiftAng += (target - shiftAng) * Math.min(1, dt * 14);
      shiftPivot.rotation.x = shiftAng;
      // com o motor levantado (tilt) o piloto solta a cana
      const onTiller = t.tiltDeg < 12;
      engine.computeWorldMatrix(true); tillerPivot.computeWorldMatrix(true);
      const gw = tillerHand.getAbsolutePosition();
      const inv = root.getWorldMatrix().clone(); inv.invert();
      const gl = Vector3.TransformCoordinates(gw, inv);
      const tgt = onTiller ? gl : leftRest.position;
      leftHand.position = Vector3.Lerp(leftHand.position, tgt, Math.min(1, dt * 10));
    },
  };
  return { root, engine, propeller, telltale, propBlur, lights: null, cockpitLid, meshes, controls };
};
