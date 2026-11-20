// Visual do WAKEBOARD (atividade) e do POSTO NÁUTICO: o píer do wakeboard (rack de pranchas e placa), o píer de
// abastecimento (bomba, mangueira, placa, defensas) e quem anda de wakeboard: prancha, pessoa (em pé de lado na prancha,
// sentada na água esperando, nadando), manobras no ar (giro, backroll, grab), manete e corda até o ponto de reboque.
// Só lê a simulação (`sim/wakeboard.ts`).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode, Quaternion } from "@babylonjs/core";
import { type PierLayout, groundHeight, fuelBerth } from "../sim/world.ts";
import type { Wakeboard } from "../sim/wakeboard.ts";
import { buildPassenger, type Pilot } from "./pilot.ts";
import { signMat } from "./station.ts";
import { RopeTube, TowBridleVis } from "./ropeTube.ts";
import { colorize } from "./boatMesh.ts";

const mat = (scene: Scene, name: string, c: Color3, spec = 0.1) => { const m = new StandardMaterial(name, scene); m.diffuseColor = c; m.specularColor = new Color3(spec, spec, spec); return m; };

/** prancha: comprimento, largura, raio dos cantos, espessura e rocker (as pontas sobem) */
const BL = 1.38, BW = 0.43, BR = 0.1, BT = 0.032, ROCK = 0.065;
/** onde a prancha fica presa no corpo (local da pessoa): sob as solas (sola −0,465 − placa da bota e meia espessura) */
const BOARD_SOLE_Y = -0.465 - 0.034, BOARD_Z = -0.05;
const rockerY = (z: number) => ROCK * Math.pow(Math.min(1, Math.abs(z) / (BL / 2)), 2.4);
const boardW = (z: number) => { const a = Math.abs(z) - (BL / 2 - BR); return a <= 0 ? BW : BW - 2 * BR + 2 * Math.sqrt(Math.max(0, BR * BR - a * a)); };

/**
 * Prancha de wakeboard TWIN-TIP ("quadrada", bidirecional): retângulo com os cantos arredondados e as duas pontas
 * iguais, rocker nas duas pontas, borda (rail) clara, fundo escuro, 4 quilhas (duas em cada ponta) e as botas em
 * "pato" simétricas — anda igual para os dois lados. Eixo longo = Z local (para onde ela anda).
 */
