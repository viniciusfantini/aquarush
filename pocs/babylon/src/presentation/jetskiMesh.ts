// Moto aquática AR-J (3,45 m, 300 hp, jato d'água). Origem = CG da moto seca (mesma origem da física, params JETSKI).
// X boreste, Y cima, Z proa. Tudo procedural (sem assets).
// Comandos: o GUIDÃO gira o bocal do jato (direção); gatilho do acelerador na manopla direita; alavanca do freio/ré
// (iBB) na esquerda, que baixa a CAÇAMBA sobre o bocal (N = meio, R = toda baixada). Sem hélice exposta: o rotor fica
// dentro do duto (aparece no fundo do bocal). Painel digital no console do guidão (acende com a central acordada).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, Color4, TransformNode, Vector3, DynamicTexture, ParticleSystem } from "@babylonjs/core";
import { JETSKI } from "../sim/params.ts";
import type { BoatTelemetry } from "../sim/boat.ts";
import type { VehicleInput } from "../gameplay/vehicleInput.ts";
import { type BoatVisual, pbr, roundedBox, colorize, hpDecalMaterial, buildPropeller } from "./boatMesh.ts";

/** piso dos estribos (onde ficam os pés de quem vai montado) */
export const JET_FOOT = 0.22;
const SEAT_TOP = 0.62;
const Z_STERN = -1.72, Z_BOW = 1.73;

/** meia-boca do casco numa estação z */
const halfBeam = (z: number): number => {
  if (z < -1.1) return 0.53 + 0.09 * (z - Z_STERN) / (Z_STERN + 1.1) * -1;
  if (z <= 0.55) return 0.62;
  const s = Math.min(1, (z - 0.55) / (Z_BOW - 0.55));
  return Math.max(0.004, 0.62 * Math.sqrt(1 - s * s * s));
};
const keelY = (z: number) => (z < 0.45 ? -0.31 - 0.02 * Math.max(0, z + 0.4) / 0.85 : -0.33 + 0.43 * ((z - 0.45) / (Z_BOW - 0.45)) ** 2);
const chineY = (z: number) => -0.13 + 0.16 * Math.max(0, (z - 0.6) / (Z_BOW - 0.6)) ** 1.6;
const sheerY = (z: number) => 0.2 + 0.08 * Math.max(0, (z - 0.2) / (Z_BOW - 0.2));

export interface JetskiControls {
  meshes: Mesh[];
  /** manopla esquerda (mão esquerda: alavanca do iBB) */
  wheelGrip: TransformNode;
  /** manopla direita (mão direita: gatilho do acelerador) */
  leverGrip: TransformNode;
  update(dt: number, t: BoatTelemetry, input: VehicleInput, maxSteerDeg: number): void;
}

