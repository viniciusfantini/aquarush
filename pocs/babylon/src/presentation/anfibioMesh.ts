// Anfíbio AR-A (avião anfíbio leve, 7 m). Origem = CG do avião vazio (params AMPHIB). X boreste, Y cima, Z proa.
// Casco de fibra branco com o fundo em V e o DEGRAU logo atrás do CG, "seawings" (sponsons) laterais, cabine de dois
// lugares lado a lado sob uma capota grande, ASA ALTA de 10,6 m em cima da cabine (dobra para trás ao longo do casco),
// motor boxer na carenagem atrás da cabine com a hélice pusher de 3 pás, cone de cauda que sobe até a cauda cruciforme.
// As superfícies de comando leem a telemetria: leme = `steerDeg`, ailerons = `aileron`, profundor = `elevator`.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3 } from "@babylonjs/core";
import { AMPHIB } from "../sim/params.ts";
import type { BoatTelemetry } from "../sim/boat.ts";
import type { VehicleInput } from "../gameplay/vehicleInput.ts";
import { type BoatVisual, pbr, roundedBox, colorize, hpDecalMaterial } from "./boatMesh.ts";

/** piso da cabine */
export const AMPH_FLOOR = -0.3;
const Z_STERN = -3.55, Z_BOW = 3.0;
const KEEL = -0.48;
const WY = 1.05;                          // plano da asa (= AMPH_WING_Y da física)
const SPAN = AMPHIB.wing!.span / 2;      // 5,3 m
const ROOT_X = 0.95;                      // raiz da asa (dobradiça): fora do disco da hélice (r 0,82) para dobrar sem bater nela
const DIH = 0.05;                         // diedro visual (rad)

export interface AmphibControls {
  meshes: Mesh[];
  wheelGrip: TransformNode;
  leverGrip: TransformNode;
  update(dt: number, t: BoatTelemetry, input: VehicleInput, maxSteerDeg: number): void;
}