const buildBoardMesh = (scene: Scene, name: string, parent: TransformNode, color: Color3): Mesh[] => {
  const N = 40, paths: Vector3[][] = [];
  for (let k = -1; k <= N + 1; k++) {
    const kk = Math.min(N, Math.max(0, k));
    const z = -BL / 2 + (BL * kk) / N, w = (k < 0 || k > N ? 0 : boardW(z)) / 2, y = rockerY(z), h = k < 0 || k > N ? 0 : BT / 2;
    // seção: topo (abaulado de leve), rail arredondado e fundo com canais — laço fechado
    paths.push([
      new Vector3(-w * 0.98, y + h * 0.9, z), new Vector3(0, y + h * 1.15, z), new Vector3(w * 0.98, y + h * 0.9, z),
      new Vector3(w, y, z), new Vector3(w * 0.96, y - h, z), new Vector3(0, y - h * 1.1, z), new Vector3(-w * 0.96, y - h, z), new Vector3(-w, y, z),
    ]);
  }
  const board = MeshBuilder.CreateRibbon(name, { pathArray: paths, closePath: true, sideOrientation: Mesh.DOUBLESIDE }, scene);
  const dark = new Color3(0.07, 0.07, 0.09), rail = new Color3(0.93, 0.93, 0.92), accent = new Color3(1, 1, 1);
  colorize(board, (x, y, z) => {
    const yc = rockerY(z), w = boardW(z) / 2;
    if (y < yc - BT * 0.2) return dark;                                   // fundo
    if (Math.abs(x) > w * 0.9) return rail;                               // rail
    const az = Math.abs(z);
    if (az > 0.12 && az < 0.17) return accent;                            // faixas simétricas
    if (az < 0.05) return color.scale(0.7);
    return color;
  });
  const bm = new StandardMaterial(name + "M", scene); bm.specularColor = new Color3(0.35, 0.35, 0.35); bm.specularPower = 40; bm.backFaceCulling = false;
  board.material = bm; board.parent = parent;
  const out: Mesh[] = [board];
  const finM = mat(scene, name + "Fin", new Color3(0.1, 0.1, 0.12), 0.3), boot = mat(scene, name + "Boot", new Color3(0.12, 0.12, 0.14), 0.15), bootIn = mat(scene, name + "BootIn", color.scale(0.85), 0.2);
  // 4 quilhas: duas em cada ponta, perto das bordas
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const z = sz * (BL / 2 - 0.11), f = MeshBuilder.CreateBox(name + "Fin", { width: 0.006, height: 0.035, depth: 0.075 }, scene);
    f.material = finM; f.parent = parent; f.position.set(sx * (BW / 2 - 0.06), rockerY(z) - BT / 2 - 0.016, z); out.push(f);
  }
  // botas (bindings): pés afastados ao longo da prancha, ângulo em "pato" (±12°)
  for (const sz of [-1, 1]) {
    const n = new TransformNode(name + "Binding", scene); n.parent = parent; n.position.set(0, BT / 2 + 0.005, sz * 0.27); n.rotation.y = sz * 0.21;
    const plate = MeshBuilder.CreateBox(name + "BindPlate", { width: 0.3, height: 0.018, depth: 0.12 }, scene); plate.material = boot; plate.parent = n; plate.position.y = 0.009;
    const shell = MeshBuilder.CreateBox(name + "BindShell", { width: 0.28, height: 0.14, depth: 0.11 }, scene); shell.material = bootIn; shell.parent = n; shell.position.set(-0.01, 0.08, 0);
    const heel = MeshBuilder.CreateCylinder(name + "BindHeel", { height: 0.2, diameter: 0.12, tessellation: 12 }, scene); heel.material = boot; heel.parent = n; heel.position.set(-0.12, 0.1, 0);
    out.push(plate, shell, heel);
  }
  for (const m of out) m.isPickable = false;
  return out;
};

/** Píer do wakeboard: flutuante, baixo, placa, rack de pranchas e boias */
export const buildWakePier = (scene: Scene, P: PierLayout): Mesh[] => {
  const meshes: Mesh[] = [];
  const deck = mat(scene, "wkDeck", new Color3(0.45, 0.47, 0.5)), float = mat(scene, "wkFloat", new Color3(0.86, 0.87, 0.85)), wood = mat(scene, "wkWood", new Color3(0.42, 0.31, 0.2));
  const len = P.length + 3;
  const d = MeshBuilder.CreateBox("wkDeck", { width: P.width, height: 0.16, depth: len }, scene);
  d.material = deck; d.position.set(P.shoreX, P.deckY - 0.08, P.shoreZ - 3 + len / 2); meshes.push(d);
  for (let z = P.shoreZ; z <= P.shoreZ + P.length - 2.6; z += 3) {
    const f = MeshBuilder.CreateBox("wkFloat", { width: P.width - 0.2, height: 0.4, depth: 2.6 }, scene);
    f.material = float; f.position.set(P.shoreX, P.deckY - 0.36, z + 1.3); meshes.push(f);
  }
  for (const sx of [-1, 1]) {
    const z = P.shoreZ + P.length - 0.4, g = groundHeight(P.shoreX + sx * P.width / 2, z), h = P.deckY + 1.1 - g;
    const post = MeshBuilder.CreateCylinder("wkPost", { height: h, diameter: 0.24, tessellation: 8 }, scene);
    post.material = wood; post.position.set(P.shoreX + sx * (P.width / 2 - 0.1), g + h / 2, z); meshes.push(post);
  }
  const sm = signMat(scene, "wkSignT", "WAKEBOARD", "G engata · G solta", "#111418", "#38e0c8");
  for (const yaw of [0, Math.PI]) {
    const s = MeshBuilder.CreatePlane("wkSign", { width: 2.6, height: 0.8 }, scene);
    s.material = sm; s.rotation.y = yaw; s.position.set(P.shoreX, P.deckY + 2.0, P.shoreZ + P.length - 7 + (yaw ? -0.01 : 0.01)); meshes.push(s);
  }
  const pole = MeshBuilder.CreateCylinder("wkSignPole", { height: 1.7, diameter: 0.08, tessellation: 8 }, scene);
  pole.material = wood; pole.position.set(P.shoreX, P.deckY + 0.85, P.shoreZ + P.length - 7); meshes.push(pole);
  // rack de pranchas em pé
  const rack = new TransformNode("wkRack", scene); rack.position.set(P.shoreX - P.width / 2 + 0.3, P.deckY, P.shoreZ + P.length - 12);
  const bar = MeshBuilder.CreateBox("wkRackBar", { width: 0.06, height: 0.06, depth: 2.0 }, scene); bar.material = wood; bar.parent = rack; bar.position.y = 0.7; meshes.push(bar);
  [new Color3(0.95, 0.35, 0.1), new Color3(0.1, 0.55, 0.9), new Color3(0.2, 0.75, 0.3)].forEach((c, i) => {
    const n = new TransformNode("wkRackBoard" + i, scene); n.parent = rack; n.position.set(0.05, 0.7, -0.6 + i * 0.6); n.rotation.set(Math.PI / 2 - 0.2, 0, Math.PI / 2);
    meshes.push(...buildBoardMesh(scene, "wkRackB" + i, n, c));
  });
  for (const m of meshes) m.isPickable = false;
  return meshes;
};

