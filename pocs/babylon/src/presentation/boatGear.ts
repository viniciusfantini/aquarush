// Visual da âncora de proa (Danforth + cabo até a roldana) e do jato da bomba de porão pelo costado.
// Só lê a simulação: Speedboat.anchor (estado, posição, cabo lançado) e a telemetria do porão.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, Color4, TransformNode, Vector3, LinesMesh, Quaternion } from "@babylonjs/core";
import type { Speedboat } from "../sim/boat.ts";
import type { SpeedboatParams } from "../sim/params.ts";

const ROPE_N = 16;

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
      // parábola no referencial do barco: sai a ~1,4 m/s para fora e cai na água
      for (let i = 0; i <= 12; i++) {
        const t = (i / 12) * 0.3;
        this.streamPath.push(new Vector3(o.x + sx * 1.35 * t, o.y + 0.25 * t - 4.9 * t * t, o.z - 0.15 * t));
      }
      const tube = MeshBuilder.CreateTube(prefix + "BilgeJet", { path: this.streamPath, radius: 0.022, tessellation: 10, cap: Mesh.CAP_ALL }, scene);
      tube.parent = root; tube.material = wm; tube.isPickable = false; tube.setEnabled(false);
      this.stream = tube;
      for (let i = 0; i < 9; i++) {
        const d = MeshBuilder.CreateSphere(prefix + "BilgeDrop", { diameter: 0.05, segments: 6 }, scene);
        d.parent = root; d.material = wm; d.isPickable = false; d.setEnabled(false);
        this.drops.push(d);
      }
      const foam = MeshBuilder.CreateDisc(prefix + "BilgeFoam", { radius: 0.12, tessellation: 18 }, scene);
      foam.rotation.x = Math.PI / 2; foam.parent = root; foam.material = wm; foam.isPickable = false; foam.setEnabled(false);
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

  update(boat: Speedboat, time: number, active: boolean): void {
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
    // ---- jato da bomba de porão ----
    if (this.stream) {
      const on = active && T.bilgeFlowLps > 0.05;
      this.stream.setEnabled(on);
      this.foam?.setEnabled(on);
      const k = Math.min(1, T.bilgeFlowLps / 1.1);
      this.stream.scaling.setAll(1);
      this.drops.forEach((d, i) => {
        d.setEnabled(on);
        if (!on) return;
        const u = (time * 2.2 + i / this.drops.length) % 1;
        const f = u * (this.streamPath.length - 1), j = Math.floor(f), w = f - j;
        const a = this.streamPath[j], b = this.streamPath[Math.min(j + 1, this.streamPath.length - 1)];
        d.position.copyFrom(Vector3.Lerp(a, b, w)).addInPlace(new Vector3(0, Math.sin(i * 7.3 + time * 13) * 0.02, Math.cos(i * 3.1 + time * 11) * 0.02));
        d.scaling.setAll(0.6 + 0.6 * k * ((i * 37) % 10) / 10);
      });
      if (this.foam && on) {
        const e = this.streamPath[this.streamPath.length - 1];
        this.foam.position.set(e.x, e.y + 0.01, e.z);
        this.foam.scaling.setAll(0.7 + 0.35 * Math.sin(time * 9) * k + 0.3 * k);
      }
    }
  }
}
