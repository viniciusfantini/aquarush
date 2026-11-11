// Cenário PrototypeLake: relevo, margens, rochas, vegetação simples, píer e cabana da marina.
// Gerado a partir das MESMAS funções de sim/world.ts (o que se vê é o que colide).

import {
  type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, VertexBuffer, VertexData, Matrix, Quaternion, Vector3,
  DynamicTexture, Texture,
} from "@babylonjs/core";
import { groundHeight, rng, slopeAt, fbm, RIVER, riverCenterX, onRoadOrLot, ROAD, type SphereCollider, type PierLayout } from "../sim/world.ts";
import { buildRestaurant } from "./restaurant.ts";
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

const TERRAIN_COLORS = {
  sand: new Color3(0.76, 0.69, 0.52), wetSand: new Color3(0.45, 0.4, 0.3), grass: new Color3(0.3, 0.45, 0.2),
  darkGrass: new Color3(0.18, 0.32, 0.13), rock: new Color3(0.43, 0.41, 0.38), bed: new Color3(0.32, 0.3, 0.24),
};
const terrainColor = (x: number, z: number, h: number): Color3 => {
  const { sand, wetSand, grass, darkGrass, rock, bed } = TERRAIN_COLORS;
  const sl = slopeAt(x, z);
  const n = fbm(x / 30, z / 30, 2) * 0.5 + 0.5;
  let c: Color3;
  if (h < -0.4) c = Color3.Lerp(bed, wetSand, smoothstep(-4, -0.4, h));
  else if (h < 1.6) c = Color3.Lerp(wetSand, sand, smoothstep(-0.4, 0.4, h));
  else c = Color3.Lerp(grass, darkGrass, n);
  if (h >= 1.2 && h < 2.4) c = Color3.Lerp(sand, c, smoothstep(1.2, 2.4, h));
  return Color3.Lerp(c, rock, smoothstep(0.55, 0.95, sl));
};

/**
 * Faixa detalhada do rio/cânion (pontos a cada 2 m ao longo do rio, alturas do MESMO relevo da física). A malha
 * grossa (10–16 m entre pontos) não acompanha as paredes íngremes do cânion: em até 15 % do rio ela desenhava
 * terra onde a física tem água (o barco "entrava na parede"). A malha grossa fica rebaixada embaixo desta faixa.
 */
export const RIVER_STRIP = { z0: RIVER.z0 - 70, z1: RIVER.z1 + 70, half: 66, lowered: 40, step: 2 };
const inRiverStrip = (x: number, z: number, d: number) => z > RIVER_STRIP.z0 && z < RIVER_STRIP.z1 && Math.abs(x - riverCenterX(z)) < d;

const buildRiverStrip = (scene: Scene, mat: StandardMaterial): Mesh => {
  const S = RIVER_STRIP;
  const nz = Math.round((S.z1 - S.z0) / S.step) + 1, nx = Math.round((2 * S.half) / S.step) + 1;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let j = 0; j < nz; j++) {
    const z = S.z0 + j * S.step, cx = riverCenterX(z);
    for (let i = 0; i < nx; i++) {
      const x = cx - S.half + i * S.step;
      const h = groundHeight(x, z);
      pos.push(x, h, z);
      const c = terrainColor(x, z, h);
      col.push(c.r, c.g, c.b, 1);
    }
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const m = new Mesh("terrainRiver", scene);
  const vd = new VertexData();
  vd.positions = pos; vd.indices = idx; vd.colors = col;
  const nrm: number[] = []; VertexData.ComputeNormals(pos, idx, nrm); vd.normals = nrm;
  vd.applyToMesh(m);
  m.material = mat;
  m.receiveShadows = true;
  m.isPickable = false;
  m.freezeWorldMatrix();
  return m;
};

