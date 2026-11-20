// Visual da BOIA REBOCADA (atividade): o píer da boia, a boia com as alças, a corda até a popa do veículo e a pessoa
// (sentada na boia, boiando/nadando de colete ou em pé no píer). Só lê o estado da simulação (`sim/towTube.ts`).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, Vector3, TransformNode, Quaternion, DynamicTexture, ParticleSystem, type LinesMesh } from "@babylonjs/core";
import { colorize } from "./boatMesh.ts";
import { RopeTube } from "./ropeTube.ts";
import type { PierLayout } from "../sim/world.ts";
import { groundHeight } from "../sim/world.ts";
import { TowTube } from "../sim/towTube.ts";
import type { Speedboat } from "../sim/boat.ts";
import { buildPassenger, type Pilot } from "./pilot.ts";
import { signMat } from "./station.ts";

/** capa do assento: gomos em duas cores, anel branco e o miolo com uma estrela — impresso num canvas (sem marca) */
const seatCoverTex = (scene: Scene, name: string, a: string, b: string): DynamicTexture => {
  const N = 256, t = new DynamicTexture(name, { width: N, height: N }, scene, true);
  const c = t.getContext() as unknown as CanvasRenderingContext2D, R = N / 2;
  for (let k = 0; k < 12; k++) {
    c.beginPath(); c.moveTo(R, R); c.arc(R, R, R, (k / 12) * Math.PI * 2, ((k + 1) / 12) * Math.PI * 2); c.closePath();
    c.fillStyle = k % 2 ? a : b; c.fill();
  }
  c.lineWidth = 10; c.strokeStyle = "#ffffff"; c.beginPath(); c.arc(R, R, R * 0.62, 0, Math.PI * 2); c.stroke();
  c.fillStyle = "#1b1d22"; c.beginPath(); c.arc(R, R, R * 0.36, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#ffffff"; c.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? R * 0.12 : R * 0.27, an = -Math.PI / 2 + (k / 10) * Math.PI * 2;
    if (k === 0) c.moveTo(R + Math.cos(an) * r, R + Math.sin(an) * r); else c.lineTo(R + Math.cos(an) * r, R + Math.sin(an) * r);
  }
  c.closePath(); c.fill();
  t.update();
  return t;
};

/**
 * Boia de 1 pessoa ("donut"): pneu de vinil brilhante com a saia de baixo escura e uma faixa clara, capa do assento
 * estampada, seis alças de fita com punho acolchoado, argola em D de engate na frente. Frente = +Z (lado da corda).
 */
