// Ekranoplano AR-W (WIG, 7 m). Origem = CG do barco seco (params WIG). X boreste, Y cima, Z proa.
// Casco de planeio de fibra (fundo em V com degrau, popa que sobe para a cauda), cabine tandem com capota de acrílico,
// ASA BAIXA de delta invertido (7 m) com flutuadores nas pontas e ailerons, pilone com o motor boxer turbo e a
// hélice pusher de 3 pás, cauda em T (deriva + leme, estabilizador + profundor no alto).
// As partes externas da asa DOBRAM para cima (`setFolded`) para caber na carretinha e na vaga do pátio.
// Nós do BoatVisual: `engine` = pivô vazio (o leme é girado aqui pela direção real), `propeller` = hélice (rpm real).
// As superfícies de comando leem a telemetria: leme = `steerDeg`, ailerons = `aileron`, profundor = `elevator`.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3 } from "@babylonjs/core";
import { WIG } from "../sim/params.ts";
import type { BoatTelemetry } from "../sim/boat.ts";
import type { VehicleInput } from "../gameplay/vehicleInput.ts";
import { type BoatVisual, pbr, roundedBox, colorize, hpDecalMaterial } from "./boatMesh.ts";

/** piso da cabine (os dois bancos em tandem) */
export const WIG_FLOOR = -0.25;
const Z_STERN = -3.5, Z_BOW = 3.5;
const DECK = 0.3, KEEL = -0.48;
const WY = -0.05;                     // plano da asa (= WIG_WING_Y da física)
const HINGE = 1.9;                    // dobradiça das partes externas da asa (|x|)
const TIP = WIG.wing!.span / 2;       // 3,5 m

export interface WigControls {
  meshes: Mesh[];
  /** manche (bastão central) */
  wheelGrip: TransformNode;
  /** manete de potência (à esquerda) */
  leverGrip: TransformNode;
  update(dt: number, t: BoatTelemetry, input: VehicleInput, maxSteerDeg: number): void;
}

