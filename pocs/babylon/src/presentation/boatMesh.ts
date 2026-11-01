// Lancha provisória AR-6 — modelo procedural detalhado. Origem = centro de massa da simulação.
// Eixos: X boreste (direita), Y cima, Z proa. Todas as peças são geradas por código
// (sem assets externos), com materiais PBR (gelcoat com verniz, inox, vinil, vidro).

import {
  type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3, VertexBuffer,
  VertexData, DynamicTexture,
} from "@babylonjs/core";
import { smoothstep } from "../sim/math.ts";

export interface BoatVisual {
  root: TransformNode;
  engine: TransformNode;      // pivô do motor: yaw = direção, pitch = trim (mesmos ângulos da física)
  propeller: TransformNode;   // gira com a rotação real da hélice
  propBlur: PBRMaterial;      // disco de borrão (alpha ∝ rotação)
  wheel: TransformNode;       // volante (gira com a direção)
  speedNeedle: TransformNode;
  rpmNeedle: TransformNode;
  lights: { port: StandardMaterial; star: StandardMaterial; stern: StandardMaterial };
  /** Tampa invisível do cockpit (só profundidade): impede a água de aparecer dentro do barco. */
  cockpitLid: Mesh;
  meshes: Mesh[];
}

// ---------------- forma do casco ----------------
export const Z_STERN = -2.95;
export const Z_BOW = 3.2;
const ZC0 = -2.45, ZC1 = 1.15;       // limites do cockpit
const FLOOR = 0.02;                  // piso do cockpit (acima da linha d'água ≈ -0.23)
const halfBeam = (z: number) => z <= 0 ? 1.13 - 0.06 * (z / Z_STERN) : 1.13 * Math.pow(Math.max(0, 1 - (z / Z_BOW) ** 2.3), 0.55);
const keelY = (z: number) => -0.47 + 0.62 * Math.pow(smoothstep(0.6, Z_BOW, z), 1.7);
const chineY = (z: number) => -0.25 + 0.55 * Math.pow(smoothstep(1.0, Z_BOW, z), 1.5);
const sheerY = (z: number) => 0.44 + 0.2 * Math.pow(smoothstep(-0.5, Z_BOW, z), 2.2);
const inBeam = (z: number) => Math.max(0.25, halfBeam(z) - 0.16);

const hullHalfSection = (z: number): [number, number][] => {
  const hb = Math.max(halfBeam(z), 0.001);
  const k = keelY(z), s = sheerY(z), c = Math.min(chineY(z), s - 0.03);
  const ch = hb * 0.93;
  return [
    [0.28 * ch, k + (c - k) * 0.3], [0.3 * ch, k + (c - k) * 0.3 + 0.012],       // strake 1
    [0.6 * ch, k + (c - k) * 0.63], [0.62 * ch, k + (c - k) * 0.63 + 0.012],     // strake 2
    [ch, c], [ch + 0.03 * (hb / 1.13), c + 0.015],                              // quina (chine)
    ...topside(ch + 0.03 * (hb / 1.13), c + 0.015, hb, s),                      // costado com flare
  ];
};
/** Costado amostrado densamente (faixas de pintura nítidas com cores por vértice). */
const topside = (xl: number, yl: number, hb: number, s: number): [number, number][] => {
  const out: [number, number][] = [];
  const N = 16;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    out.push([xl + (hb - xl) * (1 - (1 - t) ** 2.2), yl + (s - yl) * t]);
  }
  return out;
};
const hullSection = (z: number): Vector3[] => {
  const half = hullHalfSection(z);
  const pts: Vector3[] = [];
  for (let i = half.length - 1; i >= 0; i--) pts.push(new Vector3(-half[i][0], half[i][1], z));
  pts.push(new Vector3(0, keelY(z), z));
  for (const [x, y] of half) pts.push(new Vector3(x, y, z));
  return pts;
};

// ---------------- utilitários ----------------
const colorize = (m: Mesh, fn: (x: number, y: number, z: number) => Color3) => {
  const p = m.getVerticesData(VertexBuffer.PositionKind)!;
  const c: number[] = [];
  for (let i = 0; i < p.length; i += 3) { const col = fn(p[i], p[i + 1], p[i + 2]); c.push(col.r, col.g, col.b, 1); }
  m.setVerticesData(VertexBuffer.ColorKind, c);
};

