// Visual da âncora de proa (Danforth + cabo até a roldana) e do jato da bomba de porão pelo costado.
// Só lê a simulação: Speedboat.anchor (estado, posição, cabo lançado) e a telemetria do porão.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, Color4, TransformNode, Vector3, LinesMesh, Quaternion } from "@babylonjs/core";
import type { Speedboat } from "../sim/boat.ts";
import { v3, rotateInv } from "../sim/math.ts";
import { jetStreakLocal } from "../sim/bilgeJet.ts";
import type { SpeedboatParams } from "../sim/params.ts";
import type { IWaterSurface } from "../sim/water.ts";

const ROPE_N = 16;
const JET_N = 14;
const G = 9.81;

export class BoatGearVis {
  private readonly root: TransformNode;      // nó do barco (visual)
  private readonly anchor: TransformNode;    // argola na origem; haste para −Y até a cruz (tamanho L)
  private readonly L: number;
  private readonly rope: LinesMesh;
  private readonly P: SpeedboatParams;
  private readonly stream: Mesh | null = null;
  private readonly drops: Mesh[] = [];
  private readonly foam: Mesh | null = null;
  private readonly streamPath: Vector3[] = [];
  private readonly streamR: number[] = [];
  private stowed = true;
  readonly meshes: Mesh[] = [];

  constructor(scene: Scene, root: TransformNode, P: SpeedboatParams, prefix: string) {
    this.root = root; this.P = P;
    const steel = new PBRMaterial(prefix + "AnchorSteel", scene);
    steel.albedoColor = new Color3(0.72, 0.74, 0.76); steel.metallic = 0.9; steel.roughness = 0.35;
    const L = (this.L = P.anchor.motorA > 0 ? 0.62 : 0.4);
    const a = (this.anchor = new TransformNode(prefix + "Anchor", scene));
    const add = (m: Mesh) => { m.parent = a; m.material = steel; m.isPickable = false; this.meshes.push(m); return m; };
    // argola, haste, cruz (eixo) e as duas unhas (patas) largas — âncora tipo Danforth
    const ring = add(MeshBuilder.CreateTorus(prefix + "AnchorRing", { diameter: L * 0.14, thickness: L * 0.03, tessellation: 16 }, scene));
    ring.rotation.z = Math.PI / 2;
    add(MeshBuilder.CreateBox(prefix + "AnchorShank", { width: L * 0.06, height: L, depth: L * 0.025 }, scene)).position.y = -L / 2;
    const stock = add(MeshBuilder.CreateCylinder(prefix + "AnchorStock", { height: L * 0.95, diameter: L * 0.05, tessellation: 10 }, scene));
    stock.rotation.z = Math.PI / 2; stock.position.y = -L * 0.95;
    for (const s of [-1, 1]) {
      const fluke = add(MeshBuilder.CreateBox(prefix + "AnchorFluke", { width: L * 0.3, height: L * 0.62, depth: L * 0.02 }, scene));
      fluke.position.set(s * L * 0.2, -L * 0.7, 0); fluke.rotation.z = -s * 0.12; fluke.rotation.x = 0.5; // patas em ângulo (~30°) para unhar
    }
    this.rope = MeshBuilder.CreateLines(prefix + "AnchorRope", { points: Array.from({ length: ROPE_N }, () => Vector3.Zero()), updatable: true, colors: Array.from({ length: ROPE_N }, () => new Color4(0.93, 0.89, 0.72, 1)) }, scene);
    this.rope.isPickable = false;
    this.rope.setEnabled(false);
    this.stowAnchor();

    // ---- jato da bomba de porão (só barco com bomba elétrica) ----
    if (P.bilge.pumpLph > 0) {
      const o = P.bilge.outlet, sx = Math.sign(o.x) || 1;
      const thru = MeshBuilder.CreateCylinder(prefix + "BilgeThruHull", { height: 0.03, diameter: 0.07, tessellation: 14 }, scene);
      thru.rotation.z = Math.PI / 2; thru.position.set(o.x + sx * 0.005, o.y, o.z); thru.parent = root; thru.material = steel; thru.isPickable = false;
      this.meshes.push(thru);
      const wm = new StandardMaterial(prefix + "BilgeWater", scene);
      wm.diffuseColor = new Color3(0.8, 0.9, 1); wm.emissiveColor = new Color3(0.25, 0.3, 0.35); wm.alpha = 0.7; wm.specularColor = new Color3(1, 1, 1);
      // jato no MUNDO (trajetória balística recalculada a cada quadro a partir da simulação)
      for (let i = 0; i < JET_N; i++) { this.streamPath.push(new Vector3(0, -i * 0.01, 0)); this.streamR.push(0.01); }
      const tube = MeshBuilder.CreateTube(prefix + "BilgeJet", { path: this.streamPath, radiusFunction: (i) => this.streamR[i] ?? 0.01, tessellation: 10, cap: Mesh.CAP_ALL, updatable: true }, scene);
      tube.material = wm; tube.isPickable = false; tube.setEnabled(false);
      this.stream = tube;
      for (let i = 0; i < 14; i++) {
        const d = MeshBuilder.CreateSphere(prefix + "BilgeDrop", { diameter: 1, segments: 6 }, scene);
        d.material = wm; d.isPickable = false; d.setEnabled(false);
        this.drops.push(d);
      }
      const foam = MeshBuilder.CreateDisc(prefix + "BilgeFoam", { radius: 1, tessellation: 20 }, scene);
      foam.rotation.x = Math.PI / 2; foam.material = wm; foam.isPickable = false; foam.setEnabled(false);
      this.foam = foam;
      this.meshes.push(tube, foam, ...this.drops);
    }
  }

