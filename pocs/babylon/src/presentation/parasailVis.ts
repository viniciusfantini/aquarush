// Visual do PARASAIL (atividade): o píer com a plataforma de decolagem, o velame (abre e murcha pelo `infl` da sim e
// aponta para a resultante aerodinâmica `canopyDir`), as linhas de suspensão, a corda até a popa e a pessoa (em pé no
// píer, pendurada na cadeirinha, ou boiando/nadando de colete). Só lê o estado da simulação (`sim/parasail.ts`).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, Vector3, TransformNode, Quaternion, type LinesMesh } from "@babylonjs/core";
import type { PierLayout } from "../sim/world.ts";
import { groundHeight } from "../sim/world.ts";
import { Parasail, HARNESS_H } from "../sim/parasail.ts";
import { TowTube } from "../sim/towTube.ts";
import { buildPassenger, type Pilot } from "./pilot.ts";
import { signMat } from "./station.ts";
import { colorize } from "./boatMesh.ts";
import { RopeTube } from "./ropeTube.ts";

const CANOPY_R = 4.2, RISER_L = 7.5, GORES = 12;

/** Píer do parasail: deck sobre estacas (1,3 m), plataforma de decolagem com guarda-corpo, placa, biruta e o saco do velame */
export const buildParasailPier = (scene: Scene, P: PierLayout): Mesh[] => {
  const meshes: Mesh[] = [];
  const wood = new StandardMaterial("psWood", scene); wood.diffuseColor = new Color3(0.5, 0.37, 0.24); wood.specularColor = new Color3(0.05, 0.05, 0.05);
  const post = new StandardMaterial("psPost", scene); post.diffuseColor = new Color3(0.33, 0.25, 0.18);
  const plat = new StandardMaterial("psPlat", scene); plat.diffuseColor = new Color3(0.12, 0.42, 0.7); plat.specularColor = new Color3(0.1, 0.1, 0.1);
  const white = new StandardMaterial("psWhite", scene); white.diffuseColor = new Color3(0.92, 0.93, 0.92);
  const len = P.length + 3, z0 = P.shoreZ - 3;
  const deck = MeshBuilder.CreateBox("psDeck", { width: P.width, height: 0.2, depth: len - 5 }, scene);
  deck.material = wood; deck.position.set(P.shoreX, P.deckY - 0.1, z0 + (len - 5) / 2); meshes.push(deck);
  // plataforma de decolagem (5 m na ponta, piso azul antiderrapante)
  const pf = MeshBuilder.CreateBox("psLaunch", { width: P.width, height: 0.22, depth: 5 }, scene);
  pf.material = plat; pf.position.set(P.shoreX, P.deckY - 0.11, z0 + len - 2.5); meshes.push(pf);
  // estacas
  for (let z = z0 + 1; z <= z0 + len - 0.3; z += 4) for (const sx of [-1, 1]) {
    const x = P.shoreX + sx * (P.width / 2 - 0.12), g = groundHeight(x, z), h = P.deckY - g;
    const p = MeshBuilder.CreateCylinder("psPile", { height: h, diameter: 0.26, tessellation: 8 }, scene);
    p.material = post; p.position.set(x, g + h / 2, z); meshes.push(p);
  }
  // guarda-corpo dos lados da plataforma (a frente fica aberta: é por onde ela sai)
  for (const sx of [-1, 1]) {
    const x = P.shoreX + sx * (P.width / 2 - 0.05);
    const rail = MeshBuilder.CreateBox("psRail", { width: 0.06, height: 0.06, depth: 5 }, scene);
    rail.material = white; rail.position.set(x, P.deckY + 1.0, z0 + len - 2.5); meshes.push(rail);
    for (const dz of [0.1, 2.5, 4.9]) {
      const st = MeshBuilder.CreateBox("psRailPost", { width: 0.06, height: 1.0, depth: 0.06 }, scene);
      st.material = white; st.position.set(x, P.deckY + 0.5, z0 + len - 5 + dz); meshes.push(st);
    }
  }
  // placa de duas faces
  const sm = signMat(scene, "psSignT", "PARASAIL", "G engata · G solta", "#1b5fd1", "#ffffff");
  for (const yaw of [0, Math.PI]) {
    const s = MeshBuilder.CreatePlane("psSign", { width: 2.6, height: 0.8 }, scene);
    s.material = sm; s.rotation.y = yaw; s.position.set(P.shoreX, P.deckY + 2.3, z0 + len - 5.6 + (yaw ? -0.01 : 0.01)); meshes.push(s);
  }
  const pole = MeshBuilder.CreateCylinder("psSignPole", { height: 2, diameter: 0.08, tessellation: 8 }, scene);
  pole.material = post; pole.position.set(P.shoreX, P.deckY + 1, z0 + len - 5.6); meshes.push(pole);
  // biruta (mastro + cone listrado)
  const mast = MeshBuilder.CreateCylinder("psMast", { height: 4.5, diameter: 0.07, tessellation: 8 }, scene);
  mast.material = white; mast.position.set(P.shoreX - P.width / 2 + 0.1, P.deckY + 2.25, z0 + len - 9); meshes.push(mast);
  const sock = MeshBuilder.CreateCylinder("psSock", { height: 1.2, diameterTop: 0.12, diameterBottom: 0.3, tessellation: 12 }, scene);
  colorize(sock, (_x, y) => (Math.floor((y + 0.6) / 0.24) % 2 ? new Color3(1, 1, 1) : new Color3(1, 0.4, 0.1)));
  const sockM = new StandardMaterial("psSockM", scene); sock.material = sockM;
  sock.rotation.x = Math.PI / 2 - 0.25; sock.position.set(P.shoreX - P.width / 2 + 0.1, P.deckY + 4.3, z0 + len - 9.6); meshes.push(sock);
  // saco do velame reserva
  const bag = MeshBuilder.CreateCylinder("psBag", { height: 0.7, diameter: 0.55, tessellation: 14 }, scene);
  const bagM = new StandardMaterial("psBagM", scene); bagM.diffuseColor = new Color3(0.85, 0.2, 0.15); bag.material = bagM;
  bag.rotation.z = Math.PI / 2; bag.position.set(P.shoreX + P.width / 2 - 0.4, P.deckY + 0.28, z0 + len - 7); meshes.push(bag);
  for (const m of meshes) m.isPickable = false;
  return meshes;
};

