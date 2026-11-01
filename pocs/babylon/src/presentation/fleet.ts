// Frota de exposição no estacionamento de cima (mockups estáticos): jet ski, pontoon, catamarã fisher,
// lancha cabinada de 50 pés e lancha offshore — cada uma na sua carretinha, engatada no veículo de reboque.
// Só visual (+ obstáculo para o carro, em sim/station.ts). Tudo procedural, sem marcas.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core";
import { LOT } from "../sim/world.ts";
import { FLEET, type FleetKind } from "../sim/station.ts";
import { pbr, roundedBox } from "./boatMesh.ts";
import { buildCar, buildPickup } from "./ramp.ts";
import { smoothstep } from "../sim/math.ts";

type Mat = StandardMaterial | PBRMaterial;

export const buildFleet = (scene: Scene): Mesh[] => {
  const all: Mesh[] = [];
  const M = {
    galv: pbr(scene, "fGalv", new Color3(0.72, 0.74, 0.76), 0.8, 0.45),
    tire: pbr(scene, "fTire", new Color3(0.04, 0.04, 0.045), 0, 0.85),
    rim: pbr(scene, "fRim", new Color3(0.75, 0.76, 0.78), 0.9, 0.3),
    carpet: pbr(scene, "fCarpet", new Color3(0.12, 0.13, 0.16), 0, 0.95),
    white: pbr(scene, "fWhite", new Color3(0.95, 0.95, 0.94), 0, 0.3, 0.8),
    glass: pbr(scene, "fGlass", new Color3(0.05, 0.08, 0.1), 0.2, 0.05),
    black: pbr(scene, "fBlack", new Color3(0.04, 0.04, 0.045), 0, 0.3, 0.6),
    alu: pbr(scene, "fAlu", new Color3(0.82, 0.83, 0.85), 0.9, 0.35),
    canvas: pbr(scene, "fCanvas", new Color3(0.12, 0.2, 0.32), 0, 0.8),
    teak: pbr(scene, "fTeak", new Color3(0.55, 0.36, 0.2), 0, 0.6),
    cushion: pbr(scene, "fCushion", new Color3(0.92, 0.9, 0.84), 0, 0.5),
    chrome: pbr(scene, "fChrome", new Color3(0.9, 0.9, 0.92), 1, 0.12),
  };
  for (const f of FLEET) all.push(...buildRig(scene, f, M));
  for (const m of all) { m.isPickable = false; m.receiveShadows = true; }
  return all;
};

/** Casco em V com proa afinando e subindo (loft de seções). Origem: quilha a meio comprimento, y = 0 na quilha. */
const hullLoft = (scene: Scene, name: string, L: number, B: number, H: number, opts: { dead?: number; bowRise?: number; sheerRise?: number; topColor: Color3; bottomColor: Color3; stripe?: Color3; stripeY?: number; fine?: number }): Mesh => {
  const dead = opts.dead ?? 0.35, bowRise = opts.bowRise ?? H * 0.6, sheerRise = opts.sheerRise ?? H * 0.25, fine = opts.fine ?? 0.6;
  const N = 28, secs: Vector3[][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, z = -L / 2 + L * t;
    const hb = Math.max(0.02, (B / 2) * (t < fine ? 1 : Math.sqrt(Math.max(0, 1 - ((t - fine) / (1 - fine)) ** 2))));
    const keel = bowRise * Math.pow(smoothstep(fine * 0.8, 1, t), 1.6);
    const sheer = H + sheerRise * t * t;
    const chineY = keel + Math.min(dead * hb, (sheer - keel) * 0.6);
    secs.push([new Vector3(-hb, sheer, z), new Vector3(-hb * 0.95, chineY + 0.05, z), new Vector3(-hb * 0.85, chineY, z), new Vector3(0, keel, z), new Vector3(hb * 0.85, chineY, z), new Vector3(hb * 0.95, chineY + 0.05, z), new Vector3(hb, sheer, z)]);
  }
  const hull = MeshBuilder.CreateRibbon(name, { pathArray: secs, sideOrientation: Mesh.DOUBLESIDE }, scene);
  // espelho de popa e convés (fecham o casco)
  const tr = secs[0];
  const transom = MeshBuilder.CreateRibbon(name + "Transom", { pathArray: [tr, tr.map((p) => new Vector3(0, H, p.z))], sideOrientation: Mesh.DOUBLESIDE }, scene);
  const deck = MeshBuilder.CreateRibbon(name + "Deck", { pathArray: [secs.map((s) => s[0]), secs.map((s) => new Vector3(0, s[0].y + 0.04, s[0].z)), secs.map((s) => s[6])], sideOrientation: Mesh.DOUBLESIDE }, scene);
  const merged = Mesh.MergeMeshes([hull, transom, deck], true, true)!;
  merged.name = name;
  const p = merged.getVerticesData(VertexBuffer.PositionKind)!;
  const col: number[] = [];
  const sy = opts.stripeY ?? H * 0.55;
  for (let i = 0; i < p.length; i += 3) {
    const y = p[i + 1];
    const c = y < H * 0.28 ? opts.bottomColor : opts.stripe && Math.abs(y - sy) < H * 0.07 ? opts.stripe : opts.topColor;
    col.push(c.r, c.g, c.b, 1);
  }
  merged.setVerticesData(VertexBuffer.ColorKind, col);
  return merged;
};

