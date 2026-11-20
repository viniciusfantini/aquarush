// Corda de reboque visível: um tubo fino (malha de verdade, não uma linha de 1 px) que engrossa com a distância da câmera
// para nunca sumir na tela (~2 px no mínimo), com barriga quando frouxa. Só visual.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, Ray, type TransformNode } from "@babylonjs/core";
import type { SpeedboatParams } from "../sim/params.ts";
import type { Speedboat } from "../sim/boat.ts";
import { TowTube } from "../sim/towTube.ts";
import { type Vec3, v3, add, sub, scale, len, dot, normalize, rotateInv } from "../sim/math.ts";

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
  update(a: Vector3, b: Vector3, sag: number, minY = -1e9, floorAt?: (x: number, z: number) => number, push?: (p: Vector3) => void): void {
    const cam = this.scene.activeCamera?.globalPosition;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const p = this.pts[i];
      Vector3.LerpToRef(a, b, t, p);
      p.y = Math.max(minY, p.y - sag * 4 * t * (1 - t));
      if (floorAt) p.y = Math.max(p.y, floorAt(p.x, p.z) + this.radius);
      if (push && i > 0 && i < N - 1) push(p);
      // engrossa com a distância: ~0,0016 rad de largura aparente no mínimo (visível também de longe e em 1ª pessoa)
      const d = cam ? Vector3.Distance(cam, p) : 10;
      this.radii[i] = Math.max(this.radius, d * 0.0016);
    }
    MeshBuilder.CreateTube("rope", { path: this.pts, radiusFunction: (i) => this.radii[i], instance: this.mesh });
  }

  /** curva suave de `a` a `b` com ponto de controle `c` (Bézier quadrática); nenhum ponto abaixo de `minY` */
  updateCurve(a: Vector3, c: Vector3, b: Vector3, minY = -1e9): void {
    const cam = this.scene.activeCamera?.globalPosition;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), u = 1 - t, p = this.pts[i];
      p.set(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y, u * u * a.z + 2 * u * t * c.z + t * t * b.z);
      if (p.y < minY) p.y = minY;
      const d = cam ? Vector3.Distance(cam, p) : 10;
      this.radii[i] = Math.max(this.radius, d * 0.0016);
    }
    MeshBuilder.CreateTube("rope", { path: this.pts, radiusFunction: (i) => this.radii[i], instance: this.mesh });
  }

  setEnabled(on: boolean): void { this.mesh.setEnabled(on); }
}

/**
 * OLHAIS DE REBOQUE fixos no barco (sempre à vista, engatado ou não): um "U" de inox sobre uma chapinha em cada canto da
 * popa (ou o gancho único da moto aquática), nas posições do parâmetro `tow`. Filhos do `root` do visual (local = sim).
 */
export const buildTowEyes = (scene: Scene, root: TransformNode, P: SpeedboatParams, name: string, hull: Mesh[] = []): Mesh[] => {
  const T = P.tow;
  if (!T) return [];
  const steel = new StandardMaterial(name + "EyeSteel", scene); steel.diffuseColor = new Color3(0.82, 0.83, 0.86); steel.specularColor = new Color3(1, 1, 1); steel.specularPower = 96;
  const pts = T.leg > 0 && T.eyeX > 0 ? [-T.eyeX, T.eyeX] : [0];
  const out: Mesh[] = [];
  // assenta o olhal na superfície de verdade do casco: raio de cima para baixo na malha do barco (local do root)
  root.computeWorldMatrix(true);
  const W = root.getWorldMatrix(), inv = W.clone().invert();
  const surfaceY = (x: number, z: number): number => {
    const o = Vector3.TransformCoordinates(new Vector3(x, T.eyeY + 1.2, z), W);
    const d = Vector3.TransformNormal(new Vector3(0, -1, 0), W).normalize();
    const ray = new Ray(o, d, 2.5);
    let best = Infinity, hitY = T.eyeY;
    for (const m of hull) {
      if (!m.getTotalVertices()) continue;
      m.computeWorldMatrix(true);
      const pi = ray.intersectsMesh(m, false);
      if (pi.hit && pi.distance < best && pi.pickedPoint) { best = pi.distance; hitY = Vector3.TransformCoordinates(pi.pickedPoint, inv).y; }
    }
    return best < Infinity && Math.abs(hitY - T.eyeY) < 0.6 ? hitY : T.eyeY;
  };
  for (const x of pts) {
    const y = surfaceY(x, T.eyeZ);
    // "U" (meia-volta) voltado para trás, e a chapinha de base
    const path: Vector3[] = [];
    for (let i = 0; i <= 16; i++) { const a = Math.PI * (i / 16); path.push(new Vector3(Math.cos(a) * 0.045, Math.sin(a) * 0.05, 0)); }
    const u = MeshBuilder.CreateTube(name + "Eye", { path, radius: 0.011, tessellation: 8 }, scene);
    u.material = steel; u.parent = root; u.position.set(x, y, T.eyeZ);
    u.rotation.x = -0.6; // em pé, inclinado para trás (a corda sai para a popa)
    const plate = MeshBuilder.CreateBox(name + "EyePlate", { width: 0.13, height: 0.012, depth: 0.07 }, scene);
    plate.material = steel; plate.parent = root; plate.position.set(x, y + 0.004, T.eyeZ + 0.01);
    out.push(u, plate);
  }
  for (const m of out) m.isPickable = false;
  return out;
};

