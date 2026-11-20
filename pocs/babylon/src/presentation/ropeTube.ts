// Corda de reboque visível: um tubo fino (malha de verdade, não uma linha de 1 px) que engrossa com a distância da câmera
// para nunca sumir na tela (~2 px no mínimo), com barriga quando frouxa. Só visual.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3 } from "@babylonjs/core";

const N = 14;

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
    this.mesh = MeshBuilder.CreateTube(name, { path: this.pts, radiusFunction: (i) => this.radii[i], tessellation: 6, updatable: true }, scene);
    const m = new StandardMaterial(name + "Mat", scene);
    m.diffuseColor = color; m.emissiveColor = color.scale(0.55); m.specularColor = new Color3(0.1, 0.1, 0.1);
    this.mesh.material = m; this.mesh.isPickable = false;
  }

  /** de `a` a `b`; `sag` = barriga no meio (m); nenhum ponto abaixo de `minY` (a corda frouxa boia na água) */
  update(a: Vector3, b: Vector3, sag: number, minY = -1e9): void {
    const cam = this.scene.activeCamera?.globalPosition;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const p = this.pts[i];
      Vector3.LerpToRef(a, b, t, p);
      p.y = Math.max(minY, p.y - sag * 4 * t * (1 - t));
      // engrossa com a distância: ~0,0016 rad de largura aparente no mínimo (visível também de longe e em 1ª pessoa)
      const d = cam ? Vector3.Distance(cam, p) : 10;
      this.radii[i] = Math.max(this.radius, d * 0.0016);
    }
    MeshBuilder.CreateTube("rope", { path: this.pts, radiusFunction: (i) => this.radii[i], instance: this.mesh });
  }

  setEnabled(on: boolean): void { this.mesh.setEnabled(on); }
}
