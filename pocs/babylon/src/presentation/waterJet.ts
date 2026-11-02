// Jato de água saindo de uma saída do casco (visual), desenhado como LINHA DE EMISSÃO no referencial do barco
// (`sim/bilgeJet.ts`): a água sai pela saída com v = Q/A na direção dela, cai com a gravidade, o vento aparente a
// empurra para a popa com o barco andando, quebra em gotas no fim e faz espuma onde bate na água. Usado na água de
// resfriamento do óleo da turbina (saída no espelho). Só lê a simulação (vazão vinda da telemetria).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, TransformNode, Vector3 } from "@babylonjs/core";
import type { Speedboat } from "../sim/boat.ts";
import { v3, rotateInv, type Vec3 } from "../sim/math.ts";
import { jetStreakLocal } from "../sim/bilgeJet.ts";
import type { IWaterSurface } from "../sim/water.ts";

const G = 9.81, N = 14;

export class WaterJet {
  readonly meshes: Mesh[] = [];
  private readonly root: TransformNode;
  private readonly stream: Mesh;
  private readonly drops: Mesh[] = [];
  private readonly foam: Mesh;
  private readonly path: Vector3[] = [];
  private readonly radius: number[] = [];
  private readonly outlet: Vec3;
  private readonly dir: Vec3;
  private readonly area: number;

  constructor(scene: Scene, root: TransformNode, prefix: string, outlet: Vec3, dir: Vec3, areaM2: number, fittingMat?: StandardMaterial) {
    this.root = root; this.outlet = outlet; this.dir = dir; this.area = areaM2;
    // bocal de inox da saída (virado para a direção do jato)
    const r = Math.sqrt(areaM2 / Math.PI);
    const fit = MeshBuilder.CreateCylinder(prefix + "Outlet", { height: 0.04, diameter: 2 * r + 0.03, tessellation: 16 }, scene);
    fit.parent = root; fit.position.set(outlet.x, outlet.y, outlet.z);
    const up = new Vector3(0, 1, 0), d = new Vector3(dir.x, dir.y, dir.z).normalize();
    const axis = Vector3.Cross(up, d), ang = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(up, d))));
    if (axis.length() > 1e-6) fit.rotationQuaternion = null, fit.rotate(axis.normalize(), ang);
    const steel = fittingMat ?? (() => { const m = new StandardMaterial(prefix + "OutletMat", scene); m.diffuseColor = new Color3(0.75, 0.77, 0.8); m.specularColor = new Color3(1, 1, 1); return m; })();
    fit.material = steel; fit.isPickable = false;
    const wm = new StandardMaterial(prefix + "Water", scene);
    wm.diffuseColor = new Color3(0.8, 0.9, 1); wm.emissiveColor = new Color3(0.25, 0.3, 0.35); wm.alpha = 0.7; wm.specularColor = new Color3(1, 1, 1);
    for (let i = 0; i < N; i++) { this.path.push(new Vector3(0, -i * 0.01, 0)); this.radius.push(0.01); }
    this.stream = MeshBuilder.CreateTube(prefix + "Jet", { path: this.path, radiusFunction: (i) => this.radius[i] ?? 0.01, tessellation: 10, cap: Mesh.CAP_ALL, updatable: true }, scene);
    this.stream.material = wm; this.stream.isPickable = false; this.stream.setEnabled(false);
    for (let i = 0; i < 14; i++) {
      const dm = MeshBuilder.CreateSphere(prefix + "Drop", { diameter: 1, segments: 6 }, scene);
      dm.material = wm; dm.isPickable = false; dm.setEnabled(false);
      this.drops.push(dm);
    }
    this.foam = MeshBuilder.CreateDisc(prefix + "Foam", { radius: 1, tessellation: 20 }, scene);
    this.foam.rotation.x = Math.PI / 2; this.foam.material = wm; this.foam.isPickable = false; this.foam.setEnabled(false);
    this.meshes.push(fit, this.stream, this.foam, ...this.drops);
  }

  /** `lps` = vazão (L/s) da telemetria; `active` = desenhar (no jogo). */
  update(boat: Speedboat, lps: number, time: number, active: boolean, water?: IWaterSurface): void {
    const Q = lps / 1000;
    const on = active && Q > 0.00005 && !!water;
    this.stream.setEnabled(on); this.foam.setEnabled(on);
    for (const d of this.drops) d.setEnabled(on);
    if (!on || !water) return;
    const vOut = Math.max(0.3, Q / this.area);
    const gL = rotateInv(boat.rot, v3(0, -G, 0));
    const airL = rotateInv(boat.rot, v3(-boat.vel.x, 0, -boat.vel.z)); // ar parado visto do barco
    const M = this.root.computeWorldMatrix(true);
    const DT = 0.01;
    const local = jetStreakLocal(this.outlet, 1, vOut, gL, airL, (q) => { const w = Vector3.TransformCoordinates(new Vector3(q.x, q.y, q.z), M); return w.y <= water.getHeight(w.x, w.z); }, DT, 1, 1.2, this.dir);
    const pts = local.map((q) => Vector3.TransformCoordinates(new Vector3(q.x, q.y, q.z), M));
    const tHit = Math.max(DT, (pts.length - 1) * DT);
    const at = (t: number) => {
      const f = Math.min(pts.length - 1, (t / tHit) * (pts.length - 1)), j = Math.floor(f), u = f - j;
      return Vector3.Lerp(pts[j], pts[Math.min(j + 1, pts.length - 1)], u);
    };
    // seção pela continuidade: afina conforme acelera na queda
    for (let i = 0; i < N; i++) {
      const t = (tHit * i) / (N - 1);
      this.path[i] = at(t);
      const vRel = Math.hypot(vOut, G * t);
      this.radius[i] = Math.min(0.03, Math.max(0.004, Math.sqrt(Q / (Math.PI * vRel)))) * (1 - 0.35 * (i / (N - 1)));
    }
    MeshBuilder.CreateTube("", { path: this.path, radiusFunction: (i) => this.radius[i] ?? 0.004, instance: this.stream });
    const hit = this.path[N - 1];
    this.drops.forEach((d, i) => {
      const u = (time * 1.7 + i / this.drops.length) % 1;
      if (i < 9) {
        const t = tHit * (0.35 + 0.65 * u), spread = 0.05 * u * u;
        d.position.copyFrom(at(t)).addInPlace(new Vector3(Math.sin(i * 7.3 + time * 13) * spread, Math.cos(i * 5.1 + time * 9) * spread, Math.cos(i * 3.1 + time * 11) * spread));
        d.scaling.setAll((0.012 + 0.012 * ((i * 37) % 10) / 10) * (0.6 + 0.6 * Math.min(1, Q / 0.002)));
      } else {
        const ph = (time * 3.3 + i * 0.37) % 1, a = (i * 2.4) % (Math.PI * 2), r = 0.05 + 0.14 * ph;
        d.position.set(hit.x + Math.cos(a) * r, hit.y + 0.2 * ph * (1 - ph) * 4 * Math.min(1, Q / 0.0015), hit.z + Math.sin(a) * r);
        d.scaling.setAll(0.016 * (1 - ph));
      }
    });
    this.foam.position.set(hit.x, water.getHeight(hit.x, hit.z) + 0.01, hit.z);
    this.foam.scaling.setAll(0.05 + 0.12 * Math.min(1, Q / 0.002) * (0.85 + 0.15 * Math.sin(time * 9)));
  }
}