const roundedRect = (w: number, h: number, r: number, seg = 4): Vector3[] => {
  const pts: Vector3[] = [];
  const rr = Math.min(r, w / 2, h / 2);
  const corners: [number, number, number][] = [[w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, Math.PI / 2], [-w / 2 + rr, -h / 2 + rr, Math.PI], [w / 2 - rr, -h / 2 + rr, 1.5 * Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) {
    const a = a0 + (i / seg) * (Math.PI / 2);
    pts.push(new Vector3(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0));
  }
  pts.push(pts[0].clone());
  return pts;
};

/** Bloco com arestas arredondadas (perfil em XY extrudado em Z). */
const roundedBox = (name: string, scene: Scene, w: number, h: number, d: number, r: number): Mesh =>
  MeshBuilder.ExtrudeShape(name, { shape: roundedRect(w, h, r), path: [new Vector3(0, 0, -d / 2), new Vector3(0, 0, d / 2)], cap: Mesh.CAP_ALL, sideOrientation: Mesh.DOUBLESIDE }, scene);

const pbr = (scene: Scene, name: string, color: Color3, metallic: number, roughness: number, clearCoat = 0): PBRMaterial => {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = color;
  m.metallic = metallic;
  m.roughness = roughness;
  if (clearCoat > 0) { m.clearCoat.isEnabled = true; m.clearCoat.intensity = clearCoat; m.clearCoat.roughness = 0.05; }
  m.environmentIntensity = 0.9;
  return m;
};

const dialTexture = (scene: Scene, name: string, max: number, step: number, label: string): DynamicTexture => {
  const S = 256;
  const t = new DynamicTexture(name, { width: S, height: S }, scene, true);
  const c = t.getContext() as CanvasRenderingContext2D;
  c.fillStyle = "#0b0d10"; c.fillRect(0, 0, S, S);
  c.beginPath(); c.arc(S / 2, S / 2, S * 0.48, 0, Math.PI * 2); c.fillStyle = "#14181d"; c.fill();
  c.lineWidth = 6; c.strokeStyle = "#c9d2da"; c.stroke();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  for (let v = 0; v <= max + 1e-6; v += step / 2) {
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    const a = a0 + (v / max) * (a1 - a0);
    const r0 = S * (major ? 0.36 : 0.4), r1 = S * 0.45;
    c.beginPath(); c.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0); c.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1);
    c.lineWidth = major ? 5 : 2; c.strokeStyle = v > max * 0.85 ? "#ff5a4e" : "#f2f5f7"; c.stroke();
    if (major) {
      c.fillStyle = "#f2f5f7"; c.font = "bold 26px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(String(Math.round(v)), S / 2 + Math.cos(a) * S * 0.27, S / 2 + Math.sin(a) * S * 0.27);
    }
  }
  c.fillStyle = "#9fb0bd"; c.font = "18px sans-serif"; c.textAlign = "center"; c.fillText(label, S / 2, S * 0.72);
  t.update();
  return t;
};