export const buildJetski = (scene: Scene): BoatVisual & { controls: JetskiControls } => {
  const root = new TransformNode("boat", scene);
  const meshes: Mesh[] = [];
  const add = (m: Mesh, mat: StandardMaterial | PBRMaterial, parent: TransformNode = root) => { m.material = mat; m.parent = parent; meshes.push(m); return m; };

  const hullMat = pbr(scene, "jetHull", new Color3(1, 1, 1), 0, 0.22, 1);
  hullMat.backFaceCulling = false;
  const deckMat = pbr(scene, "jetDeck", new Color3(1, 1, 1), 0.1, 0.25, 1);
  deckMat.backFaceCulling = false;
  const matMat = pbr(scene, "jetMat", new Color3(0.13, 0.14, 0.15), 0, 0.9);         // tapete antiderrapante dos estribos
  matMat.backFaceCulling = false;
  const seatMat = pbr(scene, "jetSeat", new Color3(0.07, 0.075, 0.08), 0, 0.55);
  const seatTrim = pbr(scene, "jetSeatTrim", new Color3(0.95, 0.42, 0.05), 0, 0.5);
  const blackGloss = pbr(scene, "jetBlackGloss", new Color3(0.025, 0.028, 0.032), 0, 0.15, 0.8);
  const blackMatte = pbr(scene, "jetBlackMatte", new Color3(0.05, 0.05, 0.055), 0, 0.65);
  const steel = pbr(scene, "jetSteel", new Color3(0.9, 0.91, 0.93), 0.9, 0.22);
  const rubber = pbr(scene, "jetRubber", new Color3(0.04, 0.04, 0.045), 0, 0.8);
  const mirror = pbr(scene, "jetMirror", new Color3(0.8, 0.85, 0.9), 1, 0.05);
  const WHITE = new Color3(0.95, 0.96, 0.97), BLUE = new Color3(0.03, 0.16, 0.42), ORANGE = new Color3(0.95, 0.42, 0.05), GREY = new Color3(0.18, 0.19, 0.21);

  // ---------- casco (fundo em V profundo, quina, costado curto) ----------
  const hullSec = (z: number): Vector3[] => {
    const hb = halfBeam(z), k = keelY(z), c = Math.min(chineY(z), sheerY(z) - 0.06), s = sheerY(z);
    const half: [number, number][] = [[0.3 * hb, k + (c - k) * 0.42], [0.62 * hb, k + (c - k) * 0.78], [0.88 * hb, c], [hb, c + 0.035], [hb, s - 0.05], [hb * 0.97, s]];
    return [...half.slice().reverse().map(([x, y]) => new Vector3(-x, y, z)), new Vector3(0, k, z), ...half.map(([x, y]) => new Vector3(x, y, z))];
  };
  const hz: number[] = [];
  for (let i = 0; i <= 30; i++) hz.push(Z_STERN + (Z_BOW - 0.004 - Z_STERN) * (i / 30));
  const hull = add(MeshBuilder.CreateRibbon("jetHullM", { pathArray: hz.map(hullSec), sideOrientation: Mesh.DOUBLESIDE }, scene), hullMat);
  colorize(hull, (_x, y) => (y < -0.1 ? new Color3(0.92, 0.92, 0.9) : y > 0.14 ? BLUE : WHITE));
  // espelho de popa (fecha o casco)
  const tr = hullSec(Z_STERN);
  const transom = add(MeshBuilder.CreateRibbon("jetTransom", { pathArray: [tr, tr.map((p) => new Vector3(0, Math.max(p.y, -0.05), Z_STERN))], sideOrientation: Mesh.DOUBLESIDE }, scene), hullMat);
  colorize(transom, () => GREY);
  // verdugo (borracha em volta do costado)
  const rail: Vector3[] = [];
  for (let i = 0; i <= 30; i++) { const z = Z_STERN + 0.02 + (Z_BOW - 0.06 - Z_STERN) * (i / 30); rail.push(new Vector3(halfBeam(z) * 0.985, sheerY(z) - 0.01, z)); }
  for (const s of [-1, 1]) add(MeshBuilder.CreateTube("jetRubRail", { path: rail.map((p) => new Vector3(s * p.x, p.y, p.z)), radius: 0.022, tessellation: 8, cap: Mesh.CAP_ALL }, scene), rubber);
  // patrocinadores (sponsons) na popa e placa de passeio (ride plate) — a "skeg" das gotas
  for (const s of [-1, 1]) {
    const sp = add(MeshBuilder.CreateBox("jetSponson", { width: 0.03, height: 0.08, depth: 0.42 }, scene), blackGloss);
    sp.position.set(s * 0.6, -0.1, -1.38); sp.rotation.z = s * 0.5;
  }
  const ridePlate = add(MeshBuilder.CreateBox("skeg", { width: 0.42, height: 0.012, depth: 0.36 }, scene), steel);
  ridePlate.position.set(0, -0.29, -1.52);
  // grade de admissão do jato (fundo)
  const grate = add(MeshBuilder.CreateBox("jetIntake", { width: 0.2, height: 0.01, depth: 0.42 }, scene), blackMatte);
  grate.position.set(0, keelY(JETSKI.intakePos.z) + 0.035, JETSKI.intakePos.z);

  // ---------- convés ----------
  // estribos (piso dos pés) dos dois lados do banco, com tapete
  const fz: number[] = [];
  for (let i = 0; i <= 12; i++) fz.push(-1.32 + (0.32 + 1.32) * (i / 12));
  add(MeshBuilder.CreateRibbon("jetFootwell", { pathArray: fz.map((z) => [new Vector3(-halfBeam(z) + 0.07, JET_FOOT, z), new Vector3(halfBeam(z) - 0.07, JET_FOOT, z)]), sideOrientation: Mesh.DOUBLESIDE }, scene), matMat);
  // bordas dos estribos (lábio do convés até o costado)
  for (const s of [-1, 1]) {
    const lip = add(MeshBuilder.CreateRibbon("jetLip", { pathArray: fz.map((z) => [new Vector3(s * (halfBeam(z) - 0.07), JET_FOOT, z), new Vector3(s * (halfBeam(z) - 0.02), JET_FOOT + 0.1, z), new Vector3(s * halfBeam(z) * 0.97, sheerY(z), z)]), sideOrientation: Mesh.DOUBLESIDE }, scene), deckMat);
    colorize(lip, () => BLUE);
  }
  // capô dianteiro (arco do costado até o topo, subindo até o console do guidão)
  const hoodTop = (z: number) => {
    const t = (z - 0.3) / (Z_BOW - 0.05 - 0.3);
    return 0.66 - 0.4 * t * t - 0.05 * t;
  };
  const hoodZ: number[] = [];
  for (let i = 0; i <= 22; i++) hoodZ.push(0.3 + (Z_BOW - 0.05 - 0.3) * (i / 22));
  const hood = add(MeshBuilder.CreateRibbon("jetHood", {
    pathArray: hoodZ.map((z) => {
      const hb = halfBeam(z) * 0.97, s = sheerY(z), top = Math.max(s + 0.01, hoodTop(z));
      const pts: Vector3[] = [];
      for (let k = 0; k <= 14; k++) { const a = Math.PI * (k / 14); pts.push(new Vector3(-hb * Math.cos(a), s + (top - s) * Math.pow(Math.sin(a), 0.7), z)); }
      return pts;
    }), sideOrientation: Mesh.DOUBLESIDE,
  }, scene), deckMat);
  colorize(hood, (x, y, z) => (Math.abs(x) > 0.36 && y < 0.42 && z < 1.2 ? ORANGE : y > 0.5 && Math.abs(x) < 0.12 ? GREY : BLUE));
  // frente do capô no console (fecha o arco em z = 0,3)
  const front = hoodZ.length ? hoodZ[0] : 0.3;
  const consoleFace = add(MeshBuilder.CreateRibbon("jetConsoleFace", {
    pathArray: [0, 1].map((r) => {
      const pts: Vector3[] = [];
      const hb = halfBeam(front) * 0.97, s = sheerY(front), top = hoodTop(front);
      for (let k = 0; k <= 14; k++) { const a = Math.PI * (k / 14); pts.push(new Vector3(-hb * Math.cos(a) * (1 - r), JET_FOOT + (s + (top - s) * Math.pow(Math.sin(a), 0.7) - JET_FOOT) * (1 - r) + r * JET_FOOT, front)); }
      return pts;
    }), sideOrientation: Mesh.DOUBLESIDE,
  }, scene), deckMat);
  colorize(consoleFace, () => GREY);
  // plataforma de popa (para subir da água) + alça e degrau de reembarque
  const plat = add(roundedBox("jetPlatform", scene, 1.0, 0.07, 0.4, 0.03), deckMat);
  plat.position.set(0, JET_FOOT - 0.03, -1.52);
  colorize(plat, () => GREY);
  add(MeshBuilder.CreateBox("jetPlatformMat", { width: 0.9, height: 0.008, depth: 0.34 }, scene), matMat).position.set(0, JET_FOOT + 0.01, -1.52);
  const step = add(MeshBuilder.CreateBox("jetBoardStep", { width: 0.22, height: 0.02, depth: 0.08 }, scene), blackMatte);
  step.position.set(0, -0.02, -1.77);
  const grab = add(MeshBuilder.CreateTorus("jetGrab", { diameter: 0.3, thickness: 0.025, tessellation: 16 }, scene), blackMatte);
  grab.position.set(0, SEAT_TOP - 0.06, -1.33); grab.scaling.set(1, 0.6, 0.5); grab.rotation.x = Math.PI / 2;

  // ---------- banco ----------
  const seat = add(roundedBox("jetSeatM", scene, 0.44, SEAT_TOP - JET_FOOT, 1.45, 0.1), seatMat);
  seat.position.set(0, (SEAT_TOP + JET_FOOT) / 2, -0.58);
  const seatStep = add(roundedBox("jetSeatStep", scene, 0.4, 0.06, 0.5, 0.03), seatMat); // degrau do garupa
  seatStep.position.set(0, SEAT_TOP + 0.02, -0.98);
  for (const s of [-1, 1]) add(MeshBuilder.CreateBox("jetSeatPiping", { width: 0.012, height: 0.02, depth: 1.38 }, scene), seatTrim).position.set(s * 0.215, SEAT_TOP - 0.05, -0.58);
  // tampa do tanque (no console, à frente do banco)
  add(MeshBuilder.CreateCylinder("jetFuelCap", { height: 0.02, diameter: 0.07, tessellation: 14 }, scene), blackMatte).position.set(0.2, hoodTop(0.6) - 0.03, 0.62);

  // ---------- bocal do jato (pivô = drivePivot: gira com o guidão e com o trim VTS) ----------
  const pv = JETSKI.drivePivot, np = JETSKI.propPos;
  const engine = new TransformNode("enginePivot", scene);
  engine.parent = root;
  engine.position.set(pv.x, pv.y, pv.z);
  const nz = np.z - pv.z, ny = np.y - pv.y;
  // carcaça do jato (fixa no casco) + bocal (gira)
  const pumpHousing = add(MeshBuilder.CreateCylinder("jetPump", { height: 0.3, diameterTop: 0.2, diameterBottom: 0.24, tessellation: 20 }, scene), blackGloss);
  pumpHousing.rotation.x = Math.PI / 2; pumpHousing.position.set(0, pv.y, pv.z + 0.17);
  const nozzle = add(MeshBuilder.CreateCylinder("jetNozzle", { height: Math.abs(nz) + 0.06, diameterTop: 0.2, diameterBottom: JETSKI.propRadius * 2, tessellation: 20 }, scene), steel, engine);
  nozzle.rotation.x = -Math.PI / 2; nozzle.position.set(0, ny / 2, nz / 2);
  // rotor (aparece no fundo do bocal) — gira com o motor
  const { propeller, propBlur } = buildPropeller(scene, engine, new Vector3(0, ny, nz + 0.04), JETSKI.propRadius * 0.9, 0.1, steel, add, meshes);
  // ---- caçamba de ré (iBB) ----
  // Concha em "C" articulada num eixo transversal ACIMA da saída do bocal. Fechada (R / freio) ela envolve a saída por
  // trás e por baixo e devolve o jato para a frente e para baixo; em N fica a meio caminho (metade do jato volta);
  // em F sobe toda e o jato sai 100 % livre. Os braços laterais giram com ela; as orelhas ficam presas no bocal.
  const PIV = new Vector3(0, ny + 0.115, nz + 0.02);       // eixo da caçamba (local do bocal)
  const bucketPivot = new TransformNode("jetBucketPivot", scene);
  bucketPivot.parent = engine; bucketPivot.position.copyFrom(PIV);
  const bucketMat = pbr(scene, "jetBucketMat", new Color3(0.09, 0.1, 0.11), 0.4, 0.35, 0.4);
  bucketMat.backFaceCulling = false;
  {
    // concha: arco de 15° (em cima) a 165° (embaixo, voltando para a frente) em volta da saída, raio 0,115 m
    const exit = new Vector3(0, ny - PIV.y, nz - 0.03 - PIV.z); // saída do bocal no referencial do eixo
    const R = 0.115, W = 0.12, rows: Vector3[][] = [];
    for (let i = 0; i <= 14; i++) {
      const a = (15 + 150 * (i / 14)) * Math.PI / 180;
      const y = exit.y + R * Math.cos(a), z = exit.z - R * Math.sin(a);
      rows.push([new Vector3(-W, y, z), new Vector3(-W * 0.6, y, z - 0.012), new Vector3(0, y, z - 0.016), new Vector3(W * 0.6, y, z - 0.012), new Vector3(W, y, z)]);
    }
    const shell = add(MeshBuilder.CreateRibbon("jetBucket", { pathArray: rows, sideOrientation: Mesh.DOUBLESIDE }, scene), bucketMat, bucketPivot);
    shell.isPickable = false;
    // bordas laterais da concha (placas em "D") e lábio de baixo (que joga a água para a frente)
    for (const s of [-1, 1]) {
      const side = add(MeshBuilder.CreateDisc("jetBucketSide", { radius: R, tessellation: 20, arc: 0.45, sideOrientation: Mesh.DOUBLESIDE }, scene), bucketMat, bucketPivot);
      side.rotation.y = s * Math.PI / 2; side.rotation.x = -0.25;
      side.position.set(s * W, exit.y, exit.z);
      // braço do eixo até a concha
      const arm = add(MeshBuilder.CreateBox("jetBucketArm", { width: 0.014, height: 0.03, depth: Math.abs(exit.z) + 0.05 }, scene), blackGloss, bucketPivot);
      arm.position.set(s * (W + 0.012), -0.01, exit.z / 2 - 0.01);
      // orelha fixa no bocal com o pino
      const ear = add(MeshBuilder.CreateCylinder("jetBucketPin", { height: 0.03, diameter: 0.03, tessellation: 12 }, scene), steel, engine);
      ear.rotation.z = Math.PI / 2; ear.position.set(s * (W + 0.02), PIV.y, PIV.z);
    }
    const lip = add(MeshBuilder.CreateBox("jetBucketLip", { width: 2 * W, height: 0.012, depth: 0.05 }, scene), bucketMat, bucketPivot);
    lip.position.set(0, exit.y - R * 0.97, exit.z + 0.02); lip.rotation.x = 0.35;
  }
  // jato devolvido pela caçamba: freando rápido a água sobe numa coluna atrás da popa
  const sprayTex = new DynamicTexture("jetIbbSprayTex", { width: 64, height: 64 }, scene, false);
  {
    const c = sprayTex.getContext() as unknown as CanvasRenderingContext2D;
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(240,248,255,0.7)"); g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, 64, 64); sprayTex.hasAlpha = true; sprayTex.update();
  }
  const ibbSpray = new ParticleSystem("jetIbbSpray", 1400, scene);
  ibbSpray.particleTexture = sprayTex;
  ibbSpray.emitter = new Vector3(0, -100, 0);
  ibbSpray.minEmitBox = new Vector3(-0.08, 0, -0.05); ibbSpray.maxEmitBox = new Vector3(0.08, 0.05, 0.05);
  ibbSpray.color1 = new Color4(1, 1, 1, 0.85); ibbSpray.color2 = new Color4(0.85, 0.93, 1, 0.7); ibbSpray.colorDead = new Color4(0.9, 0.95, 1, 0);
  ibbSpray.minSize = 0.12; ibbSpray.maxSize = 0.5; ibbSpray.minScaleX = 0.8; ibbSpray.maxScaleX = 1.4;
  ibbSpray.minLifeTime = 0.6; ibbSpray.maxLifeTime = 1.4;
  ibbSpray.minEmitPower = 1; ibbSpray.maxEmitPower = 1;
  ibbSpray.gravity = new Vector3(0, -9.81, 0);
  ibbSpray.minAngularSpeed = -2; ibbSpray.maxAngularSpeed = 2;
  ibbSpray.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ibbSpray.renderingGroupId = 1;
  ibbSpray.emitRate = 0;
  ibbSpray.start();

  // esguicho de refrigeração (lado de boreste, na popa): o "xixi" que mostra que a água está circulando
  const telltale = new TransformNode("telltale", scene);
  telltale.parent = root;
  telltale.position.set(halfBeam(-1.5) - 0.01, 0.06, -1.5);
  add(MeshBuilder.CreateCylinder("telltaleNozzle", { height: 0.025, diameter: 0.014, tessellation: 8 }, scene), steel, telltale).rotation.z = Math.PI / 2;

  // adesivos de potência nos dois lados do capô
  for (const s of [-1, 1]) {
    const d = add(MeshBuilder.CreatePlane("decalHp", { width: 0.26, height: 0.16 }, scene), hpDecalMaterial(scene, JETSKI.enginePowerHp));
    d.position.set(s * (halfBeam(0.95) * 0.97 + 0.004), 0.36, 0.95); d.rotation.y = -s * Math.PI / 2;
  }

  // ---------- console + guidão ----------
  const pod = add(roundedBox("jetPod", scene, 0.34, 0.16, 0.26, 0.05), blackGloss);
  pod.position.set(0, hoodTop(0.4) + 0.02, 0.42);
  // painel digital (acende com a central acordada)
  const dispMat = new StandardMaterial("jetDisplay", scene);
  dispMat.diffuseColor = new Color3(0.02, 0.03, 0.04); dispMat.specularColor = new Color3(0.6, 0.6, 0.6); dispMat.emissiveColor = Color3.Black();
  const disp = add(MeshBuilder.CreatePlane("jetDisplayM", { width: 0.2, height: 0.08 }, scene), dispMat);
  disp.position.set(0, hoodTop(0.4) + 0.105, 0.38); disp.rotation.x = Math.PI - 0.95; disp.rotation.y = Math.PI;
  // retrovisores
  for (const s of [-1, 1]) {
    const arm = add(MeshBuilder.CreateBox("jetMirrorArm", { width: 0.12, height: 0.02, depth: 0.03 }, scene), blackGloss);
    arm.position.set(s * 0.33, 0.63, 0.66);
    const m = add(roundedBox("jetMirrorBody", scene, 0.16, 0.08, 0.03, 0.02), blackGloss);
    m.position.set(s * 0.43, 0.66, 0.66);
    const g = add(MeshBuilder.CreatePlane("jetMirrorGlass", { width: 0.14, height: 0.065 }, scene), mirror);
    g.position.set(s * 0.43, 0.66, 0.644); g.rotation.y = Math.PI;
  }
  // guidão: coluna inclinada para trás; o guidão gira em torno dela
  const column = new TransformNode("jetColumn", scene);
  column.parent = root; column.position.set(0, 0.74, 0.3); column.rotation.x = -0.38;
  const bar = new TransformNode("jetHandlebar", scene);
  bar.parent = column;
  add(MeshBuilder.CreateCylinder("jetSteerPost", { height: 0.12, diameter: 0.05, tessellation: 12 }, scene), blackMatte, bar).position.y = 0.0;
  const hb = add(MeshBuilder.CreateCylinder("jetBar", { height: 0.6, diameter: 0.028, tessellation: 12 }, scene), steel, bar);
  hb.rotation.z = Math.PI / 2; hb.position.y = 0.07;
  add(roundedBox("jetBarPad", scene, 0.2, 0.05, 0.06, 0.02), blackMatte, bar).position.y = 0.075;
  const grips: TransformNode[] = [];
  for (const s of [-1, 1]) {
    const gm = add(MeshBuilder.CreateCylinder("jetGrip", { height: 0.13, diameter: 0.04, tessellation: 12 }, scene), rubber, bar);
    gm.rotation.z = Math.PI / 2; gm.position.set(s * 0.33, 0.07, 0);
    const g = new TransformNode("jetGripPt", scene); g.parent = bar; g.position.set(s * 0.33, 0.085, -0.01);
    grips.push(g);
  }
  // gatilho do acelerador (manopla direita) e alavanca do iBB (esquerda) — giram com o comando real
  const trigPivot = new TransformNode("jetTrigger", scene); trigPivot.parent = bar; trigPivot.position.set(0.27, 0.07, 0.03);
  add(MeshBuilder.CreateBox("jetTriggerM", { width: 0.012, height: 0.02, depth: 0.08 }, scene), blackMatte, trigPivot).position.set(0, -0.005, 0.04);
  const brakePivot = new TransformNode("jetBrake", scene); brakePivot.parent = bar; brakePivot.position.set(-0.27, 0.075, 0.03);
  add(MeshBuilder.CreateBox("jetBrakeLever", { width: 0.13, height: 0.012, depth: 0.018 }, scene), steel, brakePivot).position.set(-0.07, 0, 0.04);
  // botões START (verde) / STOP (vermelho) e o clipe do cordão de segurança no lado esquerdo
  const startMat = pbr(scene, "jetStartBtn", new Color3(0.1, 0.7, 0.2), 0, 0.4);
  const stopMat = pbr(scene, "jetStopBtn", new Color3(0.8, 0.08, 0.06), 0, 0.4);
  add(MeshBuilder.CreateCylinder("jetStart", { height: 0.012, diameter: 0.022, tessellation: 12 }, scene), startMat, bar).position.set(0.22, 0.095, -0.005);
  add(MeshBuilder.CreateCylinder("jetStop", { height: 0.012, diameter: 0.026, tessellation: 12 }, scene), stopMat, bar).position.set(-0.22, 0.095, -0.005);
  const lanyardMat = pbr(scene, "jetLanyard", new Color3(0.95, 0.3, 0.05), 0, 0.6);
  const lanyard = add(MeshBuilder.CreateTorus("jetLanyardCoil", { diameter: 0.07, thickness: 0.008, tessellation: 12 }, scene), lanyardMat, bar);
  lanyard.position.set(-0.22, 0.06, -0.06); lanyard.rotation.x = 0.4;

  // tampa só-profundidade sobre os estribos: a água não aparece dentro do convés
  const lidMat = new StandardMaterial("jetLidMat", scene);
  lidMat.disableColorWrite = true; lidMat.forceDepthWrite = true; lidMat.alpha = 0.01; lidMat.backFaceCulling = false;
  const cockpitLid = MeshBuilder.CreateRibbon("cockpitLid", { pathArray: fz.map((z) => [new Vector3(-halfBeam(z) + 0.06, JET_FOOT - 0.01, z), new Vector3(halfBeam(z) - 0.06, JET_FOOT - 0.01, z)]) }, scene);
  cockpitLid.material = lidMat; cockpitLid.parent = root; cockpitLid.alphaIndex = 0;

  for (const m of meshes) m.isPickable = false;
  let barAng = 0, trig = 0, brake = 0, bucketAng = 0;
  const controls: JetskiControls = {
    meshes: [],
    wheelGrip: grips[0],
    leverGrip: grips[1],
    update(dt, t, _input, maxSteerDeg) {
      // o guidão gira ~30° para cada lado no batente (o bocal gira menos: maxSteer)
      const target = (t.steerDeg / Math.max(1, maxSteerDeg)) * 30 * Math.PI / 180;
      barAng += (target - barAng) * Math.min(1, dt * 16);
      bar.rotation.y = barAng;
      trig += (t.throttle - trig) * Math.min(1, dt * 14);
      trigPivot.rotation.x = 0.5 * trig;
      const br = t.gear === "R" ? 1 : t.gear === "N" ? 0.45 : 0;
      brake += (br - brake) * Math.min(1, dt * 10);
      brakePivot.rotation.x = 0.45 * brake;
      // caçamba pelo estado REAL do iBB: FRENTE = 100 % aberta (levantada), NEUTRO = parcial, RÉ e FREIO = fechada
      const bk = t.ibb === "off" ? 1.75 : t.ibb === "neutral" ? 0.8 : 0;
      bucketAng += (bk - bucketAng) * Math.min(1, dt * 7);
      bucketPivot.rotation.x = bucketAng;
      // FREIO em velocidade: o jato bate na caçamba e sobe numa coluna d'água atrás da popa (∝ velocidade e giro)
      const v = t.speedKmh / 3.6;
      const closed = 1 - Math.min(1, bucketAng / 0.8);
      const strength = t.engine === "running" && t.propImmersion > 0.3 && t.ibb === "brake" ? closed * Math.min(1, Math.max(0, (t.speedKmh - 12) / 50)) * (0.35 + 0.65 * t.throttle) : 0;
      ibbSpray.emitRate = 1100 * strength;
      if (strength > 0) {
        root.computeWorldMatrix(true); bucketPivot.computeWorldMatrix(true);
        const wm = root.getWorldMatrix();
        const fwd = Vector3.TransformNormal(Vector3.Forward(), wm).normalize();
        const up = Vector3.TransformNormal(Vector3.Up(), wm).normalize();
        const right = Vector3.TransformNormal(Vector3.Right(), wm).normalize();
        (ibbSpray.emitter as Vector3).copyFrom(bucketPivot.getAbsolutePosition().add(fwd.scale(-0.2)));
        // a moto vai para a frente a v; a água sai para cima (e um pouco para trás em relação à moto)
        const base = fwd.scale(v * 0.5), upS = 5 + 6 * strength;
        ibbSpray.direction1 = base.add(up.scale(upS * 0.75)).add(fwd.scale(-1.5)).add(right.scale(-1.6));
        ibbSpray.direction2 = base.add(up.scale(upS * 1.25)).add(fwd.scale(0.4)).add(right.scale(1.6));
        ibbSpray.maxSize = 0.35 + 0.35 * strength;
      }
      // painel: aceso com a central acordada (START/autoteste/motor) e com tensão
      const awake = t.engine !== "off" || (t.keys[0] ?? "off") !== "off";
      dispMat.emissiveColor = awake && t.houseV > 9 ? new Color3(0.25, 0.75, 0.95) : Color3.Black();
      lanyard.setEnabled(t.lanyard);
    },
  };
  return { root, engine, propeller, telltale, propBlur, lights: null, cockpitLid, meshes, controls };
};