export const buildAmphib = (scene: Scene): BoatVisual & { controls: AmphibControls; setFolded(on: boolean): void; snapFold(on: boolean): void } => {
  const root = new TransformNode("boat", scene);
  const meshes: Mesh[] = [];
  const add = (m: Mesh, mat: StandardMaterial | PBRMaterial, parent: TransformNode = root) => { m.material = mat; m.parent = parent; meshes.push(m); return m; };

  const paint = pbr(scene, "amPaint", new Color3(1, 1, 1), 0.1, 0.22, 0.9);
  paint.backFaceCulling = false;
  const accent = pbr(scene, "amAccent", new Color3(0.95, 0.45, 0.08), 0.2, 0.3, 0.7);
  accent.backFaceCulling = false;
  const grey = pbr(scene, "amGrey", new Color3(0.32, 0.34, 0.37), 0.3, 0.4, 0.5);
  grey.backFaceCulling = false;
  const dark = pbr(scene, "amDark", new Color3(0.09, 0.1, 0.11), 0.4, 0.45);
  const steel = pbr(scene, "amSteel", new Color3(0.86, 0.87, 0.9), 0.9, 0.25);
  const seatMat = pbr(scene, "amSeat", new Color3(0.2, 0.2, 0.22), 0, 0.7);
  const floorMat = pbr(scene, "amFloor", new Color3(0.26, 0.27, 0.29), 0.2, 0.75);
  floorMat.backFaceCulling = false;
  const propMat = pbr(scene, "amProp", new Color3(0.1, 0.1, 0.11), 0.3, 0.35, 0.5);
  const tipMat = pbr(scene, "amPropTip", new Color3(0.95, 0.85, 0.1), 0, 0.4);
  const glass = new PBRMaterial("amGlass", scene);
  glass.albedoColor = new Color3(0.45, 0.6, 0.72); glass.metallic = 0; glass.roughness = 0.05; glass.alpha = 0.25; glass.backFaceCulling = false;
  const WHITE = new Color3(0.96, 0.97, 0.98), GREY = new Color3(0.32, 0.34, 0.37), ORANGE = new Color3(0.95, 0.45, 0.08);

  // ---------- casco: proa arredondada, fundo em V até o degrau, "afterbody" que sobe até o cone de cauda ----------
  const half = (z: number) => {
    if (z > 1.6) return 0.66 * Math.sqrt(Math.max(0.03, 1 - ((z - 1.6) / (Z_BOW - 1.6 + 0.05)) ** 2));
    if (z < -0.6) return 0.66 - 0.5 * ((-0.6 - z) / (-0.6 - Z_STERN)) ** 0.8;
    return 0.66;
  };
  // fundo: proa curva, plano em V até o degrau (z ≈ 0), depois sobe para a cauda
  const keel = (z: number) => z > 1.3 ? KEEL + 0.42 * ((z - 1.3) / (Z_BOW - 1.3)) ** 1.6 : z > -0.05 ? KEEL : -0.4 + 1.25 * ((-0.05 - z) / (-0.05 - Z_STERN)) ** 1.3;
  const top = (z: number) => z > 1.2 ? 0.35 - 0.25 * ((z - 1.2) / (Z_BOW - 1.2)) ** 1.5 : z > -1.0 ? 0.35 : 0.35 + 0.45 * ((-1.0 - z) / (-1.0 - Z_STERN));
  const sec = (z: number) => {
    const h = half(z), k = keel(z), tp = top(z), c = k + Math.min(0.22, (tp - k) * 0.35);
    return [new Vector3(0, tp + 0.08, z), new Vector3(-h * 0.7, tp, z), new Vector3(-h, (tp + c) / 2, z), new Vector3(-h * 0.9, c, z), new Vector3(0, k, z),
      new Vector3(h * 0.9, c, z), new Vector3(h, (tp + c) / 2, z), new Vector3(h * 0.7, tp, z), new Vector3(0, tp + 0.08, z)];
  };
  const hz: number[] = [];
  for (let i = 0; i <= 40; i++) hz.push(Z_STERN + (Z_BOW - Z_STERN) * (i / 40));
  // (a cabine fica aberta em cima entre z −0,35 e 1,55: a capota cobre)
  const hullPaths = hz.map((z) => {
    const s = sec(z);
    if (z > -0.35 && z < 1.55) { s[0] = s[1].clone(); s[8] = s[7].clone(); }
    return s;
  });
  const hull = add(MeshBuilder.CreateRibbon("amHull", { pathArray: hullPaths, sideOrientation: Mesh.DOUBLESIDE }, scene), paint);
  colorize(hull, (_x, y, z) => (y < -0.25 && z > -0.2 ? GREY : y > 0.0 && y < 0.07 && z > -2 ? ORANGE : WHITE));
  add(MeshBuilder.CreateBox("skeg", { width: 0.4, height: 0.01, depth: 0.5 }, scene), dark).position.set(0, KEEL - 0.005, -0.6);
  add(MeshBuilder.CreateBox("amStep", { width: 1.15, height: 0.06, depth: 0.04 }, scene), grey).position.set(0, KEEL + 0.05, -0.05); // degrau
  add(MeshBuilder.CreateBox("amFloorM", { width: 1.15, height: 0.02, depth: 1.9 }, scene), floorMat).position.set(0, AMPH_FLOOR, 0.6);

  // ---------- sponsons ("seawings"): asinhas do casco, rente à água ----------
  for (const s of [-1, 1]) {
    const pts: Vector3[][] = [];
    for (const [x, ch, y] of [[0.6, 1.5, -0.12], [1.32, 0.9, -0.2]] as const) {
      const sx = s * x, le = 0.95, te = le - ch;
      pts.push([new Vector3(sx, y + 0.06, le), new Vector3(sx, y + 0.09, le - ch * 0.3), new Vector3(sx, y, te), new Vector3(sx, y - 0.06, le - ch * 0.4), new Vector3(sx, y + 0.06, le)]);
    }
    const sp = add(MeshBuilder.CreateRibbon("amSponson", { pathArray: pts, sideOrientation: Mesh.DOUBLESIDE }, scene), paint);
    colorize(sp, (x) => (Math.abs(x) > 1.2 ? ORANGE : WHITE));
  }

  // ---------- capota (lado a lado) + painel ----------
  const canopy = add(MeshBuilder.CreateSphere("amCanopy", { diameter: 1, segments: 24, slice: 0.5 }, scene), glass);
  canopy.scaling.set(1.32, 1.25, 2.3); canopy.position.set(0, 0.33, 0.55);
  const dash = add(roundedBox("amDash", scene, 1.1, 0.22, 0.14, 0.05), dark);
  dash.position.set(0, 0.38, 1.35); dash.rotation.x = -0.35;
  const S = AMPHIB.seats;
  for (const sx of [S.helm.x, S.passenger.x]) {
    add(roundedBox("amSeatPan", scene, 0.46, 0.1, 0.46, 0.04), seatMat).position.set(sx, AMPH_FLOOR + 0.24, S.helm.z - 0.05);
    const back = add(roundedBox("amSeatBack", scene, 0.46, 0.6, 0.08, 0.04), seatMat);
    back.position.set(sx, AMPH_FLOOR + 0.58, S.helm.z - 0.33); back.rotation.x = -0.25;
  }
  // manche do piloto (bastão) e manete entre os bancos
  const stickPivot = new TransformNode("amStick", scene); stickPivot.parent = root; stickPivot.position.set(S.helm.x, AMPH_FLOOR + 0.02, S.helm.z + 0.38);
  add(MeshBuilder.CreateCylinder("amStickRod", { height: 0.5, diameter: 0.026, tessellation: 8 }, scene), steel, stickPivot).position.y = 0.25;
  add(MeshBuilder.CreateCylinder("amStickGrip", { height: 0.1, diameter: 0.045, tessellation: 10 }, scene), dark, stickPivot).position.y = 0.53;
  const stickGrip = new TransformNode("amStickGripPt", scene); stickGrip.parent = stickPivot; stickGrip.position.y = 0.52;
  const thrPivot = new TransformNode("amThrottle", scene); thrPivot.parent = root; thrPivot.position.set(0, AMPH_FLOOR + 0.3, S.helm.z + 0.15);
  add(MeshBuilder.CreateBox("amConsole", { width: 0.14, height: 0.3, depth: 0.5 }, scene), dark).position.set(0, AMPH_FLOOR + 0.15, S.helm.z + 0.15);
  add(MeshBuilder.CreateCylinder("amThrRod", { height: 0.16, diameter: 0.018, tessellation: 6 }, scene), steel, thrPivot).position.y = 0.08;
  add(MeshBuilder.CreateSphere("amThrKnob", { diameter: 0.045, segments: 8 }, scene), dark, thrPivot).position.y = 0.16;
  const thrGrip = new TransformNode("amThrGripPt", scene); thrGrip.parent = thrPivot; thrGrip.position.y = 0.15;

  // ---------- asa alta (dobra para trás na raiz) ----------
  const leZ = (ax: number) => 0.92 - 0.25 * ((ax - ROOT_X) / (SPAN - ROOT_X));
  const teZ = (ax: number) => -0.33 + 0.1 * ((ax - ROOT_X) / (SPAN - ROOT_X));
  const foil = (ax: number, s: number) => {
    const le = leZ(ax), te = teZ(ax), ch = le - te, th = 0.13 * ch, y = (ax - ROOT_X) * DIH;
    const pts: Vector3[] = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push(new Vector3(s * (ax - ROOT_X), y + th * Math.sin(Math.PI * u ** 0.6), le - ch * u)); }
    for (let i = 9; i >= 1; i--) { const u = i / 10; pts.push(new Vector3(s * (ax - ROOT_X), y - th * 0.3 * Math.sin(Math.PI * u ** 0.6), le - ch * u)); }
    return pts;
  };
  // centro da asa (fixo, em cima da cabine) e as duas asas (nós das dobradiças, no bordo de fuga da raiz)
  add(roundedBox("amWingCenter", scene, 2 * ROOT_X + 0.02, 0.14, 1.25, 0.06), paint).position.set(0, WY + 0.02, 0.3);
  const folds: { node: TransformNode; s: number }[] = [];
  const ailerons: { node: TransformNode; s: number }[] = [];
  for (const s of [-1, 1]) {
    const hinge = new TransformNode("amFold", scene); hinge.parent = root; hinge.position.set(s * ROOT_X, WY, teZ(ROOT_X));
    folds.push({ node: hinge, s });
    const paths: Vector3[][] = [];
    for (let i = 0; i <= 8; i++) paths.push(foil(ROOT_X + (SPAN - ROOT_X) * (i / 8), s).map((p) => new Vector3(p.x, p.y, p.z - teZ(ROOT_X))));
    if (s < 0) paths.reverse(); // (espelhada: a ordem invertida mantém as normais para fora — senão a asa esquerda ficava escura)
    const wing = add(MeshBuilder.CreateRibbon("amWing", { pathArray: paths, closePath: true, sideOrientation: Mesh.DOUBLESIDE }, scene), paint, hinge);
    colorize(wing, (x) => (Math.abs(x) > SPAN - ROOT_X - 0.45 ? ORANGE : WHITE));
    // ponta levantada (winglet curto)
    const tip = add(MeshBuilder.CreateBox("amWingTip", { width: 0.04, height: 0.22, depth: 0.9 }, scene), accent, hinge);
    tip.position.set(s * (SPAN - ROOT_X), (SPAN - ROOT_X) * DIH + 0.08, leZ(SPAN) - 0.45 - teZ(ROOT_X)); tip.rotation.z = -s * 0.35;
    // aileron (externo)
    const a0 = 2.6, a1 = SPAN - 0.25, am = (a0 + a1) / 2;
    const ail = new TransformNode("amAileron", scene); ail.parent = hinge;
    ail.position.set(s * (am - ROOT_X), (am - ROOT_X) * DIH, teZ(am) + 0.25 - teZ(ROOT_X));
    add(MeshBuilder.CreateBox("amAileronM", { width: a1 - a0, height: 0.03, depth: 0.25 }, scene), grey, ail).position.z = -0.125;
    ailerons.push({ node: ail, s });
  }

  // ---------- motor (carenagem atrás da cabine) + hélice pusher de 3 pás ----------
  const pp = AMPHIB.propPos, R = AMPHIB.propRadius;
  const cowl = add(MeshBuilder.CreateSphere("amCowl", { diameter: 1, segments: 18 }, scene), paint);
  cowl.scaling.set(0.62, 0.5, 1.6); cowl.position.set(0, pp.y - 0.12, pp.z + 0.75);
  add(roundedBox("amScoop", scene, 0.32, 0.12, 0.42, 0.05), grey).position.set(0, pp.y + 0.14, pp.z + 1.0);
  const hpDecal = add(MeshBuilder.CreatePlane("decalHp", { width: 0.26, height: 0.16 }, scene), hpDecalMaterial(scene, AMPHIB.enginePowerHp));
  hpDecal.position.set(0.31, pp.y - 0.08, pp.z + 0.75); hpDecal.rotation.y = -Math.PI / 2;
  const propeller = new TransformNode("amPropeller", scene); propeller.parent = root; propeller.position.set(pp.x, pp.y, pp.z);
  add(MeshBuilder.CreateSphere("amSpinner", { diameter: 0.22, segments: 12 }, scene), accent, propeller).scaling.z = 1.6;
  for (let k = 0; k < 3; k++) {
    const blade = new TransformNode("amBladeRoot", scene); blade.parent = propeller; blade.rotation.z = (k * 2 * Math.PI) / 3;
    const b = add(MeshBuilder.CreateBox("amBlade", { width: 0.12, height: R - 0.1, depth: 0.025 }, scene), propMat, blade);
    b.position.y = (R - 0.1) / 2 + 0.08; b.rotation.y = 0.35;
    const t = add(MeshBuilder.CreateBox("amBladeTip", { width: 0.12, height: 0.07, depth: 0.027 }, scene), tipMat, blade);
    t.position.y = R - 0.04; t.rotation.y = 0.35;
  }
  const propBlur = new PBRMaterial("amPropBlur", scene);
  propBlur.albedoColor = new Color3(0.2, 0.2, 0.22); propBlur.metallic = 0; propBlur.roughness = 0.6; propBlur.alpha = 0; propBlur.backFaceCulling = false;
  const disc = MeshBuilder.CreateDisc("propDisc", { radius: R, tessellation: 48 }, scene);
  disc.material = propBlur; disc.parent = propeller; disc.position.z = -0.01; meshes.push(disc);

  // ---------- cauda cruciforme: deriva + leme, estabilizador no meio da deriva + profundor ----------
  const fin = add(MeshBuilder.CreateRibbon("amFin", { pathArray: [
    [new Vector3(0, 0.75, -2.85), new Vector3(0, 0.78, Z_STERN + 0.05)],
    [new Vector3(0, 2.2, -3.45), new Vector3(0, 2.2, -3.95)],
  ], sideOrientation: Mesh.DOUBLESIDE }, scene), paint);
  colorize(fin, (_x, y) => (y > 1.95 ? ORANGE : WHITE));
  const rp = AMPHIB.airProp!.rudderPos;
  const engine = new TransformNode("enginePivot", scene); engine.parent = root; engine.position.set(rp.x, rp.y, rp.z);
  const rudder = new TransformNode("amRudderPivot", scene); rudder.parent = root; rudder.position.set(0, 1.5, -3.75);
  add(MeshBuilder.CreateBox("amRudder", { width: 0.03, height: 1.35, depth: 0.32 }, scene), grey, rudder).position.z = -0.16;
  const stab = add(MeshBuilder.CreateBox("amStab", { width: 2.9, height: 0.05, depth: 0.55 }, scene), paint);
  stab.position.set(0, 1.5, -3.5);
  const elevator = new TransformNode("amElevator", scene); elevator.parent = root; elevator.position.set(0, 1.5, -3.78);
  add(MeshBuilder.CreateBox("amElevatorM", { width: 2.8, height: 0.03, depth: 0.28 }, scene), grey, elevator).position.z = -0.14;

  // tampa só-profundidade da cabine
  const lidMat = new StandardMaterial("amLidMat", scene);
  lidMat.disableColorWrite = true; lidMat.forceDepthWrite = true; lidMat.alpha = 0.01; lidMat.backFaceCulling = false;
  const cockpitLid = MeshBuilder.CreateBox("cockpitLid", { width: 1.2, height: 0.005, depth: 1.9 }, scene);
  cockpitLid.material = lidMat; cockpitLid.parent = root; cockpitLid.position.set(0, AMPH_FLOOR + 0.01, 0.6); cockpitLid.alphaIndex = 0;
  const telltale = new TransformNode("telltale", scene); telltale.parent = root; telltale.position.set(0, -5, 0);

  for (const m of meshes) m.isPickable = false;
  let stickX = 0, stickY = 0, thr = 0, fold = 0, foldTarget = 0;
  // dobrar: cada asa gira para trás em torno da dobradiça (eixo vertical) e fica ao longo do casco
  const applyFold = () => { for (const f of folds) f.node.rotation.y = f.s * fold * 1.5; };
  const controls: AmphibControls = {
    meshes: [],
    wheelGrip: stickGrip,
    leverGrip: thrGrip,
    update(dt, t) {
      rudder.rotation.y = -(t.steerDeg * Math.PI) / 180;
      for (const x of ailerons) x.node.rotation.x = x.s * t.aileron * 0.3;
      elevator.rotation.x = t.elevator * 0.3;                   // puxar (+) = bordo de fuga para cima
      stickX += (t.aileron - stickX) * Math.min(1, dt * 12);
      stickY += (t.elevator - stickY) * Math.min(1, dt * 12);
      stickPivot.rotation.z = -stickX * 0.3; stickPivot.rotation.x = -stickY * 0.25;
      thr += (t.throttle - thr) * Math.min(1, dt * 12);
      thrPivot.rotation.x = -0.5 + thr * 1.0;
      if (fold !== foldTarget) { fold += Math.sign(foldTarget - fold) * Math.min(Math.abs(foldTarget - fold), dt * 0.6); applyFold(); }
    },
  };
  const setFolded = (on: boolean) => { foldTarget = on ? 1 : 0; };
  const snapFold = (on: boolean) => { fold = foldTarget = on ? 1 : 0; applyFold(); };
  return { root, engine, propeller, telltale, propBlur, lights: null, cockpitLid, meshes, controls, setFolded, snapFold };
};