export class ParasailVisual {
  readonly meshes: Mesh[] = [];
  readonly flyer: Pilot;
  private readonly canopyRoot: TransformNode;
  private readonly canopy: Mesh;
  private readonly lines: LinesMesh;
  private readonly rope: RopeTube;
  private readonly flyerRoot: TransformNode;

  constructor(scene: Scene) {
    this.canopyRoot = new TransformNode("psCanopyRoot", scene);
    // velame: meia esfera com gomos em três cores; o "topo" (+Y local) aponta para longe da pessoa
    const c = MeshBuilder.CreateSphere("psCanopy", { diameter: CANOPY_R * 2, segments: 24, slice: 0.42, sideOrientation: Mesh.DOUBLESIDE }, scene);
    const cols = [new Color3(0.95, 0.2, 0.15), new Color3(1, 0.85, 0.15), new Color3(0.1, 0.4, 0.9)];
    colorize(c, (x, y, z) => {
      if (y > CANOPY_R * 0.93) return new Color3(1, 1, 1); // respiro do topo
      const k = Math.floor(((Math.atan2(x, z) + Math.PI) / (2 * Math.PI)) * GORES) % GORES;
      return cols[k % 3];
    });
    const cm = new StandardMaterial("psCanopyM", scene); cm.specularColor = new Color3(0.15, 0.15, 0.15); cm.backFaceCulling = false;
    c.material = cm; c.parent = this.canopyRoot; c.position.y = -CANOPY_R * 0.16; // (o slice guarda a calota de cima: a boca fica na origem)
    this.canopy = c; this.meshes.push(c);
    this.lines = MeshBuilder.CreateLineSystem("psLines", { lines: this.linePts(Vector3.Zero(), Vector3.Up(), 1), updatable: true }, scene);
    this.lines.color = new Color3(0.9, 0.9, 0.9); this.lines.isPickable = false;
    this.rope = new RopeTube(scene, "psRope", new Color3(1, 0.45, 0.1), 0.012); // corda laranja (contrasta com o céu e a água)
    this.flyerRoot = new TransformNode("psFlyerRoot", scene);
    this.flyer = buildPassenger(scene, this.flyerRoot, 0, 0, "psFlyer", 3, 0);
    this.meshes.push(...this.flyer.meshes);
    for (const m of this.meshes) m.isPickable = false;
  }

