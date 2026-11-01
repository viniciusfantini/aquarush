// Visual das amarrações: poitas (boias com número), vaga marcada no píer (cunhos, defensas, placa) e os
// cabos desenhados entre o barco e as âncoras (inclusive a cinta do guincho da carretinha).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, type LinesMesh, Color4 } from "@babylonjs/core";
import { BUOYS, CHANNEL_MARKERS, CANYON_END, pierBerth } from "../sim/mooring.ts";
import { groundHeight } from "../sim/world.ts";
import type { PierLayout } from "../sim/world.ts";
import type { Speedboat } from "../sim/boat.ts";
import { signMat } from "./station.ts";

export const buildMoorings = (scene: Scene, pier: PierLayout): { meshes: Mesh[]; buoys: Mesh[] } => {
  const meshes: Mesh[] = [], buoys: Mesh[] = [];
  const white = new StandardMaterial("poitaWhite", scene); white.diffuseColor = new Color3(0.95, 0.95, 0.93);
  const orange = new StandardMaterial("poitaOrange", scene); orange.diffuseColor = new Color3(0.95, 0.4, 0.05); orange.emissiveColor = new Color3(0.15, 0.04, 0);
  const steel = new StandardMaterial("cleatSteel", scene); steel.diffuseColor = new Color3(0.75, 0.76, 0.78); steel.specularColor = new Color3(0.8, 0.8, 0.8);
  const rubber = new StandardMaterial("fender", scene); rubber.diffuseColor = new Color3(0.08, 0.08, 0.09);
  for (const b of BUOYS) {
    const ball = MeshBuilder.CreateSphere("poita_" + b.id, { diameter: 0.7, segments: 12 }, scene);
    ball.material = white; ball.position.set(b.x, 0.1, b.z);
    const band = MeshBuilder.CreateCylinder("poitaBand", { height: 0.18, diameter: 0.72, tessellation: 16 }, scene);
    band.material = orange; band.parent = ball; band.position.y = 0.05;
    const ring = MeshBuilder.CreateTorus("poitaRing", { diameter: 0.18, thickness: 0.03, tessellation: 12 }, scene);
    ring.material = steel; ring.parent = ball; ring.position.y = 0.38; ring.rotation.x = Math.PI / 2;
    const tag = MeshBuilder.CreatePlane("poitaTag", { width: 0.5, height: 0.32, sideOrientation: Mesh.DOUBLESIDE }, scene);
    tag.material = signMat(scene, "poitaTagT" + b.id, b.id, "", "#e8590c", "#ffffff", 256, 160); tag.parent = ball; tag.position.y = 0.62;
    tag.billboardMode = Mesh.BILLBOARDMODE_Y;
    buoys.push(ball);
    meshes.push(ball, band, ring, tag);
  }
  // balizamento do canal do cânion (mesma ordem do BuoyField: poitas e depois as laterais)
  const redM = new StandardMaterial("markRed", scene); redM.diffuseColor = new Color3(0.85, 0.08, 0.06); redM.emissiveColor = new Color3(0.18, 0.01, 0);
  const greenM = new StandardMaterial("markGreen", scene); greenM.diffuseColor = new Color3(0.05, 0.6, 0.2); greenM.emissiveColor = new Color3(0, 0.12, 0.03);
  for (const mk of CHANNEL_MARKERS) {
    const red = mk.kind === "red";
    // vermelha = "lata" (cilindro de topo plano); verde = "cone" — formatos de boia lateral
    const body = red
      ? MeshBuilder.CreateCylinder("mark_" + mk.id, { height: 1.0, diameter: 0.6, tessellation: 16 }, scene)
      : MeshBuilder.CreateCylinder("mark_" + mk.id, { height: 1.1, diameterTop: 0.04, diameterBottom: 0.75, tessellation: 16 }, scene);
    body.material = red ? redM : greenM;
    const top = red
      ? MeshBuilder.CreateBox("markTop", { width: 0.36, height: 0.36, depth: 0.05 }, scene)
      : MeshBuilder.CreateCylinder("markTop", { height: 0.3, diameterTop: 0, diameterBottom: 0.34, tessellation: 12 }, scene);
    top.material = red ? redM : greenM; top.parent = body; top.position.y = red ? 0.82 : 0.78;
    const pole = MeshBuilder.CreateCylinder("markPole", { height: 0.4, diameter: 0.04 }, scene); pole.material = steel; pole.parent = body; pole.position.y = 0.6;
    const band = MeshBuilder.CreateCylinder("markBand", { height: 0.08, diameter: red ? 0.62 : 0.5, tessellation: 16 }, scene); band.material = white; band.parent = body; band.position.y = red ? 0.2 : -0.1;
    buoys.push(body);
    meshes.push(body, top, pole, band);
  }
  // pórtico de LARGADA no fim do cânion (onde o jogo começa de verdade)
  {
    const g = CANYON_END;
    const startM = signMat(scene, "startGateT", "LARGADA", "fim do cânion · início da corrida", "#0b2a4a", "#ffd34d", 1024, 200);
    for (const sx of [-1, 1]) {
      const px = g.x + sx * 16, gy = Math.max(groundHeight(px, g.z), -3.5);
      const tower = MeshBuilder.CreateBox("startTower", { width: 0.8, height: 9 - gy, depth: 0.8 }, scene);
      tower.material = orange; tower.position.set(px, (9 + gy) / 2, g.z); meshes.push(tower);
    }
    const banner = MeshBuilder.CreatePlane("startBanner", { width: 26, height: 2.4, sideOrientation: Mesh.DOUBLESIDE }, scene);
    banner.material = startM; banner.position.set(g.x, 8.2, g.z); meshes.push(banner); // de frente para quem sobe o rio (−Z)
  }
  // vaga no píer: faixa pintada no deck, placa, 2 cunhos e defensas (pneus) no costado
  const B = pierBerth(pier);
  const yellow = new StandardMaterial("berthPaint", scene); yellow.diffuseColor = new Color3(0.95, 0.78, 0.15); yellow.specularColor = Color3.Black();
  const stripe = MeshBuilder.CreateBox("berthStripe", { width: 0.25, height: 0.02, depth: B.len }, scene);
  stripe.material = yellow; stripe.position.set(B.edgeX - 0.2, B.deckY + 0.01, B.z); meshes.push(stripe);
  for (const dz of [-B.len / 2, B.len / 2]) { const t = MeshBuilder.CreateBox("berthTick", { width: 1.2, height: 0.02, depth: 0.2 }, scene); t.material = yellow; t.position.set(B.edgeX - 0.7, B.deckY + 0.01, B.z + dz); meshes.push(t); }
  const sign = MeshBuilder.CreatePlane("berthSign", { width: 1.4, height: 0.5 }, scene); // de frente para a água (+X)
  sign.material = signMat(scene, "berthSignT", "VAGA", "atracação", "#0d4f8b"); sign.position.set(B.edgeX - 0.22, B.deckY + 0.9, B.z); sign.rotation.y = -Math.PI / 2; meshes.push(sign);
  const post = MeshBuilder.CreateCylinder("berthSignPost", { height: 0.9, diameter: 0.05 }, scene); post.material = steel; post.position.set(B.edgeX - 0.25, B.deckY + 0.45, B.z); meshes.push(post);
  for (const dz of [-3, 3]) {
    const cleat = MeshBuilder.CreateCapsule("pierCleat", { radius: 0.035, height: 0.3, orientation: new Vector3(0, 0, 1) }, scene);
    cleat.material = steel; cleat.position.set(B.edgeX - 0.15, B.deckY + 0.06, B.z + dz); meshes.push(cleat);
  }
  for (const dz of [-3.5, -1.2, 1.2, 3.5]) {
    const f = MeshBuilder.CreateTorus("pierFender", { diameter: 0.55, thickness: 0.18, tessellation: 14 }, scene);
    f.material = rubber; f.rotation.z = Math.PI / 2; f.position.set(B.edgeX + 0.08, B.deckY - 0.45, B.z + dz); meshes.push(f);
  }
  for (const m of meshes) m.isPickable = false;
  return { meshes, buoys };
};

