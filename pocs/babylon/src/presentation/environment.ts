// Cenário PrototypeLake: relevo, margens, rochas, vegetação simples, píer e cabana da marina.
// Gerado a partir das MESMAS funções de sim/world.ts (o que se vê é o que colide).

import {
  type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, VertexBuffer, VertexData, Matrix, Quaternion, Vector3,
  DynamicTexture, Texture,
} from "@babylonjs/core";
import { groundHeight, rng, slopeAt, fbm, RIVER, riverCenterX, onRoadOrLot, ROAD, type SphereCollider, type PierLayout } from "../sim/world.ts";
import { signMat } from "./station.ts";
import { clamp, smoothstep } from "../sim/math.ts";

export interface EnvQuality { terrainSubdiv: number; trees: number }

const noiseTexture = (scene: Scene, name: string, base: [number, number, number], vari: number, size = 256): DynamicTexture => {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const rand = rng(name.length * 977);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0;
    const n = 0.55 * (fbm(x / 9, y / 9, 3) * 0.5 + 0.5) + 0.45 * rand();
    const k = 1 - vari + vari * 2 * n;
    img.data[i * 4] = clamp(base[0] * k, 0, 255);
    img.data[i * 4 + 1] = clamp(base[1] * k, 0, 255);
    img.data[i * 4 + 2] = clamp(base[2] * k, 0, 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
};

export const buildTerrain = (scene: Scene, q: EnvQuality): Mesh => {
  const size = 2600;
  const ground = MeshBuilder.CreateGround("terrain", { width: size, height: size, subdivisions: q.terrainSubdiv, updatable: true }, scene);
  const pos = ground.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  const sand = new Color3(0.76, 0.69, 0.52), wetSand = new Color3(0.45, 0.4, 0.3), grass = new Color3(0.3, 0.45, 0.2);
  const darkGrass = new Color3(0.18, 0.32, 0.13), rock = new Color3(0.43, 0.41, 0.38), bed = new Color3(0.32, 0.3, 0.24);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], z = pos[i + 2] + 200;
    const h = groundHeight(x, z);
    // sob a estrada/pátio a malha grossa fica rebaixada: as malhas finas deles (station.ts) cobrem
    pos[i + 1] = onRoadOrLot(x, z, ROAD.shoulder + 4) ? h - 1.2 : h;
    const sl = slopeAt(x, z);
    const n = fbm(x / 30, z / 30, 2) * 0.5 + 0.5;
    let c: Color3;
    if (h < -0.4) c = Color3.Lerp(bed, wetSand, smoothstep(-4, -0.4, h));
    else if (h < 1.6) c = Color3.Lerp(wetSand, sand, smoothstep(-0.4, 0.4, h));
    else c = Color3.Lerp(grass, darkGrass, n);
    if (h >= 1.2 && h < 2.4) c = Color3.Lerp(sand, c, smoothstep(1.2, 2.4, h));
    c = Color3.Lerp(c, rock, smoothstep(0.55, 0.95, sl));
    colors.push(c.r, c.g, c.b, 1);
    pos[i + 2] = z; // malha centrada em z = 200 (cobre o rio ao norte)
  }
  ground.updateVerticesData(VertexBuffer.PositionKind, pos);
  ground.setVerticesData(VertexBuffer.ColorKind, colors);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, ground.getIndices()!, normals);
  ground.updateVerticesData(VertexBuffer.NormalKind, normals);
  ground.refreshBoundingInfo();

  const mat = new StandardMaterial("terrainMat", scene);
  mat.diffuseTexture = noiseTexture(scene, "terrainDetail", [235, 235, 235], 0.18);
  (mat.diffuseTexture as Texture).uScale = (mat.diffuseTexture as Texture).vScale = 260;
  mat.specularColor = new Color3(0.04, 0.04, 0.04);
  ground.material = mat;
  ground.receiveShadows = true;
  ground.freezeWorldMatrix();
  return ground;
};

const rockMesh = (scene: Scene): Mesh => {
  const m = MeshBuilder.CreateIcoSphere("rockBase", { radius: 1, subdivisions: 2, flat: false }, scene);
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const k = 0.85 + 0.3 * (fbm(x * 1.7 + 3, z * 1.7 + y * 1.3, 3) * 0.5 + 0.5);
    pos[i] = x * k; pos[i + 1] = y * k * 0.9; pos[i + 2] = z * k;
  }
  m.updateVerticesData(VertexBuffer.PositionKind, pos);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, m.getIndices()!, normals);
  m.updateVerticesData(VertexBuffer.NormalKind, normals);
  const mat = new StandardMaterial("rockMat", scene);
  mat.diffuseColor = new Color3(0.5, 0.48, 0.45);
  mat.diffuseTexture = noiseTexture(scene, "rockTex", [200, 195, 185], 0.35, 128);
  mat.specularColor = new Color3(0.08, 0.08, 0.08);
  m.material = mat;
  return m;
};

