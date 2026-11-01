// Modelo provisório da lancha (procedural). Origem = centro de massa da simulação.
// Casco em V construído por seções (ribbon), deck, para-brisa, console, bancos, piloto,
// motor de popa que gira com a direção e inclina com o trim (mesmo ângulo da física).

import {
  type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, TransformNode, Vector3, VertexBuffer, VertexData,
} from "@babylonjs/core";
import { smoothstep, clamp } from "../sim/math.ts";

export interface BoatVisual {
  root: TransformNode;
  engine: TransformNode;   // pivô do motor (yaw = direção, pitch = trim)
  wheel: Mesh;
  lights: { port: StandardMaterial; star: StandardMaterial; stern: StandardMaterial };
  hullMeshes: Mesh[];
}

const Z_STERN = -2.95, Z_BOW = 3.15;
const halfBeam = (z: number) => z <= 0 ? 1.15 - 0.1 * (z / Z_STERN) : 1.15 * Math.sqrt(Math.max(0, 1 - (z / Z_BOW) ** 2.2));
const keelY = (z: number) => -0.45 + 0.6 * Math.pow(smoothstep(0.8, Z_BOW, z), 1.6);
const chineY = (z: number) => -0.24 + 0.5 * Math.pow(smoothstep(1.2, Z_BOW, z), 1.4);
const sheerY = (z: number) => 0.42 + 0.2 * Math.pow(smoothstep(0, Z_BOW, z), 2);

const colorize = (m: Mesh, fn: (x: number, y: number, z: number) => Color3) => {
  const p = m.getVerticesData(VertexBuffer.PositionKind)!;
  const c: number[] = [];
  for (let i = 0; i < p.length; i += 3) { const col = fn(p[i], p[i + 1], p[i + 2]); c.push(col.r, col.g, col.b, 1); }
  m.setVerticesData(VertexBuffer.ColorKind, c);
};