export const buildTerrain = (scene: Scene, q: EnvQuality): Mesh => {
  // (v0.66: 3,6 km para cobrir o lago ampliado; as subdivisões crescem junto — a malha mantém ~10 m por célula)
  const size = 3600; // (= a área do `OCEAN` em sim/world.ts: perto da borda o relevo desce até o fundo do mar)
  const ground = MeshBuilder.CreateGround("terrain", { width: size, height: size, subdivisions: Math.round(q.terrainSubdiv * size / 2600), updatable: true }, scene);
  const pos = ground.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], z = pos[i + 2] + 200;
    const h = groundHeight(x, z);
    // sob a estrada/pátio a malha grossa fica rebaixada: as malhas finas deles (station.ts) cobrem;
    // no rio/cânion também (a faixa detalhada cobre)
    // (no rio a faixa cobre até `half`; perto da borda dela a grossa desce só 0,6 m para não cintilar com a faixa)
    pos[i + 1] = onRoadOrLot(x, z, ROAD.shoulder + 4) ? h - 1.2 : inRiverStrip(x, z, RIVER_STRIP.lowered) ? h - 8 : inRiverStrip(x, z, RIVER_STRIP.half) ? h - 0.6 : h;
    const c = terrainColor(x, z, h);
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
  const strip = buildRiverStrip(scene, mat);
  strip.parent = null;
  ground.metadata = { riverStrip: strip };
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
    const x = (rand() * 2 - 1) * 1500, z = (rand() * 2 - 1) * 900 + 180; // (v0.66: em volta do lago ampliado)
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
  // bar & restaurante centralizado com o píer (o píer chega nos degraus da varanda) — presentation/restaurant.ts
  const shoreH = groundHeight(pier.shoreX, pier.shoreZ - 16);
  const hx = pier.shoreX, hz = pier.shoreZ - 16;
  meshes.push(...buildRestaurant(scene, hx, shoreH, hz));
  // ---- piscina do bar (lado leste, longe da rampa): borda de pedra, água azul, espreguiçadeiras e escada ----
  const px = hx + 15, pz = hz + 1, PW = 9, PD = 5, ph = groundHeight(px, pz);
  const stone = new StandardMaterial("poolStone", scene); stone.diffuseColor = new Color3(0.86, 0.84, 0.78); stone.specularColor = new Color3(0.05, 0.05, 0.05);
  const deckP = MeshBuilder.CreateBox("poolDeck", { width: PW + 4, height: 0.3, depth: PD + 4 }, scene); deckP.material = stone; deckP.position.set(px, ph + 0.15, pz); meshes.push(deckP);
  for (const [w, d, dx, dz] of [[PW + 0.6, 0.3, 0, PD / 2 + 0.15], [PW + 0.6, 0.3, 0, -PD / 2 - 0.15], [0.3, PD, PW / 2 + 0.15, 0], [0.3, PD, -PW / 2 - 0.15, 0]] as const) {
    const rim = MeshBuilder.CreateBox("poolRim", { width: w, height: 0.2, depth: d }, scene); rim.material = stone; rim.position.set(px + dx, ph + 0.4, pz + dz); meshes.push(rim);
  }
  const poolWater = MeshBuilder.CreateGround("poolWater", { width: PW, height: PD }, scene);
  const pwM = new StandardMaterial("poolWaterMat", scene); pwM.diffuseColor = new Color3(0.25, 0.72, 0.85); pwM.emissiveColor = new Color3(0.05, 0.22, 0.28); pwM.specularColor = new Color3(0.9, 0.9, 0.9); pwM.specularPower = 64; pwM.alpha = 0.92;
  poolWater.material = pwM; poolWater.position.set(px, ph + 0.36, pz); meshes.push(poolWater);
  const lounger = new StandardMaterial("lounger", scene); lounger.diffuseColor = new Color3(0.95, 0.95, 0.92);
  for (const dx of [-2.5, 0, 2.5]) {
    const l = MeshBuilder.CreateBox("poolLounger", { width: 0.7, height: 0.12, depth: 1.8 }, scene); l.material = lounger; l.position.set(px + dx, ph + 0.5, pz - PD / 2 - 1.3); l.rotation.x = -0.12; meshes.push(l);
  }
  const ladM = new StandardMaterial("poolLadder", scene); ladM.diffuseColor = new Color3(0.8, 0.82, 0.85); ladM.specularColor = new Color3(0.8, 0.8, 0.8);
  for (const dx of [-0.25, 0.25]) {
    const path: Vector3[] = [];
    for (let i = 0; i <= 8; i++) { const a = Math.PI * (i / 8); path.push(new Vector3(px + PW / 2 - 0.8 + dx, ph + 0.35 + Math.sin(a) * 0.45, pz + PD / 2 + 0.2 - Math.cos(a) * 0.3)); }
    const t = MeshBuilder.CreateTube("poolLadderRail", { path, radius: 0.025, tessellation: 8 }, scene); t.material = ladM; meshes.push(t);
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
