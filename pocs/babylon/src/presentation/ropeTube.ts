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

/**
 * O "Y" de reboque no barco, com movimento: a ARGOLA é uma pequena massa (gravidade, amortecimento) presa aos dois olhais
 * por braços que só esticam (comprimento `leg`). Frouxa, ela cai e balança (pendurada, ou apoiada na água/deck); esticada,
 * vai para onde a corda puxa: reto, os dois braços tensos; de lado, o braço desse lado tenso e o outro com barriga.
 * Só visual — a força no barco é a da sim (`TowTube.applyTow`).
 */
export class TowBridleVis {
  private readonly legs: RopeTube[];
  private readonly rings: Mesh[] = [];
  private ring = new Vector3();
  private prev = new Vector3();
  private init = false;
  constructor(scene: Scene, name: string, color: Color3) {
    this.legs = [new RopeTube(scene, name + "Leg0", color, 0.01), new RopeTube(scene, name + "Leg1", color, 0.01)];
    const steel = new StandardMaterial(name + "Steel", scene); steel.diffuseColor = new Color3(0.8, 0.81, 0.84); steel.specularColor = new Color3(0.9, 0.9, 0.9);
    for (let k = 0; k < 3; k++) {
      const r = MeshBuilder.CreateTorus(name + "Ring" + k, { diameter: k === 2 ? 0.1 : 0.07, thickness: 0.015, tessellation: 14 }, scene);
      r.material = steel; r.isPickable = false; this.rings.push(r);
    }
  }

  /** ponto mais à frente na direção `dir` que a argola alcança com braços de `L` presos em `e1` e `e2` */
  private static reach(e1: Vector3, e2: Vector3, L: number, dir: Vector3): Vector3 {
    const cands: Vector3[] = [];
    for (const [a, o] of [[e1, e2], [e2, e1]] as const) { const c = a.add(dir.scale(L)); if (Vector3.Distance(c, o) <= L + 1e-3) cands.push(c); }
    const half = Vector3.Distance(e1, e2) / 2;
    if (half < L) {
      const m = Vector3.Center(e1, e2), n = e2.subtract(e1).normalize();
      let t = dir.subtract(n.scale(Vector3.Dot(dir, n)));
      if (t.lengthSquared() < 1e-6) t = Vector3.Up();
      cands.push(m.add(t.normalize().scale(Math.sqrt(L * L - half * half))));
    }
    let best = cands[0] ?? Vector3.Center(e1, e2);
    for (const c of cands) if (Vector3.Dot(c, dir) > Vector3.Dot(best, dir)) best = c;
    return best;
  }

  /**
   * `eyes` (mundo, 1 ou 2), `apex` (argola de repouso, mundo), `leg` (m), `pullTo` (para onde a corda vai), `tension`
   * (N), `floorY` (água/deck: a argola não afunda), `dt` (s). Devolve a posição atual da argola (de onde sai a corda).
   */
  update(eyes: Vector3[], apex: Vector3, on: boolean, leg = 0, pullTo?: Vector3, tension = 0, floorY = -1e9, dt = 1 / 60): Vector3 {
    const two = on && eyes.length === 2 && leg > 0;
    if (!two) {
      this.init = false;
      this.legs.forEach((l) => l.setEnabled(false));
      this.rings.forEach((r, k) => { const show = on && k === 2; r.setEnabled(show); if (show) r.position.copyFrom(apex); });
      return apex.clone();
    }
    if (!this.init) { this.ring.copyFrom(apex); this.prev.copyFrom(apex); this.init = true; }
    const h = Math.min(0.05, Math.max(1e-3, dt));
    // integração (Verlet): gravidade e amortecimento — o barco arrasta a argola pelos braços
    const vel = this.ring.subtract(this.prev).scale(0.985);
    this.prev.copyFrom(this.ring);
    this.ring.addInPlace(vel).addInPlace(new Vector3(0, -9.81 * h * h, 0));
    // corda puxando: a argola vai (com mola) para o ponto mais à frente que alcança na direção da corda
    if (pullTo && tension > 20) {
      const dir = pullTo.subtract(this.ring).normalize();
      const target = TowBridleVis.reach(eyes[0], eyes[1], leg, dir);
      const k = 1 - Math.exp(-h * (6 + Math.min(30, tension / 60)));
      this.ring.addInPlace(target.subtract(this.ring).scale(k));
    }
    // braços: só esticam (restrição de comprimento máximo), algumas iterações
    for (let it = 0; it < 4; it++) for (const e of eyes) {
      const d = this.ring.subtract(e), n = d.length();
      if (n > leg) this.ring = e.add(d.scale(leg / n));
    }
    if (this.ring.y < floorY) { this.ring.y = floorY; this.prev.y = Math.min(this.prev.y, floorY); }
    // desenho: braço tenso reto; frouxo com a barriga da folga
    this.legs.forEach((l, k) => {
      l.setEnabled(true);
      const d = Vector3.Distance(eyes[k], this.ring);
      l.update(eyes[k], this.ring, RopeTube.sagFor(leg, d, d > leg * 0.985 ? 100 : 0, 0.01), floorY);
    });
    this.rings.forEach((r, k) => { r.setEnabled(true); r.position.copyFrom(k === 2 ? this.ring : eyes[k]); });
    return this.ring.clone();
  }
}