export const buildBoat = (scene: Scene): BoatVisual => {
  const root = new TransformNode("boat", scene);
  const hullMeshes: Mesh[] = [];

  // ---------- casco ----------
  const paths: Vector3[][] = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const z = Z_STERN + (Z_BOW - Z_STERN) * (i / N);
    const hb = Math.max(halfBeam(z), 0.002);
    const k = keelY(z), c = Math.min(chineY(z), sheerY(z) - 0.02), s = sheerY(z);
    const ch = hb * 0.93;
    paths.push([
      new Vector3(-hb, s, z), new Vector3(-ch, c, z), new Vector3(-ch * 0.5, (c + k) / 2 - 0.03, z), new Vector3(0, k, z),
      new Vector3(ch * 0.5, (c + k) / 2 - 0.03, z), new Vector3(ch, c, z), new Vector3(hb, s, z),
    ]);
  }
  const hull = MeshBuilder.CreateRibbon("hull", { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE }, scene);
  const white = new Color3(0.94, 0.95, 0.96), navy = new Color3(0.05, 0.12, 0.28), stripe = new Color3(0.8, 0.1, 0.12);
  colorize(hull, (_x, y) => (y < -0.12 ? navy : y > 0.18 && y < 0.27 ? stripe : white));

  // espelho de popa (transom)
  const t = paths[0];
  const transom = new Mesh("transom", scene);
  const tp: number[] = [];
  for (const v of t) tp.push(v.x, v.y, v.z);
  tp.push(0, sheerY(Z_STERN), Z_STERN);
  const ti: number[] = [];
  for (let i = 0; i < t.length - 1; i++) ti.push(t.length, i, i + 1);
  const tvd = new VertexData();
  tvd.positions = tp; tvd.indices = ti;
  const tn: number[] = []; VertexData.ComputeNormals(tp, ti, tn); tvd.normals = tn;
  tvd.applyToMesh(transom);
  transom.sideOrientation = Mesh.DOUBLESIDE;
  colorize(transom, (_x, y) => (y < -0.12 ? navy : white));

  // deck (fecha o topo entre as bordas)
  const port: Vector3[] = [], star: Vector3[] = [];
  for (const p of paths) { port.push(p[0].add(new Vector3(0, -0.02, 0))); star.push(p[6].add(new Vector3(0, -0.02, 0))); }
  const deck = MeshBuilder.CreateRibbon("deck", { pathArray: [port, star], sideOrientation: Mesh.DOUBLESIDE }, scene);
  colorize(deck, (x, _y, z) => (Math.abs(x) < 0.85 && z > -2.5 && z < 1.4 ? new Color3(0.78, 0.74, 0.66) : white));

  const hullMat = new StandardMaterial("hullMat", scene);
  hullMat.specularColor = new Color3(0.35, 0.35, 0.35);
  hullMat.specularPower = 64;
  hullMat.backFaceCulling = false;
  hullMat.emissiveColor = new Color3(0.22, 0.22, 0.24);
  for (const m of [hull, transom, deck]) { m.material = hullMat; m.parent = root; hullMeshes.push(m); }

  // ---------- para-brisa, console, bancos ----------
  const glassMat = new StandardMaterial("glassMat", scene);
  glassMat.diffuseColor = new Color3(0.15, 0.25, 0.3);
  glassMat.alpha = 0.35;
  glassMat.specularColor = new Color3(1, 1, 1);
  glassMat.specularPower = 128;
  const glass = MeshBuilder.CreateBox("windshield", { width: 1.9, height: 0.55, depth: 0.03 }, scene);
  glass.position.set(0, 0.68, 1.15);
  glass.rotation.x = -0.6;
  glass.material = glassMat;
  glass.parent = root;

  const darkMat = new StandardMaterial("darkMat", scene);
  darkMat.diffuseColor = new Color3(0.12, 0.13, 0.15);
  darkMat.specularColor = new Color3(0.2, 0.2, 0.2);
  const console_ = MeshBuilder.CreateBox("console", { width: 0.75, height: 0.55, depth: 0.6 }, scene);
  console_.position.set(0.45, 0.66, 0.7);
  console_.material = hullMat;
  colorize(console_, () => white);
  console_.parent = root;
  const dash = MeshBuilder.CreateBox("dash", { width: 0.7, height: 0.04, depth: 0.35 }, scene);
  dash.position.set(0.45, 0.95, 0.62);
  dash.rotation.x = -0.35;
  dash.material = darkMat;
  dash.parent = root;
  const wheel = MeshBuilder.CreateTorus("wheel", { diameter: 0.36, thickness: 0.035, tessellation: 20 }, scene);
  wheel.position.set(0.45, 1.0, 0.42);
  wheel.rotation.x = Math.PI / 2 - 0.5;
  wheel.material = darkMat;
  wheel.parent = root;

  const seatMat = new StandardMaterial("seatMat", scene);
  seatMat.diffuseColor = new Color3(0.85, 0.82, 0.74);
  seatMat.specularColor = new Color3(0.1, 0.1, 0.1);
  for (const sx of [-0.45, 0.45]) {
    const seat = MeshBuilder.CreateBox("seat", { width: 0.55, height: 0.18, depth: 0.55 }, scene);
    seat.position.set(sx, 0.55, -0.05);
    seat.material = seatMat; seat.parent = root;
    const back = MeshBuilder.CreateBox("seatBack", { width: 0.55, height: 0.55, depth: 0.12 }, scene);
    back.position.set(sx, 0.85, -0.35);
    back.rotation.x = -0.15;
    back.material = seatMat; back.parent = root;
  }
  const bench = MeshBuilder.CreateBox("bench", { width: 2.0, height: 0.35, depth: 0.6 }, scene);
  bench.position.set(0, 0.55, -2.25);
  bench.material = seatMat; bench.parent = root;

  // piloto (escala)
  const skin = new StandardMaterial("skin", scene); skin.diffuseColor = new Color3(0.8, 0.6, 0.45);
  const shirt = new StandardMaterial("shirt", scene); shirt.diffuseColor = new Color3(0.95, 0.55, 0.1);
  const body = MeshBuilder.CreateCapsule("pilotBody", { radius: 0.2, height: 0.75 }, scene);
  body.position.set(0.45, 0.98, -0.12); body.material = shirt; body.parent = root;
  const head = MeshBuilder.CreateSphere("pilotHead", { diameter: 0.26, segments: 10 }, scene);
  head.position.set(0.45, 1.45, -0.08); head.material = skin; head.parent = root;
  const cap = MeshBuilder.CreateSphere("pilotCap", { diameter: 0.28, segments: 8, slice: 0.5 }, scene);
  cap.position.set(0.45, 1.48, -0.08); cap.material = darkMat; cap.parent = root;

  // ---------- motor de popa (pivô no espelho) ----------
  const engine = new TransformNode("enginePivot", scene);
  engine.parent = root;
  engine.position.set(0, 0.25, Z_STERN - 0.05);
  const engMat = new StandardMaterial("engMat", scene);
  engMat.diffuseColor = new Color3(0.08, 0.08, 0.09);
  engMat.specularColor = new Color3(0.6, 0.6, 0.6);
  engMat.specularPower = 48;
  const cowl = MeshBuilder.CreateBox("cowl", { width: 0.5, height: 0.6, depth: 0.65 }, scene);
  cowl.position.set(0, 0.35, -0.3); cowl.material = engMat; cowl.parent = engine;
  const leg = MeshBuilder.CreateBox("leg", { width: 0.14, height: 1.05, depth: 0.3 }, scene);
  leg.position.set(0, -0.45, -0.3); leg.material = engMat; leg.parent = engine;
  const gear = MeshBuilder.CreateCylinder("gearcase", { height: 0.5, diameter: 0.16, tessellation: 10 }, scene);
  gear.rotation.x = Math.PI / 2;
  gear.position.set(0, -1.0, -0.25); gear.material = engMat; gear.parent = engine;
  const prop = MeshBuilder.CreateCylinder("prop", { height: 0.05, diameter: 0.36, tessellation: 3 }, scene);
  prop.rotation.x = Math.PI / 2;
  prop.position.set(0, -1.0, -0.52); prop.material = engMat; prop.parent = engine;
  prop.metadata = { spin: true };

  // ---------- luzes de navegação ----------
  const mkLight = (name: string, c: Color3, pos: Vector3) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = c.scale(0.4);
    m.emissiveColor = Color3.Black();
    const s = MeshBuilder.CreateSphere(name + "Mesh", { diameter: 0.09, segments: 6 }, scene);
    s.position.copyFrom(pos); s.material = m; s.parent = root;
    return m;
  };
  const lights = {
    port: mkLight("navPort", new Color3(1, 0.05, 0.05), new Vector3(-0.35, sheerY(2.6) + 0.06, 2.6)),
    star: mkLight("navStar", new Color3(0.05, 1, 0.2), new Vector3(0.35, sheerY(2.6) + 0.06, 2.6)),
    stern: mkLight("navStern", new Color3(1, 1, 1), new Vector3(0, 1.55, -2.7)),
  };
  const pole = MeshBuilder.CreateCylinder("pole", { height: 1.0, diameter: 0.03 }, scene);
  pole.position.set(0, 1.03, -2.7); pole.material = darkMat; pole.parent = root;

  return { root, engine, wheel, lights, hullMeshes };
};

export const setNavLights = (v: BoatVisual, on: boolean): void => {
  v.lights.port.emissiveColor = on ? new Color3(1, 0.05, 0.05) : Color3.Black();
  v.lights.star.emissiveColor = on ? new Color3(0.1, 1, 0.25) : Color3.Black();
  v.lights.stern.emissiveColor = on ? new Color3(1, 1, 1) : Color3.Black();
};

export const clampTrimVisual = (deg: number) => clamp(deg, -12, 12);