/** Posto náutico: píer sobre estacas, ilha da bomba com mangueira na vaga (lado leste), placa, defensas e boias */
export const buildFuelPier = (scene: Scene, P: PierLayout): Mesh[] => {
  const meshes: Mesh[] = [];
  const wood = mat(scene, "fpWood", new Color3(0.5, 0.37, 0.24)), post = mat(scene, "fpPost", new Color3(0.3, 0.23, 0.17));
  const red = mat(scene, "fpRed", new Color3(0.82, 0.12, 0.1), 0.3), white = mat(scene, "fpWhite", new Color3(0.93, 0.93, 0.92), 0.2), black = mat(scene, "fpBlack", new Color3(0.06, 0.06, 0.07));
  const yellow = mat(scene, "fpYellow", new Color3(0.98, 0.78, 0.1));
  const len = P.length + 3, z0 = P.shoreZ - 3;
  const deck = MeshBuilder.CreateBox("fpDeck", { width: P.width, height: 0.2, depth: len }, scene);
  deck.material = wood; deck.position.set(P.shoreX, P.deckY - 0.1, z0 + len / 2); meshes.push(deck);
  for (let z = z0 + 1; z <= z0 + len - 0.3; z += 4) for (const sx of [-1, 1]) {
    const x = P.shoreX + sx * (P.width / 2 - 0.12), g = groundHeight(x, z), h = P.deckY + (sx > 0 ? 0.6 : 0) - g;
    const p = MeshBuilder.CreateCylinder("fpPile", { height: h, diameter: 0.28, tessellation: 8 }, scene);
    p.material = post; p.position.set(x, g + h / 2, z); meshes.push(p);
  }
  // faixa amarela da vaga e defensas (pneus) no costado leste
  const B = fuelBerth(P);
  const stripe = MeshBuilder.CreateBox("fpStripe", { width: 0.25, height: 0.02, depth: B.len }, scene);
  stripe.material = yellow; stripe.position.set(B.edgeX - 0.2, P.deckY + 0.01, B.z); meshes.push(stripe);
  for (const dz of [-4.5, -1.5, 1.5, 4.5]) {
    const t = MeshBuilder.CreateTorus("fpFender", { diameter: 0.6, thickness: 0.18, tessellation: 16 }, scene);
    t.material = black; t.rotation.z = Math.PI / 2; t.position.set(B.edgeX + 0.1, P.deckY - 0.45, B.z + dz); meshes.push(t);
  }
  // ilha da bomba
  const pump = MeshBuilder.CreateBox("fpPump", { width: 0.55, height: 1.4, depth: 0.42 }, scene);
  pump.material = red; pump.position.set(B.edgeX - 0.55, P.deckY + 0.7, B.z); meshes.push(pump);
  const face = MeshBuilder.CreatePlane("fpPumpFace", { width: 0.36, height: 0.3 }, scene);
  face.material = signMat(scene, "fpPumpT", "GASOLINA", "posto náutico", "#f2f2f0", "#c0221a", 256, 160);
  face.rotation.y = -Math.PI / 2; face.position.set(B.edgeX - 0.27, P.deckY + 1.05, B.z); meshes.push(face);
  const top = MeshBuilder.CreateBox("fpPumpTop", { width: 0.62, height: 0.12, depth: 0.5 }, scene);
  top.material = white; top.position.set(B.edgeX - 0.55, P.deckY + 1.46, B.z); meshes.push(top);
  // mangueira até a borda do píer, com o bico pendurado
  const hose = MeshBuilder.CreateTube("fpHose", { path: [new Vector3(B.edgeX - 0.3, P.deckY + 0.95, B.z + 0.1), new Vector3(B.edgeX - 0.05, P.deckY + 0.7, B.z + 0.3), new Vector3(B.edgeX + 0.05, P.deckY + 0.3, B.z + 0.45), new Vector3(B.edgeX - 0.1, P.deckY + 0.12, B.z + 0.6)], radius: 0.025, tessellation: 8 }, scene);
  hose.material = black; meshes.push(hose);
  // placa de duas faces
  const sm = signMat(scene, "fpSignT", "POSTO NÁUTICO", "F abastece · encoste na faixa", "#c0221a", "#ffffff");
  for (const yaw of [0, Math.PI]) {
    const s = MeshBuilder.CreatePlane("fpSign", { width: 3.0, height: 0.9 }, scene);
    s.material = sm; s.rotation.y = yaw; s.position.set(P.shoreX, P.deckY + 2.6, P.shoreZ + P.length - 1.2 + (yaw ? -0.01 : 0.01)); meshes.push(s);
  }
  const pole = MeshBuilder.CreateCylinder("fpSignPole", { height: 2.2, diameter: 0.1, tessellation: 8 }, scene);
  pole.material = post; pole.position.set(P.shoreX, P.deckY + 1.1, P.shoreZ + P.length - 1.2); meshes.push(pole);
  // tambores de óleo e um extintor
  for (let i = 0; i < 2; i++) {
    const d = MeshBuilder.CreateCylinder("fpDrum", { height: 0.9, diameter: 0.58, tessellation: 18 }, scene);
    d.material = i ? red : white; d.position.set(P.shoreX - P.width / 2 + 0.4, P.deckY + 0.45, P.shoreZ + P.length - 14 - i * 0.7); meshes.push(d);
  }
  for (const m of meshes) m.isPickable = false;
  return meshes;
};