  /** linhas de suspensão: da cadeirinha (`h`) à borda do velame (centro `cc`, eixo `ax`, abertura `open`) */
  private linePts(h: Vector3, ax: Vector3, open: number, cc?: Vector3): Vector3[][] {
    const center = cc ?? h.add(ax.scale(RISER_L));
    const u = Math.abs(ax.y) < 0.9 ? Vector3.Cross(ax, Vector3.Up()).normalize() : Vector3.Cross(ax, Vector3.Right()).normalize();
    const w = Vector3.Cross(ax, u).normalize();
    const r = CANOPY_R * 0.97 * (0.3 + 0.7 * open);
    const out: Vector3[][] = [];
    for (let k = 0; k < GORES; k++) {
      const a = (k / GORES) * Math.PI * 2;
      out.push([h, center.add(u.scale(Math.cos(a) * r)).add(w.scale(Math.sin(a) * r))]);
    }
    return out;
  }

  update(ps: Parasail, waterY: number, t: number): void {
    const h = new Vector3(ps.pos.x, ps.pos.y + 0.55, ps.pos.z); // argolas da cadeirinha (acima do centro)
    const open = ps.infl;
    // eixo do velame: a resultante aerodinâmica; murcho, ele "deita" atrás da pessoa
    let ax = new Vector3(ps.canopyDir.x, ps.canopyDir.y, ps.canopyDir.z).normalize();
    const dist = RISER_L * (0.45 + 0.55 * open);
    let cc = h.add(ax.scale(dist));
    if (cc.y < waterY + 0.25) { cc = new Vector3(cc.x, waterY + 0.25, cc.z); ax = cc.subtract(h).normalize(); }
    if (ps.docked || ps.state === "pier" && open < 0.3) {
      // dobrado na plataforma, atrás da pessoa (no deck)
      cc = new Vector3(ps.pos.x + 0.6, ps.pos.y - HARNESS_H, ps.pos.z - 1.8); ax = Vector3.Up();
    }
    this.canopyRoot.position.copyFrom(cc);
    const q = new Quaternion(); Quaternion.FromUnitVectorsToRef(Vector3.Up(), ax, q);
    this.canopyRoot.rotationQuaternion = q;
    if (ps.docked) this.canopyRoot.scaling.set(0.17, 0.2, 0.17); // dobrado: um "fardo" de pano no deck
    else this.canopyRoot.scaling.set(0.35 + 0.65 * open, 0.12 + 0.88 * open, 0.35 + 0.65 * open);
    MeshBuilder.CreateLineSystem("psLines", { lines: this.linePts(h, ax, open, cc), instance: this.lines });
    this.lines.setEnabled(!ps.docked);
    // corda até a popa
    const b = ps.hooked;
    this.rope.setEnabled(!!b);
    if (b) {
      const tp = b.toWorld(TowTube.towLocal(b));
      // presa na frente da cadeirinha (abaixo dos olhos: em 1ª pessoa ela sai do peito e desce até o barco)
      const yw = ps.yaw, ring = new Vector3(ps.pos.x + Math.sin(yw) * 0.25, ps.pos.y + 0.05, ps.pos.z + Math.cos(yw) * 0.25);
      this.rope.update(new Vector3(tp.x, tp.y, tp.z), ring, ps.tension > 50 ? 0.3 : 2.5, waterY);
    }
    // a pessoa
    const feet = new Vector3(ps.pos.x, ps.pos.y - HARNESS_H, ps.pos.z);
    if (ps.state === "water") this.flyer.float(new Vector3(ps.pos.x, waterY, ps.pos.z), ps.yaw, t, ps.swimming ? 1 : 0);
    else {
      this.flyer.stand(feet, ps.docked ? Math.PI : ps.yaw, t);
      // no ar (ou rebocada na plataforma): mãos nas linhas, acima da cabeça
      if (!ps.docked) this.flyer.update(new Vector3(-0.22, 1.25, -0.2), new Vector3(0.22, 1.25, -0.2));
    }
  }
}