const buildTubeMesh = (scene: Scene, name: string, parent: TransformNode | null, color: Color3, accent = "#ffffff"): Mesh[] => {
  const vinyl = new StandardMaterial(name + "Mat", scene); vinyl.specularColor = new Color3(0.55, 0.55, 0.55); vinyl.specularPower = 48;
  const strap = new StandardMaterial(name + "Strap", scene); strap.diffuseColor = new Color3(0.05, 0.05, 0.06); strap.specularColor = new Color3(0.1, 0.1, 0.1);
  const grip = new StandardMaterial(name + "Grip", scene); grip.diffuseColor = new Color3(0.12, 0.12, 0.14); grip.specularColor = new Color3(0.05, 0.05, 0.05);
  const steel = new StandardMaterial(name + "Steel", scene); steel.diffuseColor = new Color3(0.78, 0.79, 0.82); steel.specularColor = new Color3(0.9, 0.9, 0.9); steel.specularPower = 96;
  const cover = new StandardMaterial(name + "Cover", scene);
  const hex = (c: Color3) => "rgb(" + ((c.r * 255) | 0) + "," + ((c.g * 255) | 0) + "," + ((c.b * 255) | 0) + ")";
  cover.diffuseTexture = seatCoverTex(scene, name + "CoverT", hex(color), accent); cover.specularColor = new Color3(0.2, 0.2, 0.2);
  const ring = MeshBuilder.CreateTorus(name + "Ring", { diameter: 1.25, thickness: 0.36, tessellation: 40 }, scene);
  ring.material = vinyl;
  // cores por vértice: saia de baixo quase preta, faixa clara no meio da lateral, cor da boia em cima
  const dark = new Color3(0.08, 0.08, 0.1), band = Color3.FromHexString(accent);
  colorize(ring, (_x, y) => (y < -0.06 ? dark : y < 0.0 ? band : color));
  // capa do assento (disco por cima) e a costura em volta
  const seat = MeshBuilder.CreateCylinder(name + "Seat", { height: 0.05, diameter: 1.02, tessellation: 40 }, scene);
  seat.material = cover; seat.position.y = 0.12; seat.rotation.y = Math.PI / 12;
  const seam = MeshBuilder.CreateTorus(name + "Seam", { diameter: 1.04, thickness: 0.02, tessellation: 40 }, scene);
  seam.material = strap; seam.position.y = 0.145;
  const out: Mesh[] = [ring, seat, seam];
  // seis alças: fita em arco + punho acolchoado
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const px = Math.sin(a) * 0.47, pz = Math.cos(a) * 0.47;
    const h = MeshBuilder.CreateTorus(name + "Handle", { diameter: 0.17, thickness: 0.018, tessellation: 12 }, scene);
    h.material = strap; h.position.set(px, 0.2, pz); h.rotation.set(0, a + Math.PI / 2, 0); h.scaling.set(1, 1, 0.7);
    const g = MeshBuilder.CreateCylinder(name + "HandleGrip", { height: 0.12, diameter: 0.045, tessellation: 10 }, scene);
    g.material = grip; g.position.set(px, 0.27, pz); g.rotation.set(0, a, Math.PI / 2);
    out.push(h, g);
  }
  // argola em D e o reforço onde a corda prende
  const tow = MeshBuilder.CreateTorus(name + "TowPt", { diameter: 0.12, thickness: 0.018, tessellation: 12 }, scene);
  tow.material = steel; tow.position.set(0, 0.0, 0.83); tow.rotation.x = Math.PI / 2;
  const patch = MeshBuilder.CreateBox(name + "TowPatch", { width: 0.16, height: 0.12, depth: 0.03 }, scene);
  patch.material = strap; patch.position.set(0, 0.0, 0.79);
  const valve = MeshBuilder.CreateCylinder(name + "Valve", { height: 0.03, diameter: 0.05, tessellation: 10 }, scene);
  valve.material = steel; valve.position.set(-0.55, 0.12, -0.25);
  out.push(tow, patch, valve);
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
  const accents = ["#ffffff", "#1b5fd1"];
  colors.forEach((c, i) => {
    const holder = new TransformNode("actSpare" + i, scene);
    holder.position.set(P.shoreX - P.width / 2 + 0.35, P.deckY + 0.65, P.shoreZ + P.length - 7 - i * 0.45);
    holder.rotation.z = Math.PI / 2 - 0.15;
    meshes.push(...buildTubeMesh(scene, "actSpareTube" + i, holder, c, accents[i]));
  });
  for (const m of meshes) m.isPickable = false;
  return meshes;
};

export class TowTubeVisual {
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  readonly rider: Pilot;
  private readonly rope: RopeTube;
  private onTube = true;
  private readonly spray: ParticleSystem;