export class WakeboardVisual {
  readonly meshes: Mesh[] = [];
  readonly rider: Pilot;
  private readonly boardRoot: TransformNode;
  private readonly riderRoot: TransformNode;
  private readonly rope: RopeTube;
  private readonly bridle: TowBridleVis;
  private readonly handle: Mesh;
  private lastT = 0;

  constructor(scene: Scene) {
    this.boardRoot = new TransformNode("wkBoardRoot", scene);
    this.meshes.push(...buildBoardMesh(scene, "wkBoard", this.boardRoot, new Color3(0.98, 0.42, 0.08)));
    this.riderRoot = new TransformNode("wkRiderRoot", scene);
    this.rider = buildPassenger(scene, this.riderRoot, 0, 0, "wkRider", 1, 0);
    this.meshes.push(...this.rider.meshes);
    // a prancha é PRESA nos pés (v0.77.2): filha do corpo, sob as solas, ao longo do eixo lateral da pessoa — acompanha
    // qualquer inclinação, agachamento, manobra e a queda, como uma peça só
    this.boardRoot.parent = this.rider.group;
    this.boardRoot.rotationQuaternion = null;
    this.boardRoot.rotation.set(0, -Math.PI / 2, 0);
    this.rope = new RopeTube(scene, "wkRope", new Color3(0.15, 0.75, 0.95), 0.009); // corda de wake (azul)
    this.bridle = new TowBridleVis(scene, "wkBridle", new Color3(0.95, 0.95, 0.95));
    const hm = mat(scene, "wkHandle", new Color3(0.08, 0.08, 0.1), 0.3);
    this.handle = MeshBuilder.CreateCylinder("wkHandleBar", { height: 0.34, diameter: 0.035, tessellation: 10 }, scene);
    this.handle.material = hm; this.handle.rotation.z = Math.PI / 2; this.handle.isPickable = false; this.meshes.push(this.handle);
    for (const m of this.meshes) m.isPickable = false;
  }