  /** âncora na roldana de proa: haste deitada para a frente, patas para fora do bico */
  private stowAnchor(): void {
    const r = this.P.anchor.roller;
    this.anchor.parent = this.root;
    this.anchor.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), -Math.PI / 2 + 0.35);
    this.anchor.position.set(r.x, r.y + 0.02, r.z - this.L * 0.55);
    this.stowed = true;
  }

  update(boat: Speedboat, time: number, active: boolean, water?: IWaterSurface): void {
    const A = boat.anchor, T = boat.telemetry;
    // ---- âncora e cabo ----
    if (A.state === "recolhida" || !active) {
      if (!this.stowed) this.stowAnchor();
      this.rope.setEnabled(false);
    } else {
      if (this.stowed) { this.anchor.parent = null; this.stowed = false; }
      const bow = boat.toWorld(this.P.anchor.roller);
      const bowV = new Vector3(bow.x, bow.y, bow.z);
      let ringP: Vector3;
      if (!A.onBottom) {
        // pendurada: argola em cima, patas para baixo (a posição da sim é a cruz)
        this.anchor.rotationQuaternion = Quaternion.Identity();
        ringP = new Vector3(A.pos.x, A.pos.y + this.L, A.pos.z);
        if (ringP.y > bow.y) ringP.y = bow.y;
      } else {
        // deitada no fundo: argola para o lado do barco, patas enterrando do outro lado
        const dx = bow.x - A.pos.x, dz = bow.z - A.pos.z;
        const yaw = Math.atan2(dx, dz);
        this.anchor.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, Math.PI / 2 - 0.25, 0);
        const h = Math.hypot(dx, dz) || 1;
        ringP = new Vector3(A.pos.x + (dx / h) * 0.05, A.pos.y + 0.06, A.pos.z + (dz / h) * 0.05);
      }
      this.anchor.position.copyFrom(ringP);
      // cabo: reta da roldana até a argola, com barriga quando há folga (e nunca abaixo da argola)
      const dist = Vector3.Distance(bowV, ringP);
      const slack = Math.max(0, A.out - dist);
      const sag = Math.min(slack * 0.45, Math.max(0, bowV.y - ringP.y) * 0.9 + 0.3);
      const pts: Vector3[] = [];
      for (let i = 0; i < ROPE_N; i++) {
        const s = i / (ROPE_N - 1);
        const p = Vector3.Lerp(bowV, ringP, s);
        p.y = Math.max(ringP.y, p.y - 4 * sag * s * (1 - s));
        pts.push(p);
      }
      MeshBuilder.CreateLines("", { points: pts, instance: this.rope });
      this.rope.setEnabled(true);
    }
    // ---- jato da bomba de porão: balístico no mundo, da saída até a superfície da água ----
    if (this.stream) {
      const Q = T.bilgeFlowLps / 1000; // m³/s
      const on = active && Q > 0.00005;
      this.stream.setEnabled(on);
      this.foam?.setEnabled(on);
      for (const d of this.drops) d.setEnabled(on);
      if (!on || !water) return;
      // O jato visível é a LINHA DE EMISSÃO: gotas soltas em instantes diferentes, todas carregando a velocidade do
      // barco. No referencial do barco: saem pela mangueira (v = Q/A, para fora e um pouco para baixo), caem com a
      // gravidade e o vento aparente (barco andando) as empurra para a popa. Depois vão para o mundo pela pose atual.
      const B = this.P.bilge, sx = Math.sign(B.outlet.x) || 1;
      const vOut = Math.max(0.3, Q / B.outletAreaM2);
      const rot = boat.rot;
      const gL = rotateInv(rot, v3(0, -G, 0));
      const airL = rotateInv(rot, v3(-boat.vel.x, 0, -boat.vel.z)); // ar parado visto do barco
      const M = this.root.computeWorldMatrix(true); // pose deste quadro (já interpolada)
      const DT = 0.01;
      const local = jetStreakLocal(B.outlet, sx, vOut, gL, airL, (q) => { const w = Vector3.TransformCoordinates(new Vector3(q.x, q.y, q.z), M); return w.y <= water.getHeight(w.x, w.z); }, DT);
      const pts = local.map((q) => Vector3.TransformCoordinates(new Vector3(q.x, q.y, q.z), M));
      const tHit = Math.max(DT, (pts.length - 1) * DT);
      const at = (t: number) => {
        const f = Math.min(pts.length - 1, (t / Math.max(tHit, DT)) * (pts.length - 1)), j = Math.floor(f), u = f - j;
        return Vector3.Lerp(pts[j], pts[Math.min(j + 1, pts.length - 1)], u);
      };
      // seção do jato pela continuidade: afina conforme acelera na queda
      for (let i = 0; i < JET_N; i++) {
        const t = (tHit * i) / (JET_N - 1);
        this.streamPath[i] = at(t);
        const vRel = Math.hypot(vOut, G * t);
        this.streamR[i] = Math.min(0.03, Math.max(0.004, Math.sqrt(Q / (Math.PI * vRel)))) * (1 - 0.35 * (i / (JET_N - 1)));
      }
      MeshBuilder.CreateTube("", { path: this.streamPath, radiusFunction: (i) => this.streamR[i] ?? 0.004, instance: this.stream });
      // gotas: o jato se quebra no fim da queda; mais gotas e mais espalhadas perto da água
      const hit = this.streamPath[JET_N - 1];
      this.drops.forEach((d, i) => {
        const u = (time * 1.7 + i / this.drops.length) % 1;
        if (i < 9) {
          const t = tHit * (0.35 + 0.65 * u);
          const spread = 0.05 * u * u;
          d.position.copyFrom(at(t)).addInPlace(new Vector3(Math.sin(i * 7.3 + time * 13) * spread, Math.cos(i * 5.1 + time * 9) * spread, Math.cos(i * 3.1 + time * 11) * spread));
          d.scaling.setAll((0.012 + 0.012 * ((i * 37) % 10) / 10) * (0.6 + 0.6 * Math.min(1, Q / 0.0007)));
        } else {
          // respingos na água: sobem um pouco e voltam (ciclo de ~0,3 s)
          const ph = (time * 3.3 + i * 0.37) % 1, a = (i * 2.4) % (Math.PI * 2);
          const r = 0.05 + 0.12 * ph;
          d.position.set(hit.x + Math.cos(a) * r, hit.y + 0.18 * ph * (1 - ph) * 4 * Math.min(1, Q / 0.0005), hit.z + Math.sin(a) * r);
          d.scaling.setAll(0.015 * (1 - ph));
        }
      });
      if (this.foam) {
        this.foam.position.set(hit.x, water.getHeight(hit.x, hit.z) + 0.01, hit.z);
        this.foam.scaling.setAll(0.04 + 0.09 * Math.min(1, Q / 0.0008) * (0.85 + 0.15 * Math.sin(time * 9)));
      }
    }
  }
}