/** caixa de exclusão (local do barco): motor de popa / rabeta / hélice — a argola e os braços passam por fora */
interface KeepOut { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
const keepOuts = (b: Speedboat): KeepOut[] => {
  const P = b.params;
  if (P.airProp || P.waterjet) return [];
  const xs = P.engines ? P.engines.map((e) => e.x) : [0];
  const z0 = Math.min(P.propPos.z, P.drivePivot.z) - 0.3, z1 = Math.max(P.propPos.z, P.drivePivot.z) + 0.45;
  const y0 = Math.min(P.propPos.y, P.drivePivot.y) - 0.4, y1 = Math.max(P.propPos.y, P.drivePivot.y) + 0.95;
  return xs.map((x) => ({ x0: x - 0.36, x1: x + 0.36, y0, y1, z0, z1 }));
};
/** empurra `p` (local) para fora das caixas: pelo lado (x) ou por trás (z), o que for mais perto */
const pushOut = (p: Vec3, boxes: KeepOut[], m = 0.04): Vec3 => {
  let q = p;
  for (const k of boxes) {
    if (q.x <= k.x0 || q.x >= k.x1 || q.y <= k.y0 || q.y >= k.y1 || q.z <= k.z0 || q.z >= k.z1) continue;
    const dl = q.x - k.x0, dr = k.x1 - q.x, db = q.z - k.z0;
    if (db <= dl && db <= dr) q = v3(q.x, q.y, k.z0 - m);
    else if (dl < dr) q = v3(k.x0 - m, q.y, q.z);
    else q = v3(k.x1 + m, q.y, q.z);
  }
  return q;
};
const toV = (a: Vec3) => new Vector3(a.x, a.y, a.z);
const toS = (a: Vector3) => v3(a.x, a.y, a.z);

/**
 * O "Y" de reboque no barco, com movimento (v0.76.2: simulado no REFERENCIAL DO BARCO — o barco andando não "sacode" a
 * argola — e com a barriga dos braços contínua). A ARGOLA é uma pequena massa (gravidade, amortecimento) presa aos dois
 * olhais por braços que só esticam (`leg`). Frouxa, cai e balança até a água; esticada, vai para onde a corda puxa (reto:
 * os dois braços tensos; de lado: o desse lado tenso e o outro com barriga). Argola e braços contornam o motor/rabeta.
 * Só visual — a força no barco é a da sim (`TowTube.applyTow`).
 */
export class TowBridleVis {
  private readonly legs: RopeTube[];
  private readonly rings: Mesh[] = [];
  private ring: Vec3 = v3();   // local do barco
  private prev: Vec3 = v3();
  private boat: Speedboat | null = null;
  constructor(scene: Scene, name: string, color: Color3) {
    this.legs = [new RopeTube(scene, name + "Leg0", color, 0.01), new RopeTube(scene, name + "Leg1", color, 0.01)];
    const steel = new StandardMaterial(name + "Steel", scene); steel.diffuseColor = new Color3(0.8, 0.81, 0.84); steel.specularColor = new Color3(0.9, 0.9, 0.9);
    for (let k = 0; k < 3; k++) {
      const r = MeshBuilder.CreateTorus(name + "Ring" + k, { diameter: k === 2 ? 0.1 : 0.07, thickness: 0.015, tessellation: 14 }, scene);
      r.material = steel; r.isPickable = false; this.rings.push(r);
    }
  }

  /** ponto mais à frente na direção `dir` que a argola alcança com braços de `L` presos em `e1` e `e2` */
  private static reach(e1: Vec3, e2: Vec3, L: number, dir: Vec3): Vec3 {
    const cands: Vec3[] = [];
    for (const [a, o] of [[e1, e2], [e2, e1]] as const) { const c = add(a, scale(dir, L)); if (len(sub(c, o)) <= L + 1e-3) cands.push(c); }
    const half = len(sub(e1, e2)) / 2;
    if (half < L) {
      const m = scale(add(e1, e2), 0.5), n = normalize(sub(e2, e1));
      let t = sub(dir, scale(n, dot(dir, n)));
      if (len(t) < 1e-3) t = v3(0, 1, 0);
      cands.push(add(m, scale(normalize(t), Math.sqrt(L * L - half * half))));
    }
    let best = cands[0] ?? scale(add(e1, e2), 0.5);
    for (const c of cands) if (dot(c, dir) > dot(best, dir)) best = c;
    return best;
  }