const wheelSimple = (scene: Scene, parent: TransformNode, r: number, w: number, x: number, z: number, M: Record<string, Mat>, out: Mesh[]) => {
  const t = MeshBuilder.CreateCylinder("fTireM", { height: w, diameter: r * 2, tessellation: 20 }, scene);
  t.rotation.z = Math.PI / 2; t.position.set(x, r, z); t.parent = parent; t.material = M.tire; out.push(t);
  const h = MeshBuilder.CreateCylinder("fRimM", { height: w + 0.01, diameter: r * 1.2, tessellation: 14 }, scene);
  h.rotation.z = Math.PI / 2; h.position.set(x, r, z); h.parent = parent; h.material = M.rim; out.push(h);
};

/** Carretinha genérica: longarinas, cabeçalho, eixos, berço/bunks na altura `bunkY` (frente em +Z local). */
const trailer = (scene: Scene, g: TransformNode, z0: number, len: number, halfW: number, axles: number, wheelR: number, bunkY: number, M: Record<string, Mat>, out: Mesh[]) => {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: Mat) => { const b = MeshBuilder.CreateBox("fTrl", { width: w, height: h, depth: d }, scene); b.position.set(x, y, z); b.parent = g; b.material = m; out.push(b); return b; };
  const railY = wheelR * 1.5;
  for (const s of [-1, 1]) box(0.09, 0.14, len, s * halfW * 0.55, railY, z0 - len / 2, M.galv);
  box(0.09, 0.12, 1.6, 0, railY, z0 + 0.6, M.galv);                      // cabeçalho
  for (let k = 0; k < 5; k++) box(halfW * 1.15, 0.07, 0.08, 0, railY, z0 - (k / 4) * len, M.galv);
  for (let a = 0; a < axles; a++) {
    const az = z0 - len * 0.55 - a * (wheelR * 2.4);
    box(halfW * 2 + 0.1, 0.08, 0.08, 0, wheelR, az, M.galv);
    for (const s of [-1, 1]) wheelSimple(scene, g, wheelR, 0.2, s * (halfW + 0.05), az, M, out);
  }
  for (const s of [-1, 1]) {                                               // bunks
    box(0.12, 0.08, len * 0.8, s * halfW * 0.45, bunkY, z0 - len / 2, M.carpet);
    for (const k of [0.25, 0.75]) box(0.05, bunkY - railY, 0.05, s * halfW * 0.45, (bunkY + railY) / 2, z0 - len * k, M.galv);
  }
  box(0.08, bunkY + 0.6 - railY, 0.08, 0, (bunkY + 0.6 + railY) / 2, z0 - 0.1, M.galv); // coluna do guincho
};

