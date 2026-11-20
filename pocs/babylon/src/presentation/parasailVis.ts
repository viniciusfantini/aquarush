// Visual do PARASAIL (atividade): o píer com a plataforma de decolagem, o velame (abre e murcha pelo `infl` da sim e
// aponta para a resultante aerodinâmica `canopyDir`), as linhas de suspensão, a corda até a popa e a pessoa (em pé no
// píer, pendurada na cadeirinha, ou boiando/nadando de colete). Só lê o estado da simulação (`sim/parasail.ts`).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode, Quaternion, VertexBuffer, type LinesMesh } from "@babylonjs/core";
import type { PierLayout } from "../sim/world.ts";
import { groundHeight } from "../sim/world.ts";
import { Parasail, HARNESS_H } from "../sim/parasail.ts";
import { TowTube } from "../sim/towTube.ts";
import { buildPassenger, type Pilot } from "./pilot.ts";
import { signMat } from "./station.ts";
import { colorize } from "./boatMesh.ts";
import { RopeTube } from "./ropeTube.ts";

const CANOPY_R = 4.2, RISER_L = 7.5, GORES = 12;

/** Píer do parasail: deck sobre estacas (1,3 m), plataforma de decolagem, placa, biruta e o saco do velame */
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
  // (v0.75.5: sem guarda-corpo — a equipe e o velame aberto ocupam a plataforma)
  // placa de duas faces
  const sm = signMat(scene, "psSignT", "PARASAIL", "G engata · G solta", "#1b5fd1", "#ffffff");
  for (const yaw of [0, Math.PI]) {
    const s = MeshBuilder.CreatePlane("psSign", { width: 2.6, height: 0.8 }, scene);
    s.material = sm; s.rotation.y = yaw; s.position.set(P.shoreX, P.deckY + 2.3, z0 + len - 12 + (yaw ? -0.01 : 0.01)); meshes.push(s);
  }
  const pole = MeshBuilder.CreateCylinder("psSignPole", { height: 2, diameter: 0.08, tessellation: 8 }, scene);
  pole.material = post; pole.position.set(P.shoreX, P.deckY + 1, z0 + len - 12); meshes.push(pole);
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
  /** equipe da plataforma: dois ajudantes que seguram a borda do velame até a pessoa sair */
  private readonly crew: Pilot[] = [];
  /** vértices originais do velame (para o tecido tremular) */
  private readonly base: Float32Array;
  private readonly work: Float32Array;

  constructor(scene: Scene) {
    this.canopyRoot = new TransformNode("psCanopyRoot", scene);
    // velame: calota com gomos em três cores; o "topo" (+Y local) aponta para longe da pessoa, +Z local = bordo de
    // ataque (para o barco) e, atrás (−Z), as duas SAÍDAS DE AR (fendas abertas, com bainha escura) e o respiro do topo
    const c = MeshBuilder.CreateSphere("psCanopy", { diameter: CANOPY_R * 2, segments: 44, slice: 0.42, sideOrientation: Mesh.DOUBLESIDE, updatable: true }, scene);
    const cols = [new Color3(0.95, 0.2, 0.15), new Color3(1, 0.85, 0.15), new Color3(0.1, 0.4, 0.9)];
    const pos = c.getVerticesData(VertexBuffer.PositionKind)!;
    const rgba: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i] / CANOPY_R, y = pos[i + 1] / CANOPY_R, z = pos[i + 2] / CANOPY_R;
      let col = cols[Math.floor(((Math.atan2(x, z) + Math.PI) / (2 * Math.PI)) * GORES) % GORES % 3], a = 1;
      if (y > 0.985) { col = new Color3(1, 1, 1); a = 0; }                  // respiro do topo (aberto, pequeno)
      else if (y > 0.965) col = new Color3(0.95, 0.95, 0.95);                 // bainha do respiro
      // saídas de ar de trás: duas fendas (|x| 0,14–0,46 R, altura 0,3–0,62 R, só em z < 0)
      const ax = Math.abs(x);
      if (z < -0.2) {
        const inV = ax > 0.14 && ax < 0.46 && y > 0.3 && y < 0.62;
        const edge = ax > 0.1 && ax < 0.5 && y > 0.26 && y < 0.66;
        if (inV) { a = 0; } else if (edge) col = new Color3(0.12, 0.12, 0.14);
      }
      rgba.push(col.r, col.g, col.b, a);
    }
    c.setVerticesData(VertexBuffer.ColorKind, rgba);
    c.hasVertexAlpha = true;
    this.base = new Float32Array(pos); this.work = new Float32Array(pos);
    const cm = new StandardMaterial("psCanopyM", scene); cm.specularColor = new Color3(0.15, 0.15, 0.15); cm.backFaceCulling = false;
    c.material = cm; c.parent = this.canopyRoot; c.position.y = -CANOPY_R * 0.16; // (o slice guarda a calota de cima: a boca fica na origem)
    this.canopy = c; this.meshes.push(c);
    this.lines = MeshBuilder.CreateLineSystem("psLines", { lines: this.linePts(Vector3.Zero(), Vector3.Up(), 1), updatable: true }, scene);
    this.lines.color = new Color3(0.9, 0.9, 0.9); this.lines.isPickable = false;
    this.rope = new RopeTube(scene, "psRope", new Color3(1, 0.45, 0.1), 0.012); // corda laranja (contrasta com o céu e a água)
    this.flyerRoot = new TransformNode("psFlyerRoot", scene);
    this.flyer = buildPassenger(scene, this.flyerRoot, 0, 0, "psFlyer", 3, 0);
    this.meshes.push(...this.flyer.meshes);
    for (const k of [0, 1]) {
      const c = buildPassenger(scene, this.flyerRoot, 0, 0, "psCrew" + k, k, 0);
      this.crew.push(c); this.meshes.push(...c.meshes);
    }
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

  /** tecido tremulando: ondas pelos gomos, mais forte na borda e com o velame mal cheio; a boca (presa nas linhas) fica */
  private flutter(amp: number, t: number): void {
    const b = this.base, w = this.work, R = CANOPY_R;
    for (let i = 0; i < b.length; i += 3) {
      const x = b[i], y = b[i + 1], z = b[i + 2];
      const th = Math.atan2(x, z), lat = (y / R - 0.16) / 0.84; // 0 = boca, 1 = topo
      const s = amp * Math.sin(Math.PI * Math.min(1, lat * 1.4)) *
        (0.6 * Math.sin(GORES * th + t * 7.1) + 0.4 * Math.sin(3 * th - t * 2.3 + lat * 4));
      const k = 1 + s / R;
      w[i] = x * k; w[i + 1] = y * k; w[i + 2] = z * k;
    }
    this.canopy.updateVerticesData(VertexBuffer.PositionKind, w);
  }

  update(ps: Parasail, waterY: number, t: number): void {
    const h = new Vector3(ps.pos.x, ps.pos.y + 0.55, ps.pos.z); // argolas da cadeirinha (acima do centro)
    const open = ps.infl;
    // eixo do velame: a resultante aerodinâmica; murcho, ele "deita" atrás da pessoa
    let ax = new Vector3(ps.canopyDir.x, ps.canopyDir.y, ps.canopyDir.z).normalize();
    const dist = RISER_L * (0.45 + 0.55 * open);
    let cc = h.add(ax.scale(dist));
    if (cc.y < waterY + 0.25) { cc = new Vector3(cc.x, waterY + 0.25, cc.z); ax = cc.subtract(h).normalize(); }
    // plataforma (referencial do píer: frente = +Z, para o lago)
    const L = ps.launchPos(), deckTop = L.y - HARNESS_H;
    const holding = !ps.docked && ps.state === "pier";
    // quanto a corda já puxa: 0 = a equipe segura o velame em leque, baixo, atrás da pessoa; 1 = soltaram, ele enche
    const pull = holding ? Math.min(1, ps.tension / 800) : 1;
    if (holding) {
      // em leque: boca virada para a pessoa/barco, eixo deitado para trás, a equipe segura por trás (~2 m do deck);
      // o vento balança o pano nas mãos deles
      const axHeld = new Vector3(0.06 * Math.sin(t * 1.3), 0.45 + 0.06 * Math.sin(t * 2.1 + 1), -0.89).normalize();
      const ccHeld = new Vector3(L.x + 0.1 * Math.sin(t * 0.9), deckTop + 2.1 + 0.08 * Math.sin(t * 1.7), L.z - 2.4);
      // enchendo (a corda puxou): o eixo sobe e vai para a resultante, acima do deck
      const axUp = new Vector3(0, 0.9, -0.45).normalize();
      ax = Vector3.Lerp(axHeld, axUp, pull).normalize();
      cc = Vector3.Lerp(ccHeld, h.add(axUp.scale(dist)), pull);
      const r = CANOPY_R * (0.35 + 0.65 * open);
      const minY = deckTop + 0.3 + r * Math.sqrt(Math.max(0, 1 - ax.y * ax.y));
      if (cc.y < minY) cc = new Vector3(cc.x, minY, cc.z);
    }
    if (ps.docked) {
      // dobrado na plataforma, atrás da pessoa (no deck)
      cc = new Vector3(ps.pos.x + 0.6, ps.pos.y - HARNESS_H, ps.pos.z - 1.8); ax = Vector3.Up();
    }
    // no ar: balança devagar em volta do eixo (o pano não é rígido)
    if (!holding && !ps.docked && ps.state === "air") {
      const sw = new Vector3(0.035 * Math.sin(t * 0.7), 0.02 * Math.sin(t * 1.1 + 2), 0.035 * Math.sin(t * 0.55 + 1));
      ax = ax.add(sw).normalize();
    }
    this.canopyRoot.position.copyFrom(cc);
    // orientação com o bordo de ataque (+Z local) para o barco/vento: assim as saídas de ar ficam atrás
    const yw = ps.yaw, toBoat = new Vector3(Math.sin(yw), 0, Math.cos(yw));
    let fz = toBoat.subtract(ax.scale(Vector3.Dot(toBoat, ax)));
    if (fz.lengthSquared() < 1e-4) fz = new Vector3(0, 0, 1).subtract(ax.scale(ax.z));
    fz.normalize();
    const fx = Vector3.Cross(ax, fz).normalize();
    this.canopyRoot.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(fx, ax, fz);
    if (ps.docked) this.canopyRoot.scaling.set(0.17, 0.2, 0.17); // dobrado: um "fardo" de pano no deck
    else if (holding) { const w = 0.5 + 0.35 * pull; this.canopyRoot.scaling.set(w, 0.3 + 0.5 * pull, w); } // em leque nas mãos da equipe
    else this.canopyRoot.scaling.set(0.35 + 0.65 * open, 0.12 + 0.88 * open, 0.35 + 0.65 * open);
    // tecido: tremula forte nas mãos da equipe e enchendo, pouco cheio no ar, quase nada dobrado/na água
    this.flutter(ps.docked ? 0 : holding ? 0.16 * (1 - 0.5 * pull) : ps.state === "air" ? 0.035 + 0.04 * (1 - open) : 0.02, t);
    MeshBuilder.CreateLineSystem("psLines", { lines: this.linePts(h, ax, open, cc), instance: this.lines });
    this.lines.setEnabled(!ps.docked);
    // corda até a popa
    const b = ps.hooked;
    this.rope.setEnabled(!!b);
    if (b) {
      const tp = b.toWorld(TowTube.towLocal(b));
      // presa na frente da cadeirinha (abaixo dos olhos: em 1ª pessoa ela sai do peito e desce até o barco)
      const ring = new Vector3(ps.pos.x + Math.sin(yw) * 0.25, ps.pos.y + 0.05, ps.pos.z + Math.cos(yw) * 0.25);
      const a = new Vector3(tp.x, tp.y, tp.z), P = ps.pier;
      // frouxa: a barriga vem da folga da corda (45 m) e ela fica por CIMA do deck do píer e da água, não dentro
      const floorAt = (x: number, z: number) =>
        Math.abs(x - P.shoreX) < P.width / 2 + 0.05 && z > P.shoreZ - 3 && z < P.shoreZ + P.length + 0.05 ? P.deckY : waterY - 0.02;
      this.rope.update(a, ring, RopeTube.sagFor(ps.p.ropeLen, Vector3.Distance(a, ring), ps.tension, 0.3), waterY - 0.02, floorAt);
    }
    // a pessoa
    const feet = new Vector3(ps.pos.x, ps.pos.y - HARNESS_H, ps.pos.z);
    if (ps.state === "water") this.flyer.float(new Vector3(ps.pos.x, waterY, ps.pos.z), ps.yaw, t, ps.swimming ? 1 : 0);
    else {
      this.flyer.stand(feet, ps.docked ? Math.PI : ps.yaw, t);
      // no ar (ou rebocada na plataforma): mãos nas linhas, acima da cabeça
      if (!ps.docked) this.flyer.update(new Vector3(-0.22, 1.25, -0.2), new Vector3(0.22, 1.25, -0.2));
    }
    // equipe: ATRÁS do velame, um de cada lado, de frente para o lago; seguram o pano por trás com os braços para
    // cima e para a frente até ele encher (soltam quando a corda puxa) — depois ficam de braços baixos olhando
    const grab = holding && pull < 0.7;
    this.crew.forEach((c, k) => {
      const sx = k ? 1 : -1;
      c.stand(new Vector3(L.x + sx * 1.1, deckTop, L.z - 4.1), 0, t + k * 1.3);
      if (grab) {
        const j = 0.05 * Math.sin(t * 2.4 + k); // acompanhando o pano que puxa
        c.update(new Vector3(-0.28, 1.42 + j, 0.42), new Vector3(0.28, 1.42 - j, 0.42));
      }
    });
  }
}
