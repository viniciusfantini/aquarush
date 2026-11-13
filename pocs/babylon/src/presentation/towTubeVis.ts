// Visual da BOIA REBOCADA (atividade): o píer da boia, a boia com as alças, a corda até a popa do veículo e a pessoa
// (sentada na boia, boiando/nadando de colete ou em pé no píer). Só lê o estado da simulação (`sim/towTube.ts`).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, Vector3, TransformNode, Quaternion, type LinesMesh } from "@babylonjs/core";
import type { PierLayout } from "../sim/world.ts";
import { groundHeight } from "../sim/world.ts";
import { TowTube } from "../sim/towTube.ts";
import type { Speedboat } from "../sim/boat.ts";
import { buildPassenger, type Pilot } from "./pilot.ts";
import { signMat } from "./station.ts";

/** boia de 1 pessoa: "pneu" com o assento de lona por cima, faixa colorida e quatro alças */
const buildTubeMesh = (scene: Scene, name: string, parent: TransformNode | null, color: Color3): Mesh[] => {
  const body = new StandardMaterial(name + "Mat", scene); body.diffuseColor = color; body.specularColor = new Color3(0.25, 0.25, 0.25);
  const top = new StandardMaterial(name + "Top", scene); top.diffuseColor = new Color3(0.12, 0.13, 0.16);
  const strap = new StandardMaterial(name + "Strap", scene); strap.diffuseColor = new Color3(0.05, 0.05, 0.06);
  const ring = MeshBuilder.CreateTorus(name + "Ring", { diameter: 1.25, thickness: 0.34, tessellation: 32 }, scene);
  ring.material = body;
  const seat = MeshBuilder.CreateCylinder(name + "Seat", { height: 0.06, diameter: 1.1, tessellation: 28 }, scene);
  seat.material = top; seat.position.y = 0.1;
  const out: Mesh[] = [ring, seat];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const h = MeshBuilder.CreateTorus(name + "Handle", { diameter: 0.16, thickness: 0.025, tessellation: 10 }, scene);
    h.material = strap; h.position.set(Math.sin(a) * 0.5, 0.16, Math.cos(a) * 0.5); h.rotation.set(Math.PI / 2, a, 0);
    out.push(h);
  }
  const tow = MeshBuilder.CreateTorus(name + "TowPt", { diameter: 0.14, thickness: 0.03, tessellation: 10 }, scene);
  tow.material = strap; tow.position.set(0, 0.02, 0.8); tow.rotation.x = Math.PI / 2; out.push(tow);
  for (const m of out) { if (parent) m.parent = parent; m.isPickable = false; }
  return out;
};

/** Píer da boia: flutuante, baixo, com placa e boias de reserva num suporte. */
export const buildActivityPier = (scene: Scene, P: PierLayout): Mesh[] => {
  const meshes: Mesh[] = [];
  const deckMat = new StandardMaterial("actDeck", scene); deckMat.diffuseColor = new Color3(0.55, 0.42, 0.28); deckMat.specularColor = new Color3(0.05, 0.05, 0.05);
  const floatMat = new StandardMaterial("actFloat", scene); floatMat.diffuseColor = new Color3(0.85, 0.86, 0.84);
  const len = P.length + 3;
  const deck = MeshBuilder.CreateBox("actPierDeck", { width: P.width, height: 0.18, depth: len }, scene);
  deck.material = deckMat; deck.position.set(P.shoreX, P.deckY - 0.09, P.shoreZ - 3 + len / 2); meshes.push(deck);
  // flutuadores brancos sob o deck (píer flutuante)
  for (let z = P.shoreZ; z <= P.shoreZ + P.length - 2.6; z += 3) { // (o último não passa da ponta do deck)
    const f = MeshBuilder.CreateBox("actPierFloat", { width: P.width - 0.2, height: 0.4, depth: 2.6 }, scene);
    f.material = floatMat; f.position.set(P.shoreX, P.deckY - 0.38, z + 1.3); meshes.push(f);
  }
  // estacas da ponta (onde a boia fica amarrada)
  for (const sx of [-1, 1]) {
    const z = P.shoreZ + P.length - 0.5, g = groundHeight(P.shoreX + sx * P.width / 2, z), h = P.deckY + 1.2 - g;
    const post = MeshBuilder.CreateCylinder("actPierPost", { height: h, diameter: 0.25, tessellation: 8 }, scene);
    post.material = deckMat; post.position.set(P.shoreX + sx * (P.width / 2 - 0.1), g + h / 2, z); meshes.push(post);
  }
  // placa
  // placa de duas faces (uma para o lago, outra para a margem): com uma só, de um lado o texto ficava espelhado
  const signM = signMat(scene, "actSignT", "BOIA REBOCADA", "G engata · G solta", "#e8590c", "#ffffff");
  for (const yaw of [0, Math.PI]) {
    const sign = MeshBuilder.CreatePlane("actSign", { width: 2.6, height: 0.8 }, scene);
    sign.material = signM; sign.rotation.y = yaw;
    sign.position.set(P.shoreX, P.deckY + 1.9, P.shoreZ + P.length - 1.2 + (yaw ? -0.01 : 0.01)); meshes.push(sign);
  }
  const pole = MeshBuilder.CreateCylinder("actSignPole", { height: 1.6, diameter: 0.08, tessellation: 8 }, scene);
  pole.material = deckMat; pole.position.set(P.shoreX, P.deckY + 0.8, P.shoreZ + P.length - 1.2); meshes.push(pole);
  // boias de reserva no suporte, em pé
  const colors = [new Color3(0.1, 0.45, 0.85), new Color3(0.95, 0.75, 0.1)];
  colors.forEach((c, i) => {
    const holder = new TransformNode("actSpare" + i, scene);
    holder.position.set(P.shoreX - P.width / 2 + 0.35, P.deckY + 0.65, P.shoreZ + P.length - 7 - i * 0.45);
    holder.rotation.z = Math.PI / 2 - 0.15;
    meshes.push(...buildTubeMesh(scene, "actSpareTube" + i, holder, c));
  });
  for (const m of meshes) m.isPickable = false;
  return meshes;
};

