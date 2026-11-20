// Corda de reboque visível: um tubo fino (malha de verdade, não uma linha de 1 px) que engrossa com a distância da câmera
// para nunca sumir na tela (~2 px no mínimo), com barriga quando frouxa. Só visual.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3 } from "@babylonjs/core";

const N = 48; // (muitos pontos: a corda dobra macia na borda do píer, sem "quinas")

export class RopeTube {
  readonly mesh: Mesh;
  private readonly pts: Vector3[] = [];
  private readonly radii: number[] = [];
  private readonly scene: Scene;
  private readonly radius: number;

  /** `radius` = raio real da corda (m) */
  constructor(scene: Scene, name: string, color: Color3, radius = 0.012) {
    this.scene = scene; this.radius = radius;
    for (let i = 0; i < N; i++) { this.pts.push(new Vector3(0, i * 0.1, 0)); this.radii.push(radius); }
    this.mesh = MeshBuilder.CreateTube(name, { path: this.pts, radiusFunction: (i) => this.radii[i], tessellation: 10, updatable: true }, scene);
    const m = new StandardMaterial(name + "Mat", scene);
    m.diffuseColor = color; m.emissiveColor = color.scale(0.55); m.specularColor = new Color3(0.1, 0.1, 0.1);
    this.mesh.material = m; this.mesh.isPickable = false;
  }

  /** Barriga de uma corda de comprimento `ropeLen` entre pontos a `d` m: a folga vira flecha (aprox. de corda frouxa,
   *  2·√(L² − d²)/4), um resto pequeno quando esticada (`taut`). */
  static sagFor(ropeLen: number, d: number, tension: number, taut = 0.15): number {
    if (tension > 30) return taut;
    return Math.min(8, Math.max(taut, 0.5 * Math.sqrt(Math.max(0, ropeLen * ropeLen - d * d))));
  }

  /** de `a` a `b`; `sag` = barriga no meio (m); nenhum ponto abaixo de `minY` (a corda frouxa boia na água) nem de
   *  `floorAt(x, z)` (por exemplo o deck de um píer: a corda passa por cima, não por dentro) */
  update(a: Vector3, b: Vector3, sag: number, minY = -1e9, floorAt?: (x: number, z: number) => number): void {
    const cam = this.scene.activeCamera?.globalPosition;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const p = this.pts[i];
      Vector3.LerpToRef(a, b, t, p);
      p.y = Math.max(minY, p.y - sag * 4 * t * (1 - t));
      if (floorAt) p.y = Math.max(p.y, floorAt(p.x, p.z) + this.radius);
      // engrossa com a distância: ~0,0016 rad de largura aparente no mínimo (visível também de longe e em 1ª pessoa)
      const d = cam ? Vector3.Distance(cam, p) : 10;
      this.radii[i] = Math.max(this.radius, d * 0.0016);
    }
    MeshBuilder.CreateTube("rope", { path: this.pts, radiusFunction: (i) => this.radii[i], instance: this.mesh });
  }

  setEnabled(on: boolean): void { this.mesh.setEnabled(on); }
}

/** O "Y" de reboque no barco: dois braços dos olhais da popa até a argola (e as argolas de inox). Só visual. */
export class TowBridleVis {
  private readonly legs: RopeTube[];
  private readonly rings: Mesh[] = [];
  constructor(scene: Scene, name: string, color: Color3) {
    this.legs = [new RopeTube(scene, name + "Leg0", color, 0.01), new RopeTube(scene, name + "Leg1", color, 0.01)];
    const steel = new StandardMaterial(name + "Steel", scene); steel.diffuseColor = new Color3(0.8, 0.81, 0.84); steel.specularColor = new Color3(0.9, 0.9, 0.9);
    for (let k = 0; k < 3; k++) {
      const r = MeshBuilder.CreateTorus(name + "Ring" + k, { diameter: k === 2 ? 0.1 : 0.07, thickness: 0.015, tessellation: 14 }, scene);
      r.material = steel; r.isPickable = false; this.rings.push(r);
    }
  }
  /** `eyes` (mundo, 1 ou 2) e `apex` (argola, mundo); `on` = engatado */
  update(eyes: Vector3[], apex: Vector3, on: boolean): void {
    const two = on && eyes.length === 2;
    this.legs.forEach((l, k) => { l.setEnabled(two); if (two) l.update(eyes[k], apex, 0.02); });
    this.rings.forEach((r, k) => {
      const show = on && (k === 2 || two);
      r.setEnabled(show);
      if (show) r.position.copyFrom(k === 2 ? apex : eyes[k]);
    });
  }
}