  update(wb: Wakeboard, waterY: number, t: number): void {
    const dt = this.lastT ? t - this.lastT : 1 / 60; this.lastT = t;
    const b = wb.hooked;
    const p = new Vector3(wb.pos.x, wb.pos.y, wb.pos.z);
    // ---- pessoa e prancha ----
    const fwdYaw = wb.yaw;
    let handW: Vector3 | null = null;
    if (wb.state === "pier") {
      this.boardRoot.setEnabled(false);
      this.rider.stand(new Vector3(wb.pos.x, wb.pos.y, wb.pos.z), Math.PI, t);
    } else if (wb.state === "water" || wb.state === "fallen") {
      // sentada na água (colete), prancha na frente, de lado; caída: prancha boiando perto
      this.boardRoot.setEnabled(true);
      const fx = Math.sin(fwdYaw), fz = Math.cos(fwdYaw);
      void fx; void fz;
      this.rider.float(new Vector3(p.x, waterY, p.z), fwdYaw, t, wb.swimming ? 1 : 0);
      this.boardRoot.position.set(0, BOARD_SOLE_Y, BOARD_Z); // nos pés (pernas retas na água)
      if (wb.state === "water") this.rider.update(new Vector3(-0.15, 0.85, 0.35), new Vector3(0.15, 0.85, 0.35));
    } else {
      // EM PÉ: de lado na prancha (prancha ao longo do rumo), pé da frente para o barco — base "regular" (esquerdo à
      // frente) ou "switch" depois de um 180. Joelhos dobrados (agachamento da sim), corpo inclinado para trás contra a
      // corda e para o lado da borda que corta; no ar, a manobra gira tudo em torno do centro do corpo.
      this.boardRoot.setEnabled(true);
      const travel = new Vector3(Math.sin(fwdYaw), 0, Math.cos(fwdYaw));
      const faceYaw = fwdYaw + (wb.regular ? 1 : -1) * Math.PI / 2;
      const facing = new Vector3(Math.sin(faceYaw), 0, Math.cos(faceYaw));
      const rise = wb.state === "rising" ? wb.rise : 1;
      const air = wb.state === "air";
      // inclinações: contra a corda (para trás do rumo) e na borda (para os dedos = facing, ou para os calcanhares)
      const ropeLean = air ? 0.12 : Math.min(0.42, (wb.tension / (wb.p.mass * 9.81)) * 0.55) * rise + 0.55 * (1 - rise);
      const aF = wb.edgeAx * facing.x + wb.edgeAz * facing.z;
      const edgeLean = air ? 0 : Math.max(-0.5, Math.min(0.5, aF / 9.81)) * rise;
      const upB = Vector3.Up().add(travel.scale(-Math.tan(ropeLean))).add(facing.scale(Math.tan(edgeLean))).normalize();
      const tiltQ = new Quaternion(); Quaternion.FromUnitVectorsToRef(Vector3.Up(), upB, tiltQ);
      const bodyQ = tiltQ.multiply(Quaternion.FromEulerAngles(0, faceYaw, 0));
      // prancha: a borda afunda no corte (inclina junto com o corpo) e, saindo da água, o bico sobe
      const upP = Vector3.Up().add(facing.scale(Math.tan(edgeLean * 0.9))).add(travel.scale(-Math.tan(0.45 * (1 - rise)))).normalize();
      const tiltP = new Quaternion(); Quaternion.FromUnitVectorsToRef(Vector3.Up(), upP, tiltP);
      const boardQ = tiltP.multiply(Quaternion.FromEulerAngles(0, fwdYaw, 0));
      // manobra no ar (em torno do centro do corpo, ~0,85 m acima dos pés)
      let trickQ = Quaternion.Identity();
      if (air && wb.trick) {
        const k = wb.trickT;
        trickQ = wb.trick === "360" ? Quaternion.RotationAxis(Vector3.Up(), (wb.regular ? 1 : -1) * k * Math.PI * 2)
          : wb.trick === "180" ? Quaternion.RotationAxis(Vector3.Up(), (wb.regular ? 1 : -1) * k * Math.PI)
          : wb.trick === "backroll" ? Quaternion.RotationAxis(travel, -(wb.regular ? 1 : -1) * k * Math.PI * 2)
          : Quaternion.RotationAxis(travel, -(wb.regular ? 1 : -1) * 0.3 * Math.sin(Math.PI * k)); // grab: encolhe e "tweaka"
      }
      const center = p.add(new Vector3(0, 0.85, 0));
      const qBody = trickQ.multiply(bodyQ), qBoard = trickQ.multiply(boardQ);
      const feet = center.subtract(new Vector3(0, 0.85, 0).applyRotationQuaternion(trickQ));
      const crouch = wb.state === "rising" ? 1 - 0.6 * rise : wb.crouch;
      this.rider.ride!(feet.add(upP.scale(0.05)), qBody, 0.27, crouch);
      this.boardRoot.position.set(0, BOARD_SOLE_Y + 0.3 * Math.max(0, Math.min(1, crouch)), BOARD_Z); // sob as solas (o agachamento sobe os tornozelos)
      // mãos no manete, baixo, na frente do quadril, puxado para o lado do barco (pé da frente); no grab a mão de trás
      // desce na borda da prancha
      const lx = wb.regular ? -1 : 1; // lado do barco no local da pessoa
      const hl = new Vector3(lx * 0.16 - 0.08, 0.5 - 0.18 * crouch, 0.22), hr = new Vector3(lx * 0.16 + 0.08, 0.5 - 0.18 * crouch, 0.22);
      const grab = air && wb.trick === "grab";
      this.rider.update(grab && lx > 0 ? new Vector3(-0.18, -0.25, 0.12) : hl, grab && lx < 0 ? new Vector3(0.18, -0.25, 0.12) : hr);
      void qBoard;
      // manete: entre as mãos (no mundo)
      this.rider.group.computeWorldMatrix(true);
      handW = Vector3.TransformCoordinates(new Vector3(lx * 0.16, 0.5 - 0.18 * crouch, 0.24), this.rider.group.getWorldMatrix());
    }
    // ---- manete e corda ----
    const hand = wb.state === "fallen" ? new Vector3(wb.handle.x, wb.handle.y + 0.02, wb.handle.z)
      : handW ?? new Vector3(p.x + Math.sin(fwdYaw) * 0.4, waterY + 0.25, p.z + Math.cos(fwdYaw) * 0.4);
    this.handle.setEnabled(!!b && wb.state !== "pier");
    this.handle.position.copyFrom(hand); this.handle.rotation.set(0, fwdYaw, Math.PI / 2);
    this.rope.setEnabled(!!b);
    if (b) {
      const ring = this.bridle.update(b, hand, wb.tension, waterY - 0.02, dt);
      const d = Vector3.Distance(ring, hand);
      this.rope.update(ring, hand, RopeTube.sagFor(wb.p.ropeLen, d, wb.tension, 0.08), waterY - 0.02);
    } else this.bridle.update(null);
  }
}
