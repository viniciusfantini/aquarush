// Visual da LANCHA DE WAKEBOARD AR-8 (v0.77): o casco da AR-6 (boatMesh.ts) sem o motor de popa — motor de centro com
// hélice sob o casco e leme atrás dela —, torre TARGA com a argola de reboque no alto (o ponto `tow` da física),
// plataforma de banho e as saídas d'água do lastro no costado. Só visual; lê a física (pivô do leme = `engine`).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode } from "@babylonjs/core";
import { buildBoat, type BoatVisual } from "./boatMesh.ts";
import { WAKEBOAT } from "../sim/params.ts";

export const buildWakeboat = (scene: Scene): BoatVisual => {
  const v = buildBoat(scene);
  const P = WAKEBOAT;
  // ---- tira o motor de popa: tudo que pendura no pivô, menos a hélice (que vai para baixo do casco) ----
  const keep = new Set<Mesh>();
  for (const m of v.propeller.getChildMeshes(false)) keep.add(m as Mesh);
  for (const m of v.engine.getChildMeshes(false)) if (!keep.has(m as Mesh)) { m.dispose(); }
  const alive = v.meshes.filter((m) => !m.isDisposed());
  v.meshes.length = 0; v.meshes.push(...alive);
  // hélice fixa sob o casco (eixo do motor de centro)
  v.propeller.setParent(v.root);
  v.propeller.position.set(P.propPos.x, P.propPos.y, P.propPos.z);
  v.propeller.rotationQuaternion = null; v.propeller.rotation.set(0.12, 0, 0); // eixo levemente inclinado
  // o pivô do motor vira o pivô do LEME (gira com a direção, como o motor girava)
  v.engine.position.set(P.drivePivot.x, P.drivePivot.y, P.drivePivot.z);
  v.telltale.setParent(v.root); v.telltale.position.set(1.12, 0.05, -2.4); // saída do escape/arrefecimento no costado
  const black = new StandardMaterial("wbBlack", scene); black.diffuseColor = new Color3(0.07, 0.07, 0.08); black.specularColor = new Color3(0.3, 0.3, 0.3);
  const steel = new StandardMaterial("wbSteel", scene); steel.diffuseColor = new Color3(0.78, 0.79, 0.82); steel.specularColor = new Color3(0.9, 0.9, 0.9); steel.specularPower = 80;
  const tower = new StandardMaterial("wbTower", scene); tower.diffuseColor = new Color3(0.12, 0.13, 0.15); tower.specularColor = new Color3(0.5, 0.5, 0.55); tower.specularPower = 60;
  const deckMat = new StandardMaterial("wbDeck", scene); deckMat.diffuseColor = new Color3(0.32, 0.33, 0.35); deckMat.specularColor = new Color3(0.05, 0.05, 0.05);
  const add = (m: Mesh, mat: StandardMaterial, parent: TransformNode = v.root) => { m.material = mat; m.parent = parent; m.isPickable = false; v.meshes.push(m); return m; };
  // leme (lâmina) e o eixo/suporte da hélice
  const rudder = add(MeshBuilder.CreateBox("skeg", { width: 0.025, height: 0.42, depth: 0.26 }, scene), steel, v.engine);
  rudder.position.set(0, -0.18, -0.1);
  const shaft = add(MeshBuilder.CreateCylinder("wbShaft", { height: 1.3, diameter: 0.045, tessellation: 10 }, scene), steel);
  shaft.rotation.x = Math.PI / 2 - 0.12; shaft.position.set(0, P.propPos.y + 0.08, P.propPos.z + 0.62);
  const strut = add(MeshBuilder.CreateBox("wbStrut", { width: 0.03, height: 0.26, depth: 0.12 }, scene), steel);
  strut.position.set(0, P.propPos.y + 0.17, P.propPos.z + 0.22);
  // ---- torre TARGA: dois pés no costado, arco por cima do cockpit e a argola de reboque no alto ----
  const tz = P.tow!.eyeZ + 0.1, top = P.tow!.eyeY + 0.05, half = 1.02;
  const arch: Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, a = Math.PI * t; // de BB a BE
    const x = -half * Math.cos(a), y = 0.42 + (top - 0.42) * Math.pow(Math.sin(a), 0.35);
    arch.push(new Vector3(x, y, tz - 0.35 * Math.sin(a))); // inclinada para trás no alto
  }
  add(MeshBuilder.CreateTube("wbTargaA", { path: arch, radius: 0.045, tessellation: 12 }, scene), tower);
  add(MeshBuilder.CreateTube("wbTargaB", { path: arch.map((p) => new Vector3(p.x, p.y, p.z + 0.32)), radius: 0.04, tessellation: 12 }, scene), tower);
  for (let k = 1; k < 24; k += 4) { // travessas entre os dois arcos
    const a = arch[k], b = new Vector3(a.x, a.y, a.z + 0.32);
    const c = add(MeshBuilder.CreateTube("wbTargaX", { path: [a, b], radius: 0.02, tessellation: 8 }, scene), tower); void c;
  }
  // caixas de som e luz no alto da torre
  for (const sx of [-1, 1]) {
    const spk = add(MeshBuilder.CreateCylinder("wbSpeaker", { height: 0.28, diameter: 0.2, tessellation: 18 }, scene), black);
    spk.rotation.x = Math.PI / 2 + 0.2; spk.position.set(sx * 0.55, top - 0.18, tz - 0.25);
  }
  // pilone de reboque (argola) no alto, atrás: o `buildTowEyes` assenta o olhal aqui
  const pylon = add(MeshBuilder.CreateBox("wbPylon", { width: 0.16, height: 0.12, depth: 0.16 }, scene), steel);
  pylon.position.set(0, top - 0.02, P.tow!.eyeZ + 0.06);
  // ---- plataforma de banho larga ----
  const plat = add(MeshBuilder.CreateBox("wbSwimPlatform", { width: 2.0, height: 0.06, depth: 0.75 }, scene), deckMat);
  plat.position.set(0, 0.12, -3.38);
  for (const sx of [-0.7, 0.7]) add(MeshBuilder.CreateBox("wbPlatBracket", { width: 0.06, height: 0.22, depth: 0.5 }, scene), steel).position.set(sx, 0.03, -3.25);
  // ---- saídas d'água do lastro (costado) ----
  for (const sx of [-1, 1]) {
    const o = add(MeshBuilder.CreateCylinder("wbBallastOut", { height: 0.02, diameter: 0.07, tessellation: 14 }, scene), black);
    o.rotation.z = Math.PI / 2; o.position.set(sx * 1.13, 0.0, -1.7);
  }
  return v;
};