  constructor(scene: Scene) {
    this.root = new TransformNode("towTube", scene);
    this.meshes = buildTubeMesh(scene, "towTubeM", this.root, new Color3(0.95, 0.28, 0.12), "#ffd34d");
    // spray: a boia planando joga água pelos lados e para trás (só visual: lê a velocidade e o contato da sim)
    const dot = new DynamicTexture("tubeSprayTex", { width: 32, height: 32 }, scene, false);
    const dc = dot.getContext() as unknown as CanvasRenderingContext2D, gr = dc.createRadialGradient(16, 16, 1, 16, 16, 15);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); dc.fillStyle = gr; dc.fillRect(0, 0, 32, 32); dot.hasAlpha = true; dot.update();
    const ps = new ParticleSystem("tubeSpray", 500, scene);
    ps.particleTexture = dot; ps.emitter = Vector3.Zero(); ps.minEmitBox = Vector3.Zero(); ps.maxEmitBox = Vector3.Zero();
    ps.color1 = new Color4(1, 1, 1, 0.8); ps.color2 = new Color4(0.85, 0.93, 0.97, 0.6); ps.colorDead = new Color4(0.9, 0.95, 1, 0);
    ps.minSize = 0.08; ps.maxSize = 0.35; ps.minLifeTime = 0.3; ps.maxLifeTime = 0.8; ps.gravity = new Vector3(0, -9.81, 0);
    ps.emitRate = 0; ps.start();
    this.spray = ps;
    // a pessoa sentada no assento da boia, de frente para a corda (para o barco)
    this.rider = buildPassenger(scene, this.root, 0, -0.05, "tubeRider", 2, -0.32);
    this.meshes.push(...this.rider.meshes);
    this.rope = new RopeTube(scene, "towRope", new Color3(1, 0.82, 0.1), 0.011); // corda amarela
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
      this.rope.update(new Vector3(tp.x, tp.y, tp.z), front, RopeTube.sagFor(tube.p.ropeLen, Vector3.Distance(new Vector3(tp.x, tp.y, tp.z), front), tube.tension, 0.05), tube.pos.y - 0.1);
    }
    // spray dos lados quando ela anda rápido encostada na água
    const sp = Math.hypot(tube.vel.x, tube.vel.z);
    const fx = Math.sin(tube.yaw), fz = Math.cos(tube.yaw), k = Math.min(1.6, sp / 8);
    this.spray.emitter = new Vector3(tube.pos.x - fx * 0.5, tube.pos.y - 0.12, tube.pos.z - fz * 0.5);
    this.spray.minEmitBox = new Vector3(-0.6, 0, -0.6); this.spray.maxEmitBox = new Vector3(0.6, 0.05, 0.6);
    const carry = new Vector3(tube.vel.x * 0.4, 0, tube.vel.z * 0.4);
    this.spray.direction1 = new Vector3(-fx * 2 + fz * 2.5, 1.2, -fz * 2 - fx * 2.5).scale(k).add(carry);
    this.spray.direction2 = new Vector3(-fx * 2 - fz * 2.5, 2.2, -fz * 2 + fx * 2.5).scale(k).add(carry);
    this.spray.emitRate = !tube.docked && !tube.airborne && sp > 4 ? Math.min(400, (sp - 4) * 45) : 0;
    // a pessoa
    const on = tube.rider === "tube" || tube.rider === "climbing";
    if (on && !this.onTube) this.rider.board(this.root);
    this.onTube = on;
    // sentada, segurando as duas alças da frente
    if (tube.rider === "tube") this.rider.update(new Vector3(-0.24, 0.27, 0.41), new Vector3(0.24, 0.27, 0.41));
    if (tube.rider === "climbing") {
      // subindo: meio corpo na água, ao lado da boia
      this.rider.float(new Vector3(tube.pos.x + Math.cos(tube.yaw) * 0.9, tube.pos.y, tube.pos.z - Math.sin(tube.yaw) * 0.9), tube.yaw - Math.PI / 2, t, 0);
      this.onTube = false;
    } else if (tube.rider === "water") this.rider.float(new Vector3(tube.riderPos.x, tube.riderPos.y, tube.riderPos.z), tube.riderYaw, t, tube.swimming ? 1 : 0);
    else if (tube.rider === "pier") this.rider.stand(new Vector3(tube.riderPos.x, tube.riderPos.y, tube.riderPos.z), tube.riderYaw, t);
  }
}
