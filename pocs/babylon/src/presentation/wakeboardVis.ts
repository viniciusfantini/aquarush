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

const mat = (scene: Scene, name: string, c: Color3, spec = 0.1) => { const m = new StandardMaterial(name, scene); m.diffuseColor = c; m.specularColor = new Color3(spec, spec, spec); return m; };

/** prancha de wakeboard: casco fino com as pontas arredondadas e dois "bindings" (botas) */
const buildBoardMesh = (scene: Scene, name: string, parent: TransformNode, color: Color3): Mesh[] => {
  const top = mat(scene, name + "Top", color, 0.4), base = mat(scene, name + "Base", new Color3(0.08, 0.08, 0.1), 0.3), boot = mat(scene, name + "Boot", new Color3(0.12, 0.12, 0.14));
  const board = MeshBuilder.CreateCylinder(name, { height: 0.035, diameter: 1, tessellation: 28 }, scene);
  board.scaling.set(0.42, 1, 1.38); board.material = top; board.parent = parent;
  const rail = MeshBuilder.CreateCylinder(name + "Rail", { height: 0.02, diameter: 1, tessellation: 28 }, scene);
  rail.scaling.set(0.43, 1, 1.39); rail.position.y = -0.022; rail.material = base; rail.parent = parent;
  const out = [board, rail];
  for (const z of [-0.26, 0.26]) {
    const b = MeshBuilder.CreateBox(name + "Boot", { width: 0.13, height: 0.16, depth: 0.28 }, scene);
    b.material = boot; b.parent = parent; b.position.set(0, 0.09, z); b.rotation.y = Math.PI / 2 + (z > 0 ? 0.25 : -0.25); out.push(b);
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
    if (wb.state === "pier") {
      this.boardRoot.setEnabled(false);
      this.rider.stand(new Vector3(wb.pos.x, wb.pos.y, wb.pos.z), Math.PI, t);
    } else if (wb.state === "water" || wb.state === "fallen") {
      // sentada na água (colete), prancha na frente, de lado; caída: prancha boiando perto
      this.boardRoot.setEnabled(true);
      const fx = Math.sin(fwdYaw), fz = Math.cos(fwdYaw);
      this.rider.float(new Vector3(p.x, waterY, p.z), fwdYaw, t, wb.swimming ? 1 : 0);
      this.boardRoot.position.set(p.x + fx * 0.7, waterY + 0.02, p.z + fz * 0.7);
      this.boardRoot.rotationQuaternion = Quaternion.FromEulerAngles(wb.state === "water" ? -1.2 : 0, fwdYaw + Math.PI / 2, 0);
      if (wb.state === "water") this.rider.update(new Vector3(-0.15, 0.85, 0.35), new Vector3(0.15, 0.85, 0.35));
    } else {
      // em pé de LADO na prancha (pé da frente para o barco), joelhos dobrando; no ar com a manobra
      this.boardRoot.setEnabled(true);
      const stance = fwdYaw - Math.PI / 2;
      const rise = wb.state === "rising" ? wb.rise : 1;
      let q = Quaternion.FromEulerAngles(0, stance, 0);
      if (wb.state === "air" && wb.trick) {
        const k = wb.trickT * Math.PI * 2;
        const trickQ = wb.trick === "360" ? Quaternion.RotationAxis(Vector3.Up(), k)
          : wb.trick === "backroll" ? Quaternion.RotationAxis(new Vector3(Math.sin(fwdYaw), 0, Math.cos(fwdYaw)), -k)
          : Quaternion.RotationAxis(new Vector3(Math.sin(fwdYaw), 0, Math.cos(fwdYaw)), -0.35 * Math.sin(Math.PI * wb.trickT));
        q = trickQ.multiply(q);
      }
      // a pessoa: pés na prancha (de pé), inclinada para trás contra a corda
      this.rider.stand(p.add(new Vector3(0, 0.06, 0)), stance, t);
      const lean = Quaternion.RotationAxis(new Vector3(Math.cos(fwdYaw), 0, -Math.sin(fwdYaw)), -0.25 * rise);
      this.rider.group.rotationQuaternion = lean.multiply(q); // (q já inclui a manobra no ar)
      // mãos no manete, na frente da cintura (no grab, uma mão desce na prancha)
      this.rider.update(new Vector3(-0.12, 0.95, 0.32), wb.trick === "grab" ? new Vector3(0.25, 0.25, 0.05) : new Vector3(0.12, 0.95, 0.32));
      this.boardRoot.position.set(p.x, p.y + 0.02, p.z);
      this.boardRoot.rotationQuaternion = (wb.state === "air" && wb.trick ? q : Quaternion.FromEulerAngles(0, stance, 0)).multiply(Quaternion.FromEulerAngles(0, Math.PI / 2, 0));
    }
    // ---- manete e corda ----
    const hand = wb.state === "fallen" ? new Vector3(wb.handle.x, wb.handle.y + 0.02, wb.handle.z)
      : wb.state === "riding" || wb.state === "air" || wb.state === "rising" ? p.add(new Vector3(Math.sin(fwdYaw) * 0.35, 0.95, Math.cos(fwdYaw) * 0.35))
      : new Vector3(p.x + Math.sin(fwdYaw) * 0.4, waterY + 0.25, p.z + Math.cos(fwdYaw) * 0.4);
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