export const buildRocks = (scene: Scene, rocks: SphereCollider[]): Mesh => {
  const base = rockMesh(scene);
  const rand = rng(99);
  const matrices = new Float32Array(rocks.length * 16);
  rocks.forEach((r, i) => {
    const m = Matrix.Compose(new Vector3(r.r, r.r, r.r), Quaternion.FromEulerAngles(rand() * 0.4, rand() * 6.28, rand() * 0.4), new Vector3(r.x, r.y, r.z));
    m.copyToArray(matrices, i * 16);
  });
  base.thinInstanceSetBuffer("matrix", matrices, 16, true);
  base.receiveShadows = true;
  return base;
};

export const buildTrees = (scene: Scene, count: number): Mesh => {
  const trunk = MeshBuilder.CreateCylinder("trunk", { height: 2.2, diameterTop: 0.25, diameterBottom: 0.4, tessellation: 6 }, scene);
  trunk.position.y = 1.1;
  const c1 = MeshBuilder.CreateCylinder("c1", { height: 4.5, diameterTop: 0, diameterBottom: 3.4, tessellation: 7 }, scene);
  c1.position.y = 3.8;
  const c2 = MeshBuilder.CreateCylinder("c2", { height: 3.4, diameterTop: 0, diameterBottom: 2.5, tessellation: 7 }, scene);
  c2.position.y = 5.6;
  const paint = (m: Mesh, c: Color3) => {
    const n = m.getTotalVertices();
    const cols: number[] = [];
    for (let i = 0; i < n; i++) cols.push(c.r, c.g, c.b, 1);
    m.setVerticesData(VertexBuffer.ColorKind, cols);
  };
  paint(trunk, new Color3(0.35, 0.25, 0.16));
  paint(c1, new Color3(0.16, 0.34, 0.16));
  paint(c2, new Color3(0.2, 0.4, 0.18));
  const tree = Mesh.MergeMeshes([trunk, c1, c2], true, true)!;
  tree.name = "trees";
  const mat = new StandardMaterial("treeMat", scene);
  mat.specularColor = Color3.Black();
  tree.material = mat;

  const rand = rng(4242);
  const mats: number[] = [];
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 30) {
    tries++;
    const x = (rand() * 2 - 1) * 900, z = (rand() * 2 - 1) * 650 + 180;
    const h = groundHeight(x, z);
    if (h < 2.2 || h > 30) continue;
    if (slopeAt(x, z) > 0.6) continue;
    if (z > RIVER.z0 - 40 && Math.abs(x - riverCenterX(z)) < RIVER.width) continue;
    if (onRoadOrLot(x, z, 9)) continue; // estrada, pátio e posto livres
    // aglomera em manchas (floresta) usando ruído
    if (fbm(x / 90, z / 90, 2) < -0.15 && rand() > 0.15) continue;
    const s = 0.7 + rand() * 0.8;
    const m = Matrix.Compose(new Vector3(s, s * (0.85 + rand() * 0.4), s), Quaternion.FromEulerAngles(0, rand() * 6.28, 0), new Vector3(x, h - 0.2, z));
    mats.push(...m.asArray());
    placed++;
  }
  tree.thinInstanceSetBuffer("matrix", new Float32Array(mats), 16, true);
  return tree;
};