/** Motor de popa simples (capô + perna), para os mockups. */
const outboard = (scene: Scene, g: TransformNode, x: number, y: number, z: number, scale: number, cowl: Mat, M: Record<string, Mat>, out: Mesh[]) => {
  const c = roundedBox("fCowl", scene, 0.45 * scale, 0.6 * scale, 0.7 * scale, 0.1 * scale); c.position.set(x, y + 0.3 * scale, z - 0.3 * scale); c.parent = g; c.material = cowl; out.push(c);
  const leg = MeshBuilder.CreateBox("fLeg", { width: 0.12 * scale, height: 0.9 * scale, depth: 0.3 * scale }, scene); leg.position.set(x, y - 0.35 * scale, z - 0.35 * scale); leg.parent = g; leg.material = M.black; out.push(leg);
};

const buildRig = (scene: Scene, f: (typeof FLEET)[number], M: Record<string, Mat>): Mesh[] => {
  const out: Mesh[] = [];
  const g = new TransformNode("fleet_" + f.kind, scene);
  g.position.set(f.x, LOT.y + 0.05, f.z); g.rotation.y = Math.PI / 2; // frente do conjunto para +X
  const front = f.len / 2;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: Mat, parent: TransformNode = g) => { const b = MeshBuilder.CreateBox("fBox", { width: w, height: h, depth: d }, scene); b.position.set(x, y, z); b.parent = parent; b.material = m; out.push(b); return b; };
  const add = (m: Mesh, mat: Mat, parent: TransformNode = g) => { m.parent = parent; m.material = mat; out.push(m); return m; };
  const tube = (path: Vector3[], r: number, m: Mat, parent: TransformNode = g) => add(MeshBuilder.CreateTube("fTube", { path, radius: r, tessellation: 8 }, scene), m, parent);
  const vehicle = (kind: "car" | "pickup", paint: Color3) => {
    const v = kind === "car" ? buildCar(scene, "fCar_" + f.kind, paint) : buildPickup(scene, "fPickup_" + f.kind, paint);
    v.root.parent = g; v.root.position.set(0, 0, front - v.length / 2); out.push(...v.meshes);
    return front - v.length - 0.35; // z do acoplador
  };
  const boatNode = (y: number, zc: number) => { const n = new TransformNode("fBoat_" + f.kind, scene); n.parent = g; n.position.set(0, y, zc); return n; };
  const vc = (m: Mesh) => { const mt = new StandardMaterial(m.name + "VC", scene); mt.specularColor = new Color3(0.25, 0.25, 0.25); m.material = mt; m.parent = g; out.push(m); return m; };

  switch (f.kind as FleetKind) {
    case "jetski": {
      const zc = vehicle("car", new Color3(0.15, 0.32, 0.62)) - 1.2;
      trailer(scene, g, zc, 3.4, 0.6, 1, 0.24, 0.55, M, out);
      const b = boatNode(0.6, zc - 1.8);
      const hull = vc(hullLoft(scene, "jetHull", 3.3, 1.15, 0.55, { dead: 0.5, bowRise: 0.25, sheerRise: 0.05, topColor: new Color3(0.98, 0.98, 0.97), bottomColor: new Color3(0.1, 0.12, 0.14), stripe: new Color3(0.55, 0.85, 0.1), stripeY: 0.4, fine: 0.55 }));
      hull.parent = b;
      add(roundedBox("jetSeat", scene, 0.45, 0.2, 1.3, 0.08), M.black, b).position.set(0, 0.7, -0.35);
      add(roundedBox("jetHood", scene, 0.75, 0.3, 0.9, 0.12), M.white, b).position.set(0, 0.68, 0.75);
      tube([new Vector3(-0.35, 0.95, 0.38), new Vector3(0, 0.88, 0.32), new Vector3(0.35, 0.95, 0.38)], 0.025, M.black, b);
      break;
    }
    case "pontoon": {
      const zc = vehicle("pickup", new Color3(0.2, 0.22, 0.24)) - 1.5;
      trailer(scene, g, zc, 8.0, 1.3, 2, 0.3, 0.75, M, out);
      const b = boatNode(0.95, zc - 3.9);
      for (const s of [-1, 1]) {
        add(MeshBuilder.CreateCylinder("pontTube", { height: 7.0, diameter: 0.62, tessellation: 18 }, scene), M.alu, b).rotation.x = Math.PI / 2;
        out[out.length - 1].position.set(s * 0.95, 0, 0);
        const nose = add(MeshBuilder.CreateCylinder("pontNose", { height: 0.7, diameterTop: 0.05, diameterBottom: 0.62, tessellation: 18 }, scene), M.alu, b);
        nose.rotation.x = Math.PI / 2; nose.position.set(s * 0.95, 0.05, 3.85);
      }
      box(2.55, 0.08, 7.2, 0, 0.36, 0, M.teak, b);
      // guarda-corpo em painéis (com portão na proa) e toldo bimini
      for (const s of [-1, 1]) box(0.05, 0.75, 6.8, s * 1.25, 0.78, -0.1, M.white, b);
      box(2.5, 0.75, 0.05, 0, 0.78, -3.5, M.white, b);
      for (const s of [-1, 1]) box(0.8, 0.75, 0.05, s * 0.85, 0.78, 3.3, M.white, b);
      box(2.2, 0.06, 3.2, 0, 2.2, -0.6, M.canvas, b);
      for (const sx of [-1, 1]) for (const sz of [-2.1, 0.9]) tube([new Vector3(sx * 1.15, 0.4, sz), new Vector3(sx * 1.05, 2.18, sz)], 0.025, M.alu, b);
      box(0.6, 0.85, 0.5, 0.75, 0.82, 1.0, M.white, b);                      // console
      for (const sz of [-2.6, 1.9]) box(2.2, 0.4, 0.6, 0, 0.6, sz, M.cushion, b); // sofás
      outboard(scene, b, 0, 0.3, -3.65, 1.2, M.black, M, out);
      break;
    }
    case "catamaran": {
      const zc = vehicle("pickup", new Color3(0.92, 0.92, 0.9)) - 1.5;
      trailer(scene, g, zc, 8.6, 1.35, 2, 0.32, 0.72, M, out);
      const b = boatNode(0.78, zc - 4.2);
      for (const s of [-1, 1]) {
        const h = vc(hullLoft(scene, "catHull" + s, 8.2, 0.95, 1.05, { dead: 0.9, bowRise: 0.55, sheerRise: 0.25, topColor: new Color3(0.97, 0.97, 0.96), bottomColor: new Color3(0.08, 0.18, 0.35), stripe: new Color3(0.08, 0.18, 0.35), stripeY: 0.85, fine: 0.55 }));
        h.parent = b; h.position.x = s * 0.92;
      }
      box(2.7, 0.12, 7.4, 0, 1.05, -0.3, M.white, b);                        // convés-ponte
      box(0.9, 1.1, 0.9, 0, 1.65, 0.3, M.white, b);                          // console central
      box(0.7, 0.4, 0.05, 0, 2.3, 0.75, M.glass, b);                         // para-brisa
      for (const sx of [-1, 1]) for (const sz of [-0.6, 1.0]) tube([new Vector3(sx * 0.8, 1.1, sz), new Vector3(sx * 0.75, 3.1, sz)], 0.04, M.alu, b);
      box(1.9, 0.08, 2.1, 0, 3.12, 0.2, M.white, b);                         // T-top
      for (let k = 0; k < 4; k++) tube([new Vector3(-0.6 + k * 0.4, 3.16, -0.8), new Vector3(-0.6 + k * 0.4, 3.6, -0.85)], 0.03, M.alu, b); // porta-varas
      for (const s of [-1, 1]) outboard(scene, b, s * 0.92, 0.9, -4.05, 1.3, M.white, M, out);
      break;
    }
    case "cruiser50": {
      // cavalo mecânico + prancha (lowboy) com berço hidráulico: barco de 15 m
      const cab = new TransformNode("fSemi", scene); cab.parent = g; cab.position.set(0, 0, front - 3.2);
      box(2.5, 1.2, 6.2, 0, 1.0, 0, M.black, cab);                           // chassi
      box(2.5, 2.4, 2.4, 0, 2.4, 1.9, M.white, cab);                         // cabine
      box(2.4, 1.0, 2.0, 0, 3.4, 0.2, M.white, cab);                         // dormitório
      box(2.3, 0.9, 0.05, 0, 2.9, 3.11, M.glass, cab);                       // para-brisa
      box(2.4, 0.8, 1.2, 0, 1.4, 3.6, M.white, cab);                         // capô
      for (const s of [-1, 1]) tube([new Vector3(s * 1.2, 1.5, 0.6), new Vector3(s * 1.2, 4.2, 0.6)], 0.09, M.chrome, cab);
      for (const z of [2.6, -1.2, -2.6]) for (const s of [-1, 1]) wheelSimple(scene, cab, 0.52, 0.35, s * 1.1, z, M, out);
      const zc = front - 6.6;
      trailer(scene, g, zc, 16.5, 1.4, 3, 0.4, 1.15, M, out);
      const b = boatNode(1.2, zc - 8.0);
      const hull = vc(hullLoft(scene, "cr50Hull", 15.2, 4.4, 2.0, { dead: 0.5, bowRise: 1.1, sheerRise: 0.5, topColor: new Color3(0.95, 0.95, 0.94), bottomColor: new Color3(0.06, 0.1, 0.22), stripe: new Color3(0.06, 0.1, 0.22), stripeY: 1.25, fine: 0.62 }));
      hull.parent = b;
      add(roundedBox("cr50Cabin", scene, 3.6, 1.4, 7.0, 0.35), M.white, b).position.set(0, 2.7, 0.3);
      add(roundedBox("cr50Windows", scene, 3.65, 0.5, 6.0, 0.2), M.glass, b).position.set(0, 2.85, 0.4);
      add(roundedBox("cr50Fly", scene, 3.4, 0.6, 4.2, 0.25), M.white, b).position.set(0, 3.7, -0.6);
      box(3.0, 0.08, 3.0, 0, 5.1, -0.9, M.canvas, b);                        // bimini do flybridge
      for (const sx of [-1, 1]) for (const sz of [-2.2, 0.4]) tube([new Vector3(sx * 1.4, 4.0, sz), new Vector3(sx * 1.35, 5.08, sz)], 0.03, M.chrome, b);
      tube([new Vector3(-1.3, 4.0, -2.7), new Vector3(-1.1, 5.4, -2.6), new Vector3(1.1, 5.4, -2.6), new Vector3(1.3, 4.0, -2.7)], 0.08, M.white, b); // arco do radar
      add(MeshBuilder.CreateCylinder("cr50Radar", { height: 0.25, diameter: 0.6 }, scene), M.white, b).position.set(0, 5.6, -2.6);
      box(4.2, 0.12, 1.3, 0, 0.55, -8.1, M.teak, b);                         // plataforma de banho
      for (const s of [-1, 1]) tube([new Vector3(s * 1.9, 2.6, -4), new Vector3(s * 2.0, 2.6, 2), new Vector3(s * 1.4, 2.8, 6.3), new Vector3(0, 2.95, 7.3)], 0.025, M.chrome, b); // guarda-mancebo
      break;
    }
    case "offshore": {
      const zc = vehicle("pickup", new Color3(0.08, 0.08, 0.09)) - 1.6;
      trailer(scene, g, zc, 11.5, 1.2, 3, 0.33, 0.8, M, out);
      const b = boatNode(0.88, zc - 5.6);
      const hull = vc(hullLoft(scene, "offHull", 11.8, 2.6, 1.15, { dead: 0.9, bowRise: 0.55, sheerRise: 0.08, topColor: new Color3(0.95, 0.2, 0.05), bottomColor: new Color3(0.05, 0.05, 0.06), stripe: new Color3(1, 0.85, 0.1), stripeY: 0.78, fine: 0.45 }));
      hull.parent = b;
      // cockpit com capota (bolha de vidro), entradas de ar e 2 motores grandes
      const canopy = add(MeshBuilder.CreateSphere("offCanopy", { diameter: 1, segments: 16, slice: 0.5 }, scene), M.glass, b);
      canopy.scaling.set(1.6, 0.9, 3.0); canopy.position.set(0, 1.18, -0.8);
      box(1.7, 0.12, 3.1, 0, 1.2, -0.8, M.black, b);
      for (const s of [-1, 1]) box(0.25, 0.3, 1.2, s * 0.9, 1.35, -2.8, M.black, b);
      for (const s of [-1, 1]) outboard(scene, b, s * 0.55, 1.0, -5.95, 1.7, M.black, M, out);
      break;
    }
  }
  return out;
};