export class TowTubeVisual {
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  readonly rider: Pilot;
  private readonly rope: LinesMesh;
  private onTube = true;

  constructor(scene: Scene) {
    this.root = new TransformNode("towTube", scene);
    this.meshes = buildTubeMesh(scene, "towTubeM", this.root, new Color3(0.95, 0.28, 0.12));
    // a pessoa sentada no assento da boia, de frente para a corda (para o barco)
    this.rider = buildPassenger(scene, this.root, 0, -0.05, "tubeRider", 2, -0.32);
    this.meshes.push(...this.rider.meshes);
    this.rope = MeshBuilder.CreateLines("towRope", { points: [Vector3.Zero(), Vector3.Up()], updatable: true, colors: [new Color4(0.95, 0.85, 0.2, 1), new Color4(0.95, 0.85, 0.2, 1)] }, scene);
    this.rope.isPickable = false;
  }

  update(tube: TowTube, t: number): void {
    // boia: posição, rumo e a inclinação pela chicotada
    this.root.position.set(tube.pos.x, tube.pos.y - 0.06, tube.pos.z);
    this.root.rotationQuaternion = Quaternion.FromEulerAngles(0, tube.yaw, tube.bank);
    // corda: da popa do veículo à argola da frente da boia
    const b: Speedboat | null = tube.hooked;
    this.rope.setEnabled(!!b);
    if (b) {
      const tp = b.toWorld(TowTube.towLocal(b));
      const front = new Vector3(tube.pos.x + Math.sin(tube.yaw) * 0.8, tube.pos.y, tube.pos.z + Math.cos(tube.yaw) * 0.8);
      // corda frouxa: um pouco de barriga (até a água); esticada: reta
      const mid = new Vector3((tp.x + front.x) / 2, Math.max(tube.pos.y - 0.05, (tp.y + front.y) / 2 - (tube.tension > 30 ? 0 : 0.6)), (tp.z + front.z) / 2);
      MeshBuilder.CreateLines("towRope", { points: [new Vector3(tp.x, tp.y, tp.z), mid, front], instance: this.rope });
    }
    // a pessoa
    const on = tube.rider === "tube" || tube.rider === "climbing";
    if (on && !this.onTube) this.rider.board(this.root);
    this.onTube = on;
    if (tube.rider === "climbing") {
      // subindo: meio corpo na água, ao lado da boia
      this.rider.float(new Vector3(tube.pos.x + Math.cos(tube.yaw) * 0.9, tube.pos.y, tube.pos.z - Math.sin(tube.yaw) * 0.9), tube.yaw - Math.PI / 2, t, 0);
      this.onTube = false;
    } else if (tube.rider === "water") this.rider.float(new Vector3(tube.riderPos.x, tube.riderPos.y, tube.riderPos.z), tube.riderYaw, t, tube.swimming ? 1 : 0);
    else if (tube.rider === "pier") this.rider.stand(new Vector3(tube.riderPos.x, tube.riderPos.y, tube.riderPos.z), tube.riderYaw, t);
  }
}