// ---------------- construção ----------------
export const buildBoat = (scene: Scene): BoatVisual => {
  const root = new TransformNode("boat", scene);
  const meshes: Mesh[] = [];
  const add = (m: Mesh, mat: StandardMaterial | PBRMaterial, parent: TransformNode = root) => { m.material = mat; m.parent = parent; meshes.push(m); return m; };

  const gelcoat = pbr(scene, "gelcoat", new Color3(1, 1, 1), 0, 0.22, 1);
  gelcoat.backFaceCulling = false;
  const linerMat = pbr(scene, "liner", new Color3(1, 1, 1), 0, 0.55);
  linerMat.backFaceCulling = false;
  const steel = pbr(scene, "stainless", new Color3(0.92, 0.93, 0.95), 0.9, 0.22);
  const blackGloss = pbr(scene, "blackGloss", new Color3(0.03, 0.035, 0.04), 0, 0.2, 0.8);
  const blackMatte = pbr(scene, "blackMatte", new Color3(0.05, 0.05, 0.055), 0, 0.6);
  const vinyl = pbr(scene, "vinyl", new Color3(0.93, 0.91, 0.86), 0, 0.42);
  const vinylNavy = pbr(scene, "vinylNavy", new Color3(0.06, 0.12, 0.25), 0, 0.45);
  const teak = pbr(scene, "teak", new Color3(0.55, 0.36, 0.2), 0, 0.6);
  const glass = pbr(scene, "glass", new Color3(0.2, 0.3, 0.33), 0, 0.03);
  glass.alpha = 0.28;
  glass.backFaceCulling = false;

  const WHITE = new Color3(0.95, 0.96, 0.97), NAVY = new Color3(0.05, 0.12, 0.3), RED = new Color3(0.75, 0.06, 0.08);
  const SILVER = new Color3(0.72, 0.75, 0.78);
  const hullColor = (_x: number, y: number, z: number) => {
    const s = sheerY(z), c = chineY(z);
    if (y > s - 0.07) return WHITE;
    if (y > s - 0.1) return SILVER;                    // filete
    if (y > Math.max(c + 0.08, -0.05)) return NAVY;    // costado azul-marinho
    if (y > -0.2 && y < -0.14) return RED;             // faixa de linha d'água
    return WHITE;                                      // fundo
  };

  // ---------- casco ----------
  const NS = 46;
  const zs: number[] = [];
  for (let i = 0; i <= NS; i++) { const t = i / NS; zs.push(Z_STERN + (Z_BOW - Z_STERN) * (1 - Math.pow(1 - t, 1.25))); }
  const hull = add(MeshBuilder.CreateRibbon("hull", { pathArray: zs.map(hullSection), sideOrientation: Mesh.DOUBLESIDE }, scene), gelcoat);
  colorize(hull, hullColor);

  // espelho de popa
  const tSec = hullSection(Z_STERN);
  const tp: number[] = [], ti: number[] = [];
  for (const v of tSec) tp.push(v.x, v.y, v.z);
  tp.push(0, sheerY(Z_STERN), Z_STERN);
  for (let i = 0; i < tSec.length - 1; i++) ti.push(tSec.length, i, i + 1);
  const transom = new Mesh("transom", scene);
  const tvd = new VertexData(); tvd.positions = tp; tvd.indices = ti;
  const tn: number[] = []; VertexData.ComputeNormals(tp, ti, tn); tvd.normals = tn;
  tvd.applyToMesh(transom);
  add(transom, gelcoat);
  colorize(transom, (x, y, z) => hullColor(x, y, z));

  // verdugo (borda de proteção) em inox/borracha
  const railPath = (side: number) => zs.filter((z) => z < Z_BOW - 0.02).map((z) => new Vector3(side * (halfBeam(z) + 0.015), sheerY(z) - 0.03, z));
  for (const side of [-1, 1]) add(MeshBuilder.CreateTube("rubRail", { path: railPath(side), radius: 0.028, tessellation: 8, cap: Mesh.CAP_ALL }, scene), blackMatte);

  // ---------- conveses ----------
  const deckSecFore = (z: number) => { const hb = halfBeam(z), s = sheerY(z); return [new Vector3(-hb, s, z), new Vector3(-hb * 0.5, s + 0.05, z), new Vector3(0, s + 0.075, z), new Vector3(hb * 0.5, s + 0.05, z), new Vector3(hb, s, z)]; };
  const foreZ = zs.filter((z) => z >= ZC1 - 0.01);
  const foredeck = add(MeshBuilder.CreateRibbon("foredeck", { pathArray: [deckSecFore(ZC1), ...foreZ.map(deckSecFore)], sideOrientation: Mesh.DOUBLESIDE }, scene), gelcoat);
  colorize(foredeck, () => WHITE);
  const aftZ = [Z_STERN, -2.8, -2.65, ZC0];
  const aftDeck = add(MeshBuilder.CreateRibbon("aftdeck", { pathArray: aftZ.map((z) => { const hb = halfBeam(z), s = sheerY(z); return [new Vector3(-hb, s, z), new Vector3(0, s + 0.015, z), new Vector3(hb, s, z)]; }), sideOrientation: Mesh.DOUBLESIDE }, scene), gelcoat);
  colorize(aftDeck, () => WHITE);

  // ---------- cockpit (forro interno, piso, bordas) ----------
  const ckZ: number[] = [];
  for (let i = 0; i <= 24; i++) ckZ.push(ZC0 + (ZC1 - ZC0) * (i / 24));
  const linerSec = (z: number) => {
    const w = inBeam(z), s = sheerY(z) - 0.03;
    return [new Vector3(-w, s, z), new Vector3(-w + 0.03, FLOOR + 0.2, z), new Vector3(-w + 0.1, FLOOR, z), new Vector3(w - 0.1, FLOOR, z), new Vector3(w - 0.03, FLOOR + 0.2, z), new Vector3(w, s, z)];
  };
  const liner = add(MeshBuilder.CreateRibbon("liner", { pathArray: ckZ.map(linerSec), sideOrientation: Mesh.DOUBLESIDE }, scene), linerMat);
  const FLOORC = new Color3(0.72, 0.71, 0.66), WALL = new Color3(0.93, 0.93, 0.92), PAD = new Color3(0.86, 0.84, 0.79);
  colorize(liner, (_x, y, z) => (y < FLOOR + 0.01 ? FLOORC : y > sheerY(z) - 0.3 ? PAD : WALL));
  for (const side of [-1, 1]) {
    const cap = add(MeshBuilder.CreateRibbon("gunwale", { pathArray: ckZ.map((z) => [new Vector3(side * halfBeam(z), sheerY(z), z), new Vector3(side * inBeam(z), sheerY(z) - 0.03, z)]), sideOrientation: Mesh.DOUBLESIDE }, scene), gelcoat);
    colorize(cap, () => WHITE);
  }
  for (const z of [ZC0, ZC1]) {
    const sec = linerSec(z);
    const top = sec.map((p) => new Vector3(p.x, sheerY(z) - 0.03 + (z === ZC1 ? 0.07 : 0), z));
    const wall = add(MeshBuilder.CreateRibbon("bulkhead", { pathArray: [sec, top], sideOrientation: Mesh.DOUBLESIDE }, scene), linerMat);
    colorize(wall, () => WALL);
  }
  // tampa só-profundidade (a água não aparece dentro do cockpit)
  const lidMat = new StandardMaterial("lidMat", scene);
  lidMat.disableColorWrite = true;
  lidMat.forceDepthWrite = true;
  lidMat.alpha = 0.01;
  lidMat.backFaceCulling = false;
  const cockpitLid = MeshBuilder.CreateRibbon("cockpitLid", { pathArray: ckZ.map((z) => [new Vector3(-inBeam(z), sheerY(z) - 0.03, z), new Vector3(inBeam(z), sheerY(z) - 0.03, z)]) }, scene);
  cockpitLid.material = lidMat;
  cockpitLid.parent = root;
  cockpitLid.alphaIndex = 0;

  // ---------- para-brisa envolvente ----------
  const zW = ZC1 + 0.18;
  const base: Vector3[] = [], top: Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * 2 - 1;
    const z = zW - 0.5 * t * t;
    const hb = halfBeam(z) - 0.1;
    const x = t * hb;
    const y = sheerY(z) + 0.075 * (1 - (x / halfBeam(z)) ** 2) + 0.005;
    base.push(new Vector3(x, y, z));
    top.push(new Vector3(x * 0.94, y + 0.46 - 0.06 * t * t, z - 0.34));
  }
  add(MeshBuilder.CreateRibbon("windshield", { pathArray: [base, top], sideOrientation: Mesh.DOUBLESIDE }, scene), glass);
  add(MeshBuilder.CreateTube("wsTop", { path: top, radius: 0.016, tessellation: 8, cap: Mesh.CAP_ALL }, scene), steel);
  add(MeshBuilder.CreateTube("wsBase", { path: base, radius: 0.014, tessellation: 6 }, scene), blackMatte);
  for (const i of [0, 8, 16]) add(MeshBuilder.CreateTube("wsPost", { path: [base[i], top[i]], radius: 0.014, tessellation: 6 }, scene), steel);

  // ---------- consoles, painel, volante, instrumentos ----------
  const helmX = 0.5;
  const helm = add(roundedBox("helmConsole", scene, 0.62, 0.7, 0.55, 0.09), gelcoat);
  helm.position.set(helmX, FLOOR + 0.35, 0.78);
  colorize(helm, () => WHITE);
  const pax = add(roundedBox("paxConsole", scene, 0.55, 0.58, 0.5, 0.09), gelcoat);
  pax.position.set(-0.5, FLOOR + 0.29, 0.8);
  colorize(pax, () => WHITE);

  const dash = new TransformNode("dash", scene);
  dash.parent = root;
  dash.position.set(helmX, FLOOR + 0.76, 0.55);
  dash.rotation.x = 0.55; // topo inclinado para o piloto
  const panel = add(roundedBox("dashPanel", scene, 0.6, 0.3, 0.04, 0.03), blackGloss, dash);
  panel.position.z = 0.02;
  const gauge = (name: string, x: number, tex: DynamicTexture) => {
    const face = MeshBuilder.CreatePlane(name, { size: 0.15 }, scene);
    const fm = new StandardMaterial(name + "Mat", scene);
    fm.diffuseTexture = tex; fm.emissiveTexture = tex; fm.emissiveColor = new Color3(0.5, 0.5, 0.5);
    fm.specularColor = new Color3(0.4, 0.4, 0.4);
    add(face, fm, dash);
    face.position.set(x, 0.01, -0.002);
    const bezel = add(MeshBuilder.CreateTorus(name + "Bezel", { diameter: 0.152, thickness: 0.012, tessellation: 24 }, scene), steel, dash);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(x, 0.01, -0.004);
    const pivot = new TransformNode(name + "Pivot", scene);
    pivot.parent = dash;
    pivot.position.set(x, 0.01, -0.008);
    const needle = add(MeshBuilder.CreateBox(name + "Needle", { width: 0.005, height: 0.06, depth: 0.003 }, scene), pbr(scene, "needle", new Color3(1, 0.3, 0.1), 0, 0.4), pivot);
    needle.position.y = 0.025;
    const nm = needle.material as PBRMaterial; nm.emissiveColor = new Color3(0.8, 0.2, 0.05);
    return pivot;
  };
  const speedNeedle = gauge("speedo", -0.14, dialTexture(scene, "speedoTex", 100, 20, "km/h"));
  const rpmNeedle = gauge("tacho", 0.14, dialTexture(scene, "tachoTex", 7, 1, "x1000 rpm"));

  const wheelMount = new TransformNode("wheelMount", scene);
  wheelMount.parent = root;
  wheelMount.position.set(helmX, FLOOR + 0.86, 0.42);
  wheelMount.rotation.x = 0.55;
  add(MeshBuilder.CreateCylinder("column", { height: 0.18, diameter: 0.04 }, scene), blackMatte, wheelMount).rotation.x = Math.PI / 2;
  const wheel = new TransformNode("wheel", scene);
  wheel.parent = wheelMount;
  wheel.position.z = -0.09;
  const rim = add(MeshBuilder.CreateTorus("wheelRim", { diameter: 0.36, thickness: 0.03, tessellation: 32 }, scene), blackMatte, wheel);
  rim.rotation.x = Math.PI / 2;
  add(MeshBuilder.CreateCylinder("hub", { height: 0.04, diameter: 0.07 }, scene), steel, wheel).rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const spoke = add(MeshBuilder.CreateBox("spoke", { width: 0.16, height: 0.018, depth: 0.012 }, scene), steel, wheel);
    spoke.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0);
    spoke.rotation.z = a;
  }
  const throttleLever = add(MeshBuilder.CreateBox("throttle", { width: 0.03, height: 0.16, depth: 0.03 }, scene), steel);
  throttleLever.position.set(helmX + 0.36, FLOOR + 0.72, 0.62);
  throttleLever.rotation.x = 0.4;

  // ---------- bancos ----------
  const seat = (x: number) => {
    add(MeshBuilder.CreateCylinder("pedestal", { height: 0.32, diameter: 0.09 }, scene), steel).position.set(x, FLOOR + 0.16, -0.22);
    const cushion = add(roundedBox("cushion", scene, 0.52, 0.12, 0.5, 0.05), vinyl);
    cushion.position.set(x, FLOOR + 0.38, -0.22);
    const back = add(roundedBox("seatBack", scene, 0.52, 0.48, 0.11, 0.05), vinyl);
    back.position.set(x, FLOOR + 0.66, -0.5);
    back.rotation.x = -0.18;
    const shell = add(roundedBox("seatShell", scene, 0.54, 0.4, 0.05, 0.04), vinylNavy);
    shell.position.set(x, FLOOR + 0.64, -0.575);
    shell.rotation.x = -0.18;
  };
  seat(helmX);
  seat(-0.5);
  const benchW = inBeam(-2.2) * 2 - 0.06;
  add(roundedBox("benchCushion", scene, benchW, 0.13, 0.5, 0.05), vinyl).position.set(0, FLOOR + 0.36, -2.15);
  add(roundedBox("benchBase", scene, benchW, 0.3, 0.46, 0.04), gelcoat).position.set(0, FLOOR + 0.15, -2.15);
  const benchBack = add(roundedBox("benchBack", scene, benchW, 0.36, 0.1, 0.05), vinylNavy);
  benchBack.position.set(0, FLOOR + 0.62, -2.42);
  benchBack.rotation.x = -0.12;

  // ---------- guarda-mancebo, cabeços, plataformas ----------
  const railPts: Vector3[] = [];
  const rz0 = 1.75, rz1 = Z_BOW - 0.28;
  for (let i = 0; i <= 10; i++) { const z = rz0 + (rz1 - rz0) * (i / 10); railPts.push(new Vector3(-(halfBeam(z) - 0.09), sheerY(z) + 0.3, z)); }
  railPts.push(new Vector3(0, sheerY(Z_BOW - 0.12) + 0.3, Z_BOW - 0.12));
  for (let i = 10; i >= 0; i--) { const z = rz0 + (rz1 - rz0) * (i / 10); railPts.push(new Vector3(halfBeam(z) - 0.09, sheerY(z) + 0.3, z)); }
  add(MeshBuilder.CreateTube("bowRail", { path: railPts, radius: 0.016, tessellation: 8, cap: Mesh.CAP_ALL }, scene), steel);
  for (const z of [rz0, (rz0 + rz1) / 2, rz1]) for (const side of [-1, 1]) {
    const x = side * (halfBeam(z) - 0.09), y = sheerY(z);
    add(MeshBuilder.CreateTube("stanchion", { path: [new Vector3(x, y, z), new Vector3(x, y + 0.3, z)], radius: 0.013, tessellation: 6 }, scene), steel);
  }
  const cleat = (x: number, z: number) => {
    const y = sheerY(z);
    add(MeshBuilder.CreateCapsule("cleat", { radius: 0.018, height: 0.16, orientation: new Vector3(0, 0, 1) }, scene), steel).position.set(x, y + 0.035, z);
  };
  cleat(-0.85, -2.65); cleat(0.85, -2.65); cleat(0, 2.85);
  for (const side of [-1, 1]) {
    const plat = add(MeshBuilder.CreateBox("swimPlatform", { width: 0.62, height: 0.05, depth: 0.42 }, scene), teak);
    plat.position.set(side * 0.68, -0.08, Z_STERN - 0.21);
    add(MeshBuilder.CreateBox("platformBracket", { width: 0.5, height: 0.04, depth: 0.42 }, scene), blackMatte).position.set(side * 0.68, -0.12, Z_STERN - 0.21);
  }
  // escada de banho
  for (const dx of [-0.08, 0.08]) add(MeshBuilder.CreateTube("ladder", { path: [new Vector3(0.68 + dx, -0.05, Z_STERN - 0.4), new Vector3(0.68 + dx, -0.45, Z_STERN - 0.45)], radius: 0.012, tessellation: 6 }, scene), steel);

  // ---------- luzes de navegação ----------
  const mkLight = (name: string, c: Color3, pos: Vector3, d = 0.06) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = c.scale(0.5);
    m.specularColor = new Color3(0.8, 0.8, 0.8);
    m.emissiveColor = Color3.Black();
    const s = MeshBuilder.CreateSphere(name + "Mesh", { diameter: d, segments: 8 }, scene);
    s.position.copyFrom(pos); s.material = m; s.parent = root; meshes.push(s);
    return m;
  };
  const yb = sheerY(2.75) + 0.09;
  add(MeshBuilder.CreateBox("bowLightBase", { width: 0.12, height: 0.05, depth: 0.08 }, scene), steel).position.set(0, yb - 0.03, 2.75);
  const lights = {
    port: mkLight("navPort", new Color3(1, 0.05, 0.05), new Vector3(-0.035, yb, 2.75)),
    star: mkLight("navStar", new Color3(0.05, 1, 0.2), new Vector3(0.035, yb, 2.75)),
    stern: mkLight("navStern", new Color3(1, 1, 1), new Vector3(0, 1.32, -2.62), 0.08),
  };
  add(MeshBuilder.CreateCylinder("lightPole", { height: 0.82, diameter: 0.025 }, scene), steel).position.set(0, sheerY(-2.62) + 0.43, -2.62);

  // ---------- piloto ----------
  const skin = pbr(scene, "skin", new Color3(0.82, 0.62, 0.48), 0, 0.6);
  const vest = pbr(scene, "vest", new Color3(1, 0.42, 0.05), 0, 0.5);
  const shorts = pbr(scene, "shorts", new Color3(0.12, 0.2, 0.32), 0, 0.7);
  const torso = add(MeshBuilder.CreateCapsule("pilotTorso", { radius: 0.17, height: 0.62 }, scene), vest);
  torso.position.set(helmX, FLOOR + 0.74, -0.3);
  torso.rotation.x = 0.12;
  add(MeshBuilder.CreateSphere("pilotHead", { diameter: 0.24, segments: 12 }, scene), skin).position.set(helmX, FLOOR + 1.16, -0.25);
  const capM = add(MeshBuilder.CreateSphere("pilotCap", { diameter: 0.255, segments: 10, slice: 0.5 }, scene), vinylNavy);
  capM.position.set(helmX, FLOOR + 1.19, -0.25);
  add(MeshBuilder.CreateBox("capBrim", { width: 0.2, height: 0.012, depth: 0.12 }, scene), vinylNavy).position.set(helmX, FLOOR + 1.2, -0.12);
  for (const side of [-1, 1]) {
    const sh = new Vector3(helmX + side * 0.18, FLOOR + 0.92, -0.28);
    const hand = new Vector3(helmX + side * 0.14, FLOOR + 0.84, 0.34);
    add(MeshBuilder.CreateTube("arm", { path: [sh, Vector3.Lerp(sh, hand, 0.5).add(new Vector3(side * 0.05, -0.08, 0)), hand], radius: 0.045, tessellation: 8, cap: Mesh.CAP_ALL }, scene), skin);
    add(MeshBuilder.CreateTube("leg", { path: [new Vector3(helmX + side * 0.1, FLOOR + 0.44, -0.2), new Vector3(helmX + side * 0.1, FLOOR + 0.44, 0.15), new Vector3(helmX + side * 0.1, FLOOR + 0.05, 0.25)], radius: 0.06, tessellation: 8, cap: Mesh.CAP_ALL }, scene), shorts);
  }

  // ---------- motor de popa (pivô no espelho) ----------
  const engine = new TransformNode("enginePivot", scene);
  engine.parent = root;
  engine.position.set(0, 0.28, Z_STERN - 0.04);
  add(MeshBuilder.CreateBox("bracket", { width: 0.24, height: 0.36, depth: 0.12 }, scene), blackMatte, engine).position.set(0, -0.06, -0.05);
  // capô: loft de seções arredondadas
  const cowlSecs: Vector3[][] = [];
  const NC = 18;
  for (let i = 0; i <= NC; i++) {
    const t = i / NC;
    const z = -0.1 - 0.74 * t;
    const end = Math.sqrt(smoothstep(0, 0.2, t) * smoothstep(1, 0.8, t));
    const w = 0.48 * (0.45 + 0.55 * end);
    const h = 0.56 * (0.55 + 0.45 * end) + 0.06 * t;  // traseira um pouco mais alta
    const yc = 0.5 + 0.03 * t;
    const sec = roundedRect(w, h, 0.1 * (0.5 + 0.5 * end), 5).map((p) => new Vector3(p.x, p.y + yc, z));
    cowlSecs.push(i === 0 || i === NC ? sec.map(() => new Vector3(0, yc, z)) : sec);
  }
  const cowl = add(MeshBuilder.CreateRibbon("cowl", { pathArray: cowlSecs, sideOrientation: Mesh.DOUBLESIDE }, scene), gelcoat, engine);
  colorize(cowl, (x, y) => (y > 0.5 && y < 0.54 && Math.abs(x) > 0.18 ? RED : y > 0.43 && y < 0.5 && Math.abs(x) > 0.2 ? NAVY : y < 0.29 ? new Color3(0.08, 0.08, 0.09) : WHITE));
  const lowerCowl = add(roundedBox("lowerCowl", scene, 0.4, 0.2, 0.62, 0.06), blackGloss, engine);
  lowerCowl.position.set(0, 0.17, -0.46);
  // seção intermediária e pé (perfil elíptico "aerofólio")
  const mid = add(MeshBuilder.CreateCylinder("midsection", { height: 1.0, diameter: 1, tessellation: 20 }, scene), blackGloss, engine);
  mid.scaling.set(0.11, 1, 0.32);
  mid.position.set(0, -0.35, -0.38);
  const plate = add(MeshBuilder.CreateCylinder("antiVentPlate", { height: 0.018, diameter: 1, tessellation: 28 }, scene), blackGloss, engine);
  plate.scaling.set(0.34, 1, 0.56);
  plate.position.set(0, -0.79, -0.42);
  const torpedo = add(MeshBuilder.CreateCapsule("gearcase", { radius: 0.072, height: 0.56, orientation: new Vector3(0, 0, 1) }, scene), blackGloss, engine);
  torpedo.position.set(0, -1.03, -0.36);
  const strut = add(MeshBuilder.CreateCylinder("lowerStrut", { height: 0.26, diameter: 1, tessellation: 16 }, scene), blackGloss, engine);
  strut.scaling.set(0.08, 1, 0.26);
  strut.position.set(0, -0.92, -0.36);
  const skeg = add(MeshBuilder.CreateBox("skeg", { width: 0.018, height: 0.22, depth: 0.2 }, scene), blackGloss, engine);
  skeg.position.set(0, -1.18, -0.42);
  skeg.rotation.x = 0.25;
  // anodo / detalhe
  add(MeshBuilder.CreateBox("trimTab", { width: 0.02, height: 0.05, depth: 0.12 }, scene), steel, engine).position.set(0, -0.83, -0.66);

  // ---------- hélice de 3 pás (passo, torção e skew reais) ----------
  const propeller = new TransformNode("propeller", scene);
  propeller.parent = engine;
  propeller.position.set(0, -1.03, -0.66);
  const R = 0.19, RH = 0.05, PITCH = 0.48;
  for (let b = 0; b < 3; b++) {
    const th0 = (b / 3) * Math.PI * 2;
    const paths: Vector3[][] = [];
    const NR = 10, NSs = 8;
    for (let i = 0; i <= NR; i++) {
      const u = i / NR, r = RH + (R - RH) * u;
      const chord = (0.07 + 0.12 * Math.sin(Math.PI * (0.12 + 0.72 * u))) * Math.sqrt(Math.max(0.04, 1 - u ** 6));
      const phi = Math.atan(PITCH / (2 * Math.PI * r));
      const skew = 0.38 * u * u;
      const row: Vector3[] = [];
      for (let j = 0; j <= NSs; j++) {
        const sN = j / NSs - 0.5;
        const a = sN * chord;
        const th = th0 + skew + (a * Math.cos(phi)) / r;
        const thick = (0.012 * (1 - u) + 0.003) * Math.cos(Math.PI * sN);
        row.push(new Vector3(r * Math.cos(th), r * Math.sin(th), -a * Math.sin(phi) - 0.025 * u + thick * 0.5));
      }
      paths.push(row);
    }
    add(MeshBuilder.CreateRibbon("blade", { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE }, scene), steel, propeller);
  }
  const hub = add(MeshBuilder.CreateCylinder("propHub", { height: 0.17, diameterTop: 0.1, diameterBottom: 0.11, tessellation: 16 }, scene), steel, propeller);
  hub.rotation.x = Math.PI / 2;
  const cone = add(MeshBuilder.CreateCylinder("propCone", { height: 0.08, diameterTop: 0.02, diameterBottom: 0.1, tessellation: 16 }, scene), steel, propeller);
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = -0.12;
  const propBlur = pbr(scene, "propBlur", new Color3(0.75, 0.78, 0.8), 1, 0.35);
  propBlur.alpha = 0;
  propBlur.backFaceCulling = false;
  const disc = MeshBuilder.CreateDisc("propDisc", { radius: R, tessellation: 32 }, scene);
  disc.material = propBlur;
  disc.parent = engine;
  disc.position.set(0, -1.03, -0.66);
  meshes.push(disc);

  for (const m of meshes) m.isPickable = false;
  return { root, engine, propeller, propBlur, wheel, speedNeedle, rpmNeedle, lights, cockpitLid, meshes };
};

export const setNavLights = (v: BoatVisual, on: boolean): void => {
  v.lights.port.emissiveColor = on ? new Color3(1, 0.05, 0.05) : Color3.Black();
  v.lights.star.emissiveColor = on ? new Color3(0.1, 1, 0.25) : Color3.Black();
  v.lights.stern.emissiveColor = on ? new Color3(1, 1, 1) : Color3.Black();
};

/** Ângulo do ponteiro (rad) para valor/máx: 135° → 405° do mostrador. */
export const needleAngle = (value: number, max: number): number => {
  const f = Math.min(Math.max(value / max, 0), 1.02);
  return Math.PI * 0.75 + f * Math.PI * 1.5 - Math.PI / 2;
};