  /**
   * `b` = barco que reboca (null = solto), `pullTo` = para onde a corda vai (mundo), `tension` (N), `floorY` = água
   * (a argola não afunda), `dt` (s). Devolve a posição da argola no mundo (de onde sai a corda).
   */
  update(b: Speedboat | null, pullTo?: Vector3, tension = 0, floorY = -1e9, dt = 1 / 60): Vector3 {
    if (!b) { this.boat = null; this.legs.forEach((l) => l.setEnabled(false)); this.rings.forEach((r) => r.setEnabled(false)); return Vector3.Zero(); }
    const eyesL = TowTube.towEyes(b), apexL = TowTube.towLocal(b), T = b.params.tow;
    const leg = T?.leg ?? 0;
    if (eyesL.length < 2 || leg <= 0) {
      this.legs.forEach((l) => l.setEnabled(false));
      const a = toV(b.toWorld(apexL));
      this.rings.forEach((r, k) => { r.setEnabled(k === 2); if (k === 2) r.position.copyFrom(a); });
      return a;
    }
    if (this.boat !== b) { this.ring = apexL; this.prev = apexL; this.boat = b; }
    const boxes = keepOuts(b);
    const h = Math.min(0.05, Math.max(1e-3, dt));
    const toLocal = (w: Vec3) => rotateInv(b.rot, sub(w, b.pos));
    // Verlet no referencial do barco: gravidade (girada para o barco) e amortecimento forte (corda molhada)
    const g = rotateInv(b.rot, v3(0, -9.81, 0));
    const vel = scale(sub(this.ring, this.prev), 0.9);
    this.prev = this.ring;
    this.ring = add(add(this.ring, vel), scale(g, h * h));
    // corda puxando: mola para o ponto mais à frente que a argola alcança na direção da corda
    if (pullTo && tension > 20) {
      const dirL = normalize(rotateInv(b.rot, sub(toS(pullTo), b.toWorld(this.ring))));
      const target = TowBridleVis.reach(eyesL[0], eyesL[1], leg, dirL);
      const k = 1 - Math.exp(-h * (5 + Math.min(20, tension / 80)));
      this.ring = add(this.ring, scale(sub(target, this.ring), k));
    }
    // braços que só esticam + fora do motor
    for (let it = 0; it < 4; it++) {
      for (const e of eyesL) { const d = sub(this.ring, e), n = len(d); if (n > leg) this.ring = add(e, scale(d, leg / n)); }
      this.ring = pushOut(this.ring, boxes);
    }
    // não afunda (para na água)
    const rw = b.toWorld(this.ring);
    if (rw.y < floorY) { this.ring = toLocal(v3(rw.x, floorY, rw.z)); this.prev = this.ring; }
    // desenho: cada braço é uma curva suave (Bézier) do olhal à argola; a barriga vem da folga dele e, se a curva
    // passar pelo motor, o ponto de controle vai para fora (pelo lado do olhal) até ela contornar — sem quinas
    const ringW = toV(b.toWorld(this.ring));
    const inside = (q: Vec3) => boxes.some((k) => q.x > k.x0 && q.x < k.x1 && q.y > k.y0 && q.y < k.y1 && q.z > k.z0 && q.z < k.z1);
    this.legs.forEach((l, k) => {
      l.setEnabled(true);
      const e = eyesL[k], d = len(sub(e, this.ring));
      const sag = 0.5 * Math.sqrt(Math.max(0, leg * leg - d * d));
      let c = add(scale(add(e, this.ring), 0.5), scale(rotateInv(b.rot, v3(0, -1, 0)), 2 * sag));
      for (let it = 0; it < 12; it++) {
        let hit = false;
        for (let j = 1; j < 10 && !hit; j++) {
          const t = j / 10, u = 1 - t;
          hit = inside(add(add(scale(e, u * u), scale(c, 2 * u * t)), scale(this.ring, t * t)));
        }
        if (!hit) break;
        c = v3(c.x + Math.sign(e.x || 1) * 0.12, c.y, c.z - 0.06); // para fora, pelo lado do olhal, e um pouco para trás
      }
      l.updateCurve(toV(b.toWorld(e)), toV(b.toWorld(c)), ringW, floorY);
    });
    this.rings.forEach((r, k) => { r.setEnabled(k === 2); if (k === 2) r.position.copyFrom(ringW); }); // (os olhais são fixos no barco)
    return ringW;
  }
}