export const buildPier = (scene: Scene, pier: PierLayout): Mesh[] => {
  const wood = new StandardMaterial("woodMat", scene);
  wood.diffuseTexture = noiseTexture(scene, "woodTex", [140, 100, 64], 0.25, 128);
  (wood.diffuseTexture as Texture).uScale = 8;
  wood.specularColor = new Color3(0.05, 0.05, 0.05);
  const meshes: Mesh[] = [];
  const len = pier.length + 6;
  const deck = MeshBuilder.CreateBox("pierDeck", { width: pier.width, height: 0.25, depth: len }, scene);
  deck.position.set(pier.shoreX, pier.deckY - 0.125, pier.shoreZ - 6 + len / 2);
  deck.material = wood;
  meshes.push(deck);
  for (let z = pier.shoreZ - 4; z <= pier.shoreZ + pier.length; z += 3.5) {
    for (const sx of [-1, 1]) {
      const g = groundHeight(pier.shoreX + sx * pier.width * 0.45, z);
      const h = pier.deckY + 0.6 - g;
      const post = MeshBuilder.CreateCylinder("post", { height: h, diameter: 0.32, tessellation: 8 }, scene);
      post.position.set(pier.shoreX + sx * (pier.width / 2 - 0.1), g + h / 2, z);
      post.material = wood;
      meshes.push(post);
    }
  }
  // cabana da marina
  const shoreH = groundHeight(pier.shoreX - 9, pier.shoreZ - 12);
  const hut = MeshBuilder.CreateBox("hut", { width: 7, height: 3.2, depth: 5 }, scene);
  hut.position.set(pier.shoreX - 9, shoreH + 1.6, pier.shoreZ - 12);
  const hutMat = new StandardMaterial("hutMat", scene);
  hutMat.diffuseColor = new Color3(0.86, 0.84, 0.78);
  hut.material = hutMat;
  const roof = MeshBuilder.CreateCylinder("roof", { height: 7.6, diameter: 5.6, tessellation: 3 }, scene);
  roof.rotation.z = Math.PI / 2;
  roof.rotation.x = Math.PI / 2 + Math.PI / 6;
  roof.scaling.set(1, 1, 0.55);
  roof.position.set(hut.position.x, shoreH + 3.9, hut.position.z);
  const roofMat = new StandardMaterial("roofMat", scene);
  roofMat.diffuseColor = new Color3(0.6, 0.18, 0.12);
  roof.material = roofMat;
  meshes.push(hut, roof);
  // ---- bar & restaurante (a cabana da marina): placa, janelas, deck com mesas e guarda-sóis ----
  const hx = hut.position.x, hz = hut.position.z, front = hz + 2.5; // fachada para o lago (+Z)
  const sign = MeshBuilder.CreatePlane("barSign", { width: 4.6, height: 0.9 }, scene);
  sign.material = signMat(scene, "barSignT", "BAR & RESTAURANTE", "peixe frito · porções · bebidas", "#5a1d10", "#ffd8a8", 1024, 200);
  sign.position.set(hx, shoreH + 2.75, front + 0.03); sign.rotation.y = Math.PI; meshes.push(sign);
  const glassM = new StandardMaterial("barGlass", scene); glassM.diffuseColor = new Color3(0.2, 0.28, 0.32); glassM.specularColor = new Color3(0.5, 0.5, 0.5);
  for (const dx of [-2.3, 2.3]) { const w = MeshBuilder.CreatePlane("barWindow", { width: 1.6, height: 1.1 }, scene); w.material = glassM; w.position.set(hx + dx, shoreH + 1.5, front + 0.02); w.rotation.y = Math.PI; meshes.push(w); }
  const doorM = new StandardMaterial("barDoor", scene); doorM.diffuseColor = new Color3(0.35, 0.22, 0.12);
  const door = MeshBuilder.CreatePlane("barDoorM", { width: 1.1, height: 2.1 }, scene); door.material = doorM; door.position.set(hx, shoreH + 1.05, front + 0.02); door.rotation.y = Math.PI; meshes.push(door);
  const barDeck = MeshBuilder.CreateBox("barDeck", { width: 9, height: 0.2, depth: 4.5 }, scene);
  barDeck.material = wood; barDeck.position.set(hx, shoreH + 0.1, front + 2.6); meshes.push(barDeck);
  const clothM = new StandardMaterial("umbrella", scene); clothM.diffuseColor = new Color3(0.95, 0.55, 0.12);
  const tableM = new StandardMaterial("barTable", scene); tableM.diffuseColor = new Color3(0.93, 0.92, 0.88);
  for (const dx of [-3, 0, 3]) {
    const tx = hx + dx, tz = front + 2.9;
    const top = MeshBuilder.CreateCylinder("barTableTop", { height: 0.05, diameter: 0.9 }, scene); top.material = tableM; top.position.set(tx, shoreH + 0.95, tz); meshes.push(top);
    const leg = MeshBuilder.CreateCylinder("barTableLeg", { height: 0.75, diameter: 0.08 }, scene); leg.material = tableM; leg.position.set(tx, shoreH + 0.57, tz); meshes.push(leg);
    const pole = MeshBuilder.CreateCylinder("umbPole", { height: 2.0, diameter: 0.05 }, scene); pole.material = tableM; pole.position.set(tx, shoreH + 1.2, tz); meshes.push(pole);
    const umb = MeshBuilder.CreateCylinder("umbrellaTop", { height: 0.45, diameterTop: 0.05, diameterBottom: 2.3, tessellation: 12 }, scene); umb.material = clothM; umb.position.set(tx, shoreH + 2.2, tz); meshes.push(umb);
    for (const sx of [-1, 1]) { const ch = MeshBuilder.CreateBox("barChair", { width: 0.45, height: 0.45, depth: 0.45 }, scene); ch.material = tableM; ch.position.set(tx + sx * 0.75, shoreH + 0.43, tz); meshes.push(ch); }
  }
  // boias de sinalização na ponta do píer
  const buoyMat = new StandardMaterial("buoyMat", scene);
  buoyMat.diffuseColor = new Color3(0.95, 0.35, 0.05);
  buoyMat.emissiveColor = new Color3(0.2, 0.05, 0);
  for (const sx of [-1, 1]) {
    const b = MeshBuilder.CreateSphere("buoy", { diameter: 0.6, segments: 8 }, scene);
    b.position.set(pier.shoreX + sx * 2.2, 0.05, pier.shoreZ + pier.length + 1);
    b.material = buoyMat;
    meshes.push(b);
  }
  return meshes;
};

export const skyColors = {
  horizon: new Color4(0.72, 0.82, 0.9, 1),
};