/** Cabos (até 3): atualizados a cada quadro a partir dos cabos da física. */
export class Ropes {
  private lines: LinesMesh[] = [];
  private readonly scene: Scene;
  constructor(scene: Scene) { this.scene = scene; }
  update(boat: Speedboat): void {
    const segs: { a: Vector3; b: Vector3 }[] = [];
    const all = [...(boat.winchStrap ? [boat.winchStrap] : []), ...boat.mooringLines];
    for (const l of all) { const w = boat.toWorld(l.local); segs.push({ a: new Vector3(w.x, w.y, w.z), b: new Vector3(l.anchor.x, l.anchor.y, l.anchor.z) }); }
    while (this.lines.length < segs.length) {
      const i = this.lines.length;
      const lm = MeshBuilder.CreateLines("rope" + i, { points: [Vector3.Zero(), Vector3.Up()], updatable: true, colors: [new Color4(0.92, 0.88, 0.7, 1), new Color4(0.92, 0.88, 0.7, 1)] }, this.scene);
      lm.isPickable = false;
      this.lines.push(lm);
    }
    this.lines.forEach((lm, i) => {
      const s = segs[i];
      lm.setEnabled(!!s);
      if (!s) return;
      // leve barriga do cabo (3 pontos não cabem num LinesMesh de 2 — basta a reta)
      MeshBuilder.CreateLines("rope" + i, { points: [s.a, s.b], instance: lm });
    });
  }
}