export const buildWig = (scene: Scene): BoatVisual & { controls: WigControls; setFolded(on: boolean): void; snapFold(on: boolean): void } => {
  const root = new TransformNode("boat", scene);
  const meshes: Mesh[] = [];
  const add = (m: Mesh, mat: StandardMaterial | PBRMaterial, parent: TransformNode = root) => { m.material = mat; m.parent = parent; meshes.push(m); return m; };

  const paint = pbr(scene, "wigPaint", new Color3(1, 1, 1), 0.1, 0.25, 0.8);
  paint.backFaceCulling = false;
  const wingMat = pbr(scene, "wigWing", new Color3(0.93, 0.94, 0.95), 0.1, 0.3, 0.6);
  wingMat.backFaceCulling = false;
  const accent = pbr(scene, "wigAccent", new Color3(0.05, 0.35, 0.75), 0.2, 0.3, 0.6);
  accent.backFaceCulling = false;
  const dark = pbr(scene, "wigDark", new Color3(0.1, 0.11, 0.12), 0.4, 0.45);
  const steel = pbr(scene, "wigSteel", new Color3(0.86, 0.87, 0.9), 0.9, 0.25);
  const seatMat = pbr(scene, "wigSeat", new Color3(0.12, 0.13, 0.16), 0, 0.7);
  const floorMat = pbr(scene, "wigFloor", new Color3(0.3, 0.31, 0.33), 0.2, 0.75);
  floorMat.backFaceCulling = false;
  const propMat = pbr(scene, "wigProp", new Color3(0.12, 0.12, 0.13), 0.3, 0.35, 0.5); // pás de compósito
  const tipMat = pbr(scene, "wigPropTip", new Color3(0.95, 0.85, 0.1), 0, 0.4);
  const glass = new PBRMaterial("wigGlass", scene);
  glass.albedoColor = new Color3(0.55, 0.7, 0.8); glass.metallic = 0; glass.roughness = 0.05; glass.alpha = 0.22; glass.backFaceCulling = false;
  const WHITE = new Color3(0.95, 0.96, 0.97), BLUE = new Color3(0.05, 0.35, 0.75), BOTTOMC = new Color3(0.18, 0.2, 0.24);

  // ---------- casco (fundo em V, costado, popa sobe para a cauda) — aberto em cima na cabine ----------
  const half = (z: number) => {
    if (z > 1.8) return 0.8 * Math.sqrt(Math.max(0.02, 1 - ((z - 1.8) / (Z_BOW - 1.8 + 0.05)) ** 2));
    if (z < -1.6) return 0.8 - 0.42 * ((-1.6 - z) / (-1.6 - Z_STERN));
    return 0.8;
  };
  const keel = (z: number) => (z > 1.4 ? KEEL + 0.5 * ((z - 1.4) / (Z_BOW - 1.4)) ** 1.7 : z < -2.2 ? KEEL + 0.25 * ((-2.2 - z) / (-2.2 - Z_STERN)) : KEEL);
  const sec = (z: number) => {
    const h = half(z), k = keel(z), c = Math.max(k + 0.04, -0.3 + (k - KEEL) * 0.6);
    return [new Vector3(-h, DECK, z), new Vector3(-h, c, z), new Vector3(-h * 0.35, (c + k) / 2, z), new Vector3(0, k, z),
      new Vector3(h * 0.35, (c + k) / 2, z), new Vector3(h, c, z), new Vector3(h, DECK, z)];
  };
  const hz: number[] = [];
  for (let i = 0; i <= 36; i++) hz.push(Z_STERN + (Z_BOW - Z_STERN) * (i / 36));
  const hull = add(MeshBuilder.CreateRibbon("wigHull", { pathArray: hz.map(sec), sideOrientation: Mesh.DOUBLESIDE }, scene), paint);
  colorize(hull, (_x, y, z) => (y < -0.3 ? BOTTOMC : y > 0.12 && y < 0.2 && z > -2.5 ? BLUE : WHITE));
  const sternS = sec(Z_STERN);
  add(MeshBuilder.CreateRibbon("wigTransom", { pathArray: [sternS, sternS.map(() => new Vector3(0, DECK, Z_STERN))], sideOrientation: Mesh.DOUBLESIDE }, scene), paint);
  // convés de proa e de popa (a cabine fica aberta entre z −0,4 e 1,95, debaixo da capota)
  const deck = (z0: number, z1: number, name: string) => {
    const paths: Vector3[][] = [];
    for (let i = 0; i <= 10; i++) {
      const z = z0 + (z1 - z0) * (i / 10), h = half(z);
      paths.push([new Vector3(-h, DECK, z), new Vector3(-h * 0.5, DECK + 0.1, z), new Vector3(0, DECK + 0.13, z), new Vector3(h * 0.5, DECK + 0.1, z), new Vector3(h, DECK, z)]);
    }
    return add(MeshBuilder.CreateRibbon(name, { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE }, scene), paint);
  };
  deck(1.95, Z_BOW, "wigForeDeck"); deck(Z_STERN, -0.4, "wigAftDeck");
  add(MeshBuilder.CreateBox("wigFloorM", { width: 1.45, height: 0.02, depth: 2.3 }, scene), floorMat).position.set(0, WIG_FLOOR, 0.78);
  add(MeshBuilder.CreateBox("skeg", { width: 0.5, height: 0.01, depth: 0.6 }, scene), dark).position.set(0, KEEL - 0.005, -1.6);
  // degrau do fundo (planeio: solta a água atrás dele)
  add(MeshBuilder.CreateBox("wigStep", { width: 1.2, height: 0.03, depth: 0.04 }, scene), dark).position.set(0, KEEL + 0.03, -0.9);

  // ---------- capota de acrílico (tandem) + arco ----------
  const canopy = add(MeshBuilder.CreateSphere("wigCanopy", { diameter: 1, segments: 24, slice: 0.5 }, scene), glass);
  canopy.scaling.set(1.45, 0.95, 2.5); canopy.position.set(0, DECK + 0.02, 0.78);
  const arch = add(MeshBuilder.CreateTorus("wigArch", { diameter: 1.42, thickness: 0.045, tessellation: 32 }, scene), dark);
  arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2; arch.scaling.set(1, 1, 0.67); arch.position.set(0, DECK + 0.02, 0.35);

  // ---------- bancos em tandem, manche e manete ----------
  const S = WIG.seats;
  for (const sz of [S.helm.z, S.passenger.z]) {
    add(roundedBox("wigSeatPan", scene, 0.5, 0.1, 0.48, 0.04), seatMat).position.set(0, WIG_FLOOR + 0.25, sz - 0.04);
    const back = add(roundedBox("wigSeatBack", scene, 0.5, 0.62, 0.08, 0.04), seatMat);
    back.position.set(0, WIG_FLOOR + 0.6, sz - 0.32); back.rotation.x = -0.28;
  }
  // painel de instrumentos à frente do piloto
  const dash = add(roundedBox("wigDash", scene, 0.9, 0.24, 0.1, 0.04), dark);
  dash.position.set(0, DECK + 0.08, S.helm.z + 0.62); dash.rotation.x = -0.4;
  const stickPivot = new TransformNode("wigStick", scene);
  stickPivot.parent = root; stickPivot.position.set(0, WIG_FLOOR + 0.02, S.helm.z + 0.4);
  add(MeshBuilder.CreateCylinder("wigStickRod", { height: 0.52, diameter: 0.028, tessellation: 8 }, scene), steel, stickPivot).position.y = 0.26;
  add(MeshBuilder.CreateCylinder("wigStickGrip", { height: 0.11, diameter: 0.045, tessellation: 10 }, scene), dark, stickPivot).position.y = 0.55;
  const stickGrip = new TransformNode("wigStickGripPt", scene); stickGrip.parent = stickPivot; stickGrip.position.y = 0.54;
  const thrPivot = new TransformNode("wigThrottle", scene);
  thrPivot.parent = root; thrPivot.position.set(-0.5, DECK - 0.05, S.helm.z + 0.05);
  add(MeshBuilder.CreateBox("wigThrQuadrant", { width: 0.06, height: 0.08, depth: 0.3 }, scene), dark).position.set(-0.5, DECK - 0.07, S.helm.z + 0.05);
  add(MeshBuilder.CreateCylinder("wigThrRod", { height: 0.18, diameter: 0.02, tessellation: 6 }, scene), steel, thrPivot).position.y = 0.09;
  add(MeshBuilder.CreateSphere("wigThrKnob", { diameter: 0.05, segments: 8 }, scene), dark, thrPivot).position.y = 0.18;
  const thrGrip = new TransformNode("wigThrGripPt", scene); thrGrip.parent = thrPivot; thrGrip.position.y = 0.17;

  // ---------- asa: delta invertido (perfil grosso na raiz, fino na ponta), leve anedro ----------
  // corda: raiz (|x| = 0,75) do bordo de ataque z = 1,0 ao de fuga z = −1,6; ponta (|x| = 3,5) z = −0,5 … −1,4
  const leZ = (ax: number) => 1.0 - 1.5 * ((ax - 0.75) / (TIP - 0.75));
  const teZ = (ax: number) => -1.6 + 0.2 * ((ax - 0.75) / (TIP - 0.75));
  const wy = (ax: number) => WY - 0.08 * ((ax - 0.75) / (TIP - 0.75));
  const foil = (ax: number, s: number, hingeX: number) => {
    const le = leZ(ax), te = teZ(ax), ch = le - te, th = 0.13 * ch * 0.5, y = wy(ax);
    const pts: Vector3[] = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push(new Vector3(s * ax - hingeX, y + th * Math.sin(Math.PI * u ** 0.7), le - ch * u)); }
    for (let i = 9; i >= 1; i--) { const u = i / 10; pts.push(new Vector3(s * ax - hingeX, y - th * 0.35 * Math.sin(Math.PI * u ** 0.7), le - ch * u)); }
    return pts;
  };
  const folds: TransformNode[] = [];
  const ailerons: { node: TransformNode; s: number }[] = [];
  for (const s of [-1, 1]) {
    // parte interna (fixa no casco)
    const inner: Vector3[][] = [];
    for (let i = 0; i <= 4; i++) inner.push(foil(0.75 + (HINGE - 0.75) * (i / 4), s, 0));
    const wi = add(MeshBuilder.CreateRibbon("wigWingIn", { pathArray: inner, closePath: true, sideOrientation: Mesh.DOUBLESIDE }, scene), wingMat);
    colorize(wi, () => WHITE);
    // parte externa (dobra para cima na dobradiça)
    const hinge = new TransformNode("wigFold", scene); hinge.parent = root; hinge.position.set(s * HINGE, wy(HINGE), 0);
    folds.push(hinge);
    const outer: Vector3[][] = [];
    for (let i = 0; i <= 6; i++) outer.push(foil(HINGE + (TIP - HINGE) * (i / 6), s, s * HINGE).map((p) => new Vector3(p.x, p.y - wy(HINGE), p.z)));
    const wo = add(MeshBuilder.CreateRibbon("wigWingOut", { pathArray: outer, closePath: true, sideOrientation: Mesh.DOUBLESIDE }, scene), wingMat, hinge);
    colorize(wo, (x) => (Math.abs(x) > TIP - HINGE - 0.35 ? BLUE : WHITE));
    // aileron (bordo de fuga da parte externa)
    const ail = new TransformNode("wigAileron", scene); ail.parent = hinge;
    const ax0 = HINGE + 0.15, ax1 = TIP - 0.25, axm = (ax0 + ax1) / 2;
    ail.position.set(s * (axm - HINGE), wy(axm) - wy(HINGE), teZ(axm) + 0.28);
    add(MeshBuilder.CreateBox("wigAileronM", { width: ax1 - ax0, height: 0.025, depth: 0.28 }, scene), accent, ail).position.z = -0.14;
    ailerons.push({ node: ail, s });
    // flutuador da ponta + suporte
    const fl = WIG.wing!.floats[s < 0 ? 0 : 1];
    const fz = fl.pos.z, fy = fl.pos.y - wy(HINGE);
    const float = add(MeshBuilder.CreateCapsule("wigFloat", { height: 1.25, radius: fl.radius, tessellation: 16, subdivisions: 2 }, scene), accent, hinge);
    float.rotation.x = Math.PI / 2; float.position.set(s * (TIP - 0.05 - HINGE), fy, fz);
    add(MeshBuilder.CreateBox("wigFloatStrut", { width: 0.05, height: 0.16, depth: 0.5 }, scene), dark, hinge).position.set(s * (TIP - 0.05 - HINGE), fy + 0.14, fz);
    // carenagem da raiz (junta da asa no casco)
    const fair = add(roundedBox("wigFairing", scene, 0.18, 0.2, 2.4, 0.08), paint);
    fair.position.set(s * 0.78, WY + 0.04, -0.3);
  }

  // ---------- pilone + motor boxer turbo + hélice pusher de 3 pás ----------
  const pp = WIG.propPos, R = WIG.propRadius;
  const pylon = add(roundedBox("wigPylon", scene, 0.16, pp.y - DECK, 0.9, 0.06), paint);
  pylon.position.set(0, (pp.y + DECK) / 2, -0.95);
  const nacelle = add(MeshBuilder.CreateSphere("wigNacelle", { diameter: 1, segments: 18 }, scene), paint);
  nacelle.scaling.set(0.62, 0.5, 1.45); nacelle.position.set(0, pp.y, pp.z + 0.75);
  add(roundedBox("wigScoop", scene, 0.34, 0.14, 0.5, 0.05), dark).position.set(0, pp.y - 0.27, pp.z + 0.95); // radiador (cabeçotes a líquido)
  for (const s of [-1, 1]) {
    // 4 cilindros opostos aparecendo pelas aberturas da carenagem
    for (const dz of [-0.12, 0.18]) {
      const cyl = add(MeshBuilder.CreateCylinder("wigCyl", { height: 0.12, diameter: 0.15, tessellation: 12 }, scene), steel);
      cyl.rotation.z = Math.PI / 2; cyl.position.set(s * 0.3, pp.y, pp.z + 0.75 + dz);
    }
  }
  const hpDecal = add(MeshBuilder.CreatePlane("decalHp", { width: 0.28, height: 0.17 }, scene), hpDecalMaterial(scene, WIG.enginePowerHp));
  hpDecal.position.set(0.315, pp.y + 0.05, pp.z + 0.75); hpDecal.rotation.y = -Math.PI / 2;
  // escape do turbo (sai embaixo, atrás)
  const exh = add(MeshBuilder.CreateCylinder("wigExhaust", { height: 0.3, diameter: 0.07, tessellation: 10 }, scene), steel);
  exh.rotation.x = Math.PI / 2 - 0.4; exh.position.set(0.18, pp.y - 0.22, pp.z + 0.12);
  const propeller = new TransformNode("wigPropeller", scene);
  propeller.parent = root; propeller.position.set(pp.x, pp.y, pp.z);
  add(MeshBuilder.CreateSphere("wigSpinner", { diameter: 0.24, segments: 12 }, scene), steel, propeller).scaling.z = 1.5;
  for (let k = 0; k < 3; k++) {
    const blade = new TransformNode("wigBladeRoot", scene); blade.parent = propeller; blade.rotation.z = (k * 2 * Math.PI) / 3;
    const b = add(MeshBuilder.CreateBox("wigBlade", { width: 0.13, height: R - 0.1, depth: 0.025 }, scene), propMat, blade);
    b.position.y = (R - 0.1) / 2 + 0.08; b.rotation.y = 0.35;
    const tip = add(MeshBuilder.CreateBox("wigBladeTip", { width: 0.13, height: 0.07, depth: 0.027 }, scene), tipMat, blade);
    tip.position.y = R - 0.04; tip.rotation.y = 0.35;
  }
  const propBlur = new PBRMaterial("wigPropBlur", scene);
  propBlur.albedoColor = new Color3(0.2, 0.2, 0.22); propBlur.metallic = 0; propBlur.roughness = 0.6; propBlur.alpha = 0; propBlur.backFaceCulling = false;
  const disc = MeshBuilder.CreateDisc("propDisc", { radius: R, tessellation: 48 }, scene);
  disc.material = propBlur; disc.parent = propeller; disc.position.z = -0.01; meshes.push(disc);

  // ---------- cauda em T: deriva + leme, estabilizador + profundor ----------
  const rp = WIG.airProp!.rudderPos;
  const fin = add(MeshBuilder.CreateRibbon("wigFin", { pathArray: [
    [new Vector3(0, DECK, -2.55), new Vector3(0, DECK, Z_STERN + 0.1)],
    [new Vector3(0, 2.0, -3.25), new Vector3(0, 2.0, -3.8)],
  ], sideOrientation: Mesh.DOUBLESIDE }, scene), paint);
  colorize(fin, (_x, y) => (y > 1.6 ? BLUE : WHITE));
  const engine = new TransformNode("enginePivot", scene); engine.parent = root; engine.position.set(rp.x, rp.y, rp.z);
  const rudder = new TransformNode("wigRudderPivot", scene); rudder.parent = root; rudder.position.set(0, (DECK + 2.0) / 2, Z_STERN + 0.1);
  add(MeshBuilder.CreateBox("wigRudder", { width: 0.03, height: 1.55, depth: 0.42 }, scene), accent, rudder).position.z = -0.2;
  const stabY = 2.05, stabZ = -3.5;
  const stab = add(MeshBuilder.CreateBox("wigStab", { width: 3.1, height: 0.05, depth: 0.75 }, scene), paint);
  stab.position.set(0, stabY, stabZ);
  const elevator = new TransformNode("wigElevator", scene); elevator.parent = root; elevator.position.set(0, stabY, stabZ - 0.38);
  add(MeshBuilder.CreateBox("wigElevatorM", { width: 3.0, height: 0.03, depth: 0.35 }, scene), accent, elevator).position.z = -0.17;

  // tampa só-profundidade da cabine (a água não aparece dentro)
  const lidMat = new StandardMaterial("wigLidMat", scene);
  lidMat.disableColorWrite = true; lidMat.forceDepthWrite = true; lidMat.alpha = 0.01; lidMat.backFaceCulling = false;
  const cockpitLid = MeshBuilder.CreateBox("cockpitLid", { width: 1.5, height: 0.005, depth: 2.4 }, scene);
  cockpitLid.material = lidMat; cockpitLid.parent = root; cockpitLid.position.set(0, WIG_FLOOR + 0.01, 0.78); cockpitLid.alphaIndex = 0;

  // esguicho: não tem (radiador no pilone) — o nó existe por contrato, fora de vista
  const telltale = new TransformNode("telltale", scene); telltale.parent = root; telltale.position.set(0, -5, 0);

  for (const m of meshes) m.isPickable = false;
  let stickX = 0, stickY = 0, thr = 0, fold = 0, foldTarget = 0;
  const applyFold = () => { for (let i = 0; i < folds.length; i++) folds[i].rotation.z = (i === 0 ? -1 : 1) * fold * 1.95; };
  const controls: WigControls = {
    meshes: [],
    wheelGrip: stickGrip,
    leverGrip: thrGrip,
    update(dt, t, _input, maxSteerDeg) {
      const a = (t.steerDeg * Math.PI) / 180;
      rudder.rotation.y = -a;
      const ail = t.aileron * 0.25;
      for (const x of ailerons) x.node.rotation.x = x.s * ail; // direita: asa de boreste com o aileron para cima
      elevator.rotation.x = -t.elevator * 0.3;                  // puxar (+) = bordo de fuga para cima
      stickX += (t.aileron - stickX) * Math.min(1, dt * 12);
      stickY += (t.elevator - stickY) * Math.min(1, dt * 12);
      stickPivot.rotation.z = -stickX * 0.3; stickPivot.rotation.x = -stickY * 0.25;
      thr += (t.throttle - thr) * Math.min(1, dt * 12);
      thrPivot.rotation.x = -0.5 + thr * 1.0;
      if (fold !== foldTarget) { fold += Math.sign(foldTarget - fold) * Math.min(Math.abs(foldTarget - fold), dt * 0.6); applyFold(); }
    },
  };
  /** dobra/desdobra a asa (anima ~1,7 s no `update`); `snapFold` = na hora (estacionado no pátio) */
  const setFolded = (on: boolean) => { foldTarget = on ? 1 : 0; };
  const snapFold = (on: boolean) => { fold = foldTarget = on ? 1 : 0; applyFold(); };
  return { root, engine, propeller, telltale, propBlur, lights: null, cockpitLid, meshes, controls, setFolded, snapFold };
};
