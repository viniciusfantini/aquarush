// Frota de exposição no estacionamento de cima (mockups estáticos): jet ski, pontoon (tritoon), catamarã
// fisher, lancha cabinada de 50 pés (flybridge) e lancha offshore — cada uma na sua carretinha, engatada no
// veículo de reboque. Só visual (o obstáculo do carro fica em sim/station.ts). Tudo procedural, sem marcas.
//
// Modelagem:
//  • casco = loft de seções (quilha → fundo em V → quina → costado com flare → borda), afinando na proa
//    em elipse e com a quilha subindo; o costado é recortado em FAIXAS por nível (antivegetativa, faixa de
//    flutuação, costado, faixa da borda) — cada faixa vira uma malha com o seu material, com bordas exatas;
//  • espelho de popa, convés abaulado com poço (cockpit) e verdugo fecham o casco;
//  • superestrutura = loft de seções com faixa de vidro e para-brisa inclinado;
//  • no fim tudo é mesclado por material (poucas chamadas de desenho, bom para o celular).

import { type Scene, Mesh, MeshBuilder, PBRMaterial, StandardMaterial, Color3, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core";
import { LOT } from "../sim/world.ts";
import { FLEET, type FleetKind } from "../sim/station.ts";
import { pbr, roundedRect, roundedBox, buildPropeller } from "./boatMesh.ts";
import { buildCar, buildPickup } from "./ramp.ts";
import { smoothstep } from "../sim/math.ts";

export type Mat = PBRMaterial | StandardMaterial;
type P2 = [number, number];
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const C = (r: number, g: number, b: number) => new Color3(r, g, b);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Interpolação suave (cosseno) entre quadros-chave [t, valor]. */
const key = (t: number, kf: P2[]): number => {
  if (t <= kf[0][0]) return kf[0][1];
  for (let i = 1; i < kf.length; i++) {
    if (t <= kf[i][0]) {
      const [t0, v0] = kf[i - 1], [t1, v1] = kf[i];
      const u = (t - t0) / Math.max(1e-6, t1 - t0);
      return lerp(v0, v1, (1 - Math.cos(Math.PI * u)) / 2);
    }
  }
  return kf[kf.length - 1][1];
};

// ---------------------------------------------------------------- materiais
export const makeMats = (scene: Scene) => {
  const glow = (name: string, c: Color3) => { const m = pbr(scene, name, c, 0, 0.4); m.emissiveColor = c; return m; };
  return {
    galv: pbr(scene, "fGalv", C(0.7, 0.72, 0.74), 0.85, 0.42),
    steelDark: pbr(scene, "fSteelD", C(0.1, 0.1, 0.11), 0.6, 0.5),
    tire: pbr(scene, "fTire", C(0.035, 0.035, 0.04), 0, 0.9),
    rim: pbr(scene, "fRim", C(0.86, 0.87, 0.89), 0.55, 0.28, 0.6),
    carpet: pbr(scene, "fCarpet", C(0.08, 0.1, 0.14), 0, 0.97),
    white: pbr(scene, "fWhite", C(0.93, 0.93, 0.92), 0, 0.28, 1),
    offwhite: pbr(scene, "fOffW", C(0.86, 0.85, 0.82), 0, 0.45, 0.5),
    glass: pbr(scene, "fGlass", C(0.015, 0.03, 0.045), 0.7, 0.05, 1),
    black: pbr(scene, "fBlack", C(0.022, 0.022, 0.026), 0, 0.22, 1),
    matte: pbr(scene, "fMatte", C(0.07, 0.075, 0.08), 0, 0.85),
    nonskid: pbr(scene, "fNonskid", C(0.82, 0.82, 0.8), 0, 0.85),
    steel: pbr(scene, "fSteel", C(0.86, 0.87, 0.89), 1, 0.12),
    teak: pbr(scene, "fTeak", C(0.52, 0.33, 0.17), 0, 0.62),
    cushion: pbr(scene, "fCushion", C(0.9, 0.87, 0.8), 0, 0.55),
    navy: pbr(scene, "fNavy", C(0.025, 0.06, 0.15), 0.2, 0.28, 1),
    canvas: pbr(scene, "fCanvas", C(0.05, 0.09, 0.17), 0, 0.85),
    antifoul: pbr(scene, "fAntifoul", C(0.05, 0.07, 0.13), 0, 0.75),
    gunmetal: pbr(scene, "fGunmetal", C(0.17, 0.19, 0.22), 0.75, 0.28, 1),
    red: pbr(scene, "fRed", C(0.78, 0.035, 0.03), 0.1, 0.28, 1),
    yellow: pbr(scene, "fYellow", C(1, 0.7, 0.02), 0, 0.3, 1),
    lime: pbr(scene, "fLime", C(0.42, 0.85, 0.04), 0, 0.3, 1),
    steelBlue: pbr(scene, "fSteelBlue", C(0.1, 0.24, 0.38), 0.55, 0.28, 1),
    alu: pbr(scene, "fAlu", C(0.8, 0.82, 0.84), 0.9, 0.3),
    strap: pbr(scene, "fStrap", C(0.08, 0.2, 0.6), 0, 0.7),
    wood: pbr(scene, "fWood", C(0.42, 0.28, 0.14), 0, 0.85),
    hydraulic: pbr(scene, "fHyd", C(0.95, 0.68, 0.04), 0.3, 0.4),
    truck: pbr(scene, "fTruck", C(0.5, 0.025, 0.035), 0.45, 0.28, 1),
    lightRed: glow("fLightR", C(0.9, 0.05, 0.03)),
    lightAmber: glow("fLightA", C(1, 0.5, 0.05)),
    lightWhite: glow("fLightW", C(0.95, 0.95, 0.9)),
  };
};
export type Mats = ReturnType<typeof makeMats>;

// ---------------------------------------------------------------- kit de primitivas
export interface Kit {
  scene: Scene;
  out: Mesh[];
  add: (m: Mesh, mat: Mat, parent: TransformNode) => Mesh;
  node: (name: string, parent: TransformNode, x: number, y: number, z: number) => TransformNode;
  box: (w: number, h: number, d: number, x: number, y: number, z: number, mat: Mat, parent: TransformNode) => Mesh;
  rbox: (w: number, h: number, d: number, r: number, x: number, y: number, z: number, mat: Mat, parent: TransformNode) => Mesh;
  beam: (a: Vector3, b: Vector3, w: number, h: number, mat: Mat, parent: TransformNode) => Mesh;
  tube: (path: Vector3[], r: number, mat: Mat, parent: TransformNode, tess?: number) => Mesh;
  cyl: (h: number, d: number, axis: "x" | "y" | "z", x: number, y: number, z: number, mat: Mat, parent: TransformNode, dTop?: number) => Mesh;
  ribbon: (paths: Vector3[][], mat: Mat, parent: TransformNode, closeArray?: boolean) => Mesh;
}

export const makeKit = (scene: Scene): Kit => {
  const out: Mesh[] = [];
  const add = (m: Mesh, mat: Mat, parent: TransformNode) => { m.material = mat; m.parent = parent; out.push(m); return m; };
  const k: Kit = {
    scene, out, add,
    node: (name, parent, x, y, z) => { const n = new TransformNode(name, scene); n.parent = parent; n.position.set(x, y, z); return n; },
    box: (w, h, d, x, y, z, mat, parent) => { const b = add(MeshBuilder.CreateBox("fBox", { width: w, height: h, depth: d }, scene), mat, parent); b.position.set(x, y, z); return b; },
    rbox: (w, h, d, r, x, y, z, mat, parent) => { const b = add(roundedBox("fRBox", scene, w, h, d, r), mat, parent); b.position.set(x, y, z); return b; },
    beam: (a, b, w, h, mat, parent) => {
      const d = b.subtract(a), len = d.length();
      const m = add(MeshBuilder.CreateBox("fBeam", { width: w, height: h, depth: len }, scene), mat, parent);
      m.position.copyFrom(a.add(b).scale(0.5));
      m.rotation.y = Math.atan2(d.x, d.z);
      m.rotation.x = -Math.atan2(d.y, Math.hypot(d.x, d.z));
      return m;
    },
    tube: (path, r, mat, parent, tess = 10) => add(MeshBuilder.CreateTube("fTube", { path, radius: r, tessellation: tess, cap: Mesh.CAP_ALL }, scene), mat, parent),
    cyl: (h, d, axis, x, y, z, mat, parent, dTop) => {
      const c = add(MeshBuilder.CreateCylinder("fCyl", { height: h, diameterBottom: d, diameterTop: dTop ?? d, tessellation: 20 }, scene), mat, parent);
      if (axis === "x") c.rotation.z = Math.PI / 2;
      if (axis === "z") c.rotation.x = Math.PI / 2;
      c.position.set(x, y, z);
      return c;
    },
    ribbon: (paths, mat, parent, closeArray = false) => add(MeshBuilder.CreateRibbon("fRib", { pathArray: paths, closeArray, sideOrientation: Mesh.DOUBLESIDE }, scene), mat, parent),
  };
  return k;
};

/** Loft de seções retangulares arredondadas (capôs, carenagens, cabines, assentos), com tampas. */
export interface RR { z: number; w: number; h: number; y: number; r: number; x?: number }
export const loftRR = (K: Kit, secs: RR[], mat: Mat, parent: TransformNode): Mesh => {
  const paths = secs.map((s) => roundedRect(Math.max(s.w, 0.004), Math.max(s.h, 0.004), s.r, 4).map((p) => V(p.x + (s.x ?? 0), p.y + s.y, s.z)));
  const a = secs[0], b = secs[secs.length - 1];
  paths.unshift(paths[0].map(() => V(a.x ?? 0, a.y, a.z)));
  paths.push(paths[paths.length - 1].map(() => V(b.x ?? 0, b.y, b.z)));
  return K.ribbon(paths, mat, parent);
};
export const loftFn = (n: number, f: (t: number) => RR): RR[] => { const r: RR[] = []; for (let i = 0; i <= n; i++) r.push(f(i / n)); return r; };

// ---------------------------------------------------------------- casco
export interface Band { top: (t: number) => number; mat: Mat }
export interface HullSpec {
  L: number; B: number; D: number;
  dead: number; deadBow?: number;     // tangente do V na popa / na proa
  bowRise?: number; sheerRise?: number; flare?: number; chine?: number; entry?: number; crown?: number; N?: number;
  bands: Band[];                     // de baixo para cima; a última vai até a borda
  deck?: Mat; rub?: Mat; rubR?: number;
  well?: { depth: number; t0: number; t1: number; floor: Mat; gw?: number };
}
export interface Sec { hs: number; s: number; k: number; c: number; hc: number; P: P2[] }
export interface Hull { L: number; z: (t: number) => number; tOf: (z: number) => number; sec: (t: number) => Sec; bottomY: (t: number, x: number) => number; sideX: (t: number, y: number) => number; deckY: (t: number) => number }

const hullSection = (S: HullSpec, t: number): Sec => {
  const entry = S.entry ?? 0.45;
  const ell = (t0: number, p: number) => (t <= t0 ? 1 : Math.pow(Math.max(0, 1 - ((t - t0) / (1 - t0)) ** 2), p));
  const aft = 1 - 0.05 * (1 - smoothstep(0, 0.2, t));
  const chine = S.chine ?? 0.05 * S.B, flare = S.flare ?? 0.07 * S.B;
  const hs = Math.max(0.003, (S.B / 2) * ell(entry, 0.5) * aft);
  const pc = ell(entry * 0.9, 0.7) * aft;
  const hc = Math.max(0.002, (S.B / 2 - flare - chine) * pc);
  const cw = chine * pc;
  const k = (S.bowRise ?? 0.4 * S.D) * Math.pow(smoothstep(entry * 0.55, 1, t), 1.7);
  const d = S.dead + ((S.deadBow ?? S.dead * 1.8) - S.dead) * smoothstep(0.2, 1, t);
  const s = S.D + (S.sheerRise ?? 0.15 * S.D) * t * t;
  const c = Math.min(k + d * hc, k + (s - k) * 0.7);
  const P: P2[] = [];
  for (let j = 0; j <= 6; j++) { const u = j / 6; P.push([hc * u, k + (c - k) * Math.pow(u, 1.15)]); }
  const fl = smoothstep(0.35, 0.95, t); // flare cresce para a proa
  for (let j = 0; j <= 8; j++) {
    const u = j / 8;
    const prof = lerp(Math.pow(u, 0.8), 1 - Math.cos((u * Math.PI) / 2), fl);
    P.push([hc + cw + (hs - hc - cw) * prof, c + (s - c) * u]);
  }
  return { hs, s, k, c, hc, P };
};

/** Recorta o perfil (y não decrescente) entre dois níveis. */
const clipBand = (P: P2[], lo: number, hi: number): P2[] => {
  const r: P2[] = [];
  for (let i = 0; i < P.length; i++) {
    const [x, y] = P[i];
    if (i > 0) {
      const [px, py] = P[i - 1];
      for (const lv of [lo, hi]) if ((py - lv) * (y - lv) < 0) { const u = (lv - py) / (y - py); r.push([px + (x - px) * u, lv]); }
    }
    if (y >= lo && y <= hi) r.push([x, y]);
  }
  if (r.length === 0) return [P[0][1] > hi ? P[0] : P[P.length - 1]];
  return r;
};
/** Reamostra a polilinha em n pontos igualmente espaçados (todas as seções com o mesmo número de pontos). */
const resample = (P: P2[], n: number): P2[] => {
  const L: number[] = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const tot = L[L.length - 1];
  const r: P2[] = [];
  for (let j = 0; j < n; j++) {
    const d = (tot * j) / (n - 1);
    let i = 1;
    while (i < P.length - 1 && L[i] < d) i++;
    const seg = L[i] - L[i - 1];
    const u = seg > 1e-9 ? (d - L[i - 1]) / seg : 0;
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i)];
    r.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u)]);
  }
  return r;
};

export const buildHull = (K: Kit, parent: TransformNode, S: HullSpec): Hull => {
  const N = S.N ?? 64;
  const ts: number[] = [];
  for (let i = 0; i <= N; i++) ts.push(i / N);
  const z = (t: number) => -S.L / 2 + S.L * t;
  const secs = ts.map((t) => hullSection(S, t));
  // costado em faixas
  let lo: (t: number) => number = () => -1e9;
  for (const b of S.bands) {
    const loF = lo, hiF = b.top;
    const prof = secs.map((sc, i) => resample(clipBand(sc.P, loF(ts[i]), hiF(ts[i])), 7));
    for (const side of [1, -1]) {
      K.ribbon(prof.map((p, i) => p.map(([x, y]) => V(side * x, y, z(ts[i])))), b.mat, parent);
      K.ribbon([prof[0].map(([x, y]) => V(side * x, y, z(0))), prof[0].map(([, y]) => V(0, y, z(0)))], b.mat, parent); // espelho
    }
    lo = hiF;
  }
  const w = S.well;
  const m = (t: number) => (w ? smoothstep(w.t0, w.t0 + 0.02, t) * (1 - smoothstep(w.t1 - 0.02, w.t1, t)) : 0);
  const crown = S.crown ?? 0.035 * S.B;
  const floorY = (sc: Sec, t: number) => sc.s - (w ? w.depth * m(t) : 0);
  if (S.deck) {
    const gw = w?.gw ?? 0.14;
    const g = (sc: Sec) => Math.min(gw, sc.hs * 0.45);
    const inBot = (side: number) => secs.map((sc, i) => V(side * (sc.hs - g(sc) - 0.03 * m(ts[i])), floorY(sc, ts[i]), z(ts[i])));
    for (const side of [1, -1]) {
      K.ribbon([
        secs.map((sc, i) => V(side * sc.hs, sc.s, z(ts[i]))),
        secs.map((sc, i) => V(side * (sc.hs - g(sc)), sc.s + 0.004, z(ts[i]))),
        inBot(side),
      ], S.deck, parent);
    }
    const L = inBot(-1), R = inBot(1);
    const Cn = secs.map((sc, i) => V(0, floorY(sc, ts[i]) + crown * (1 - m(ts[i])) * Math.min(1, sc.hs / (S.B / 2)), z(ts[i])));
    const part = (a: number, b: number, mat: Mat) => { if (b > a) K.ribbon([L.slice(a, b + 1), Cn.slice(a, b + 1), R.slice(a, b + 1)], mat, parent); };
    if (w) {
      let iA = N, iB = 0;
      ts.forEach((t, i) => { if (m(t) > 0.001) { iA = Math.min(iA, i); iB = Math.max(iB, i); } });
      iA = Math.max(0, iA - 1); iB = Math.min(N, iB + 1);
      part(0, iA, S.deck); part(iA, iB, w.floor); part(iB, N, S.deck);
    } else part(0, N, S.deck);
  }
  if (S.rub) {
    const r = S.rubR ?? 0.035;
    const path: Vector3[] = [];
    for (let i = 0; i <= N; i++) path.push(V(secs[i].hs + r * 0.4, secs[i].s - r * 0.5, z(ts[i])));
    for (let i = N - 1; i >= 0; i--) path.push(V(-secs[i].hs - r * 0.4, secs[i].s - r * 0.5, z(ts[i])));
    path.push(path[0].clone());
    K.tube(path, r, S.rub, parent, 8);
  }
  const sec = (t: number) => hullSection(S, Math.min(1, Math.max(0, t)));
  return {
    L: S.L, z,
    tOf: (zz: number) => (zz + S.L / 2) / S.L,
    sec,
    bottomY: (t, x) => { const sc = sec(t); const ax = Math.abs(x); return ax >= sc.hc ? sc.c : sc.k + (sc.c - sc.k) * Math.pow(ax / sc.hc, 1.15); },
    sideX: (t, y) => {
      const P = sec(t).P;
      for (let i = 8; i < P.length; i++) if (P[i][1] >= y) { const [x0, y0] = P[i - 1], [x1, y1] = P[i]; return lerp(x0, x1, (y - y0) / Math.max(1e-6, y1 - y0)); }
      return P[P.length - 1][0];
    },
    deckY: (t) => { const tt = Math.min(1, Math.max(0, t)); return floorY(sec(tt), tt); },
  };
};

/** Superestrutura: loft com faixa de vidro na lateral e teto que desce na frente (para-brisa). */
interface CabinSpec {
  z0: number; z1: number; N?: number;
  base: (t: number) => { y: number; hw: number };
  h: (t: number) => number; roofHw: (t: number) => number; crown: number;
  bands: { f: number; mat: Mat }[];   // frações acumuladas da lateral, de baixo para cima (a última = 1)
  roof: Mat; glassFrom?: number; aft: Mat; front: Mat;
}
const buildCabin = (K: Kit, parent: TransformNode, S: CabinSpec) => {
  const N = S.N ?? 40;
  const ts: number[] = [];
  for (let i = 0; i <= N; i++) ts.push(i / N);
  const z = (t: number) => lerp(S.z0, S.z1, t);
  const side = (t: number, f: number, sg: number) => {
    const b = S.base(t), rh = S.roofHw(t), h = S.h(t);
    const bulge = Math.sin(f * Math.PI) * 0.03; // lateral levemente abaulada
    return V(sg * (lerp(b.hw, rh, f) + bulge), b.y + h * f, z(t));
  };
  let f0 = 0;
  for (const band of S.bands) {
    const a = f0, b = band.f;
    for (const sg of [1, -1]) K.ribbon(ts.map((t) => [side(t, a, sg), side(t, (a + b) / 2, sg), side(t, b, sg)]), band.mat, parent);
    f0 = b;
  }
  const roofPt = (t: number, u: number) => { // u: -1..1 através do teto
    const b = S.base(t), rh = S.roofHw(t);
    return V(u * rh, b.y + S.h(t) + S.crown * (1 - u * u) * Math.min(1, rh / Math.max(0.01, S.roofHw(0))), z(t));
  };
  const roofPaths = (i0: number, i1: number) => {
    const p: Vector3[][] = [];
    for (let j = 0; j <= 6; j++) { const u = -1 + (2 * j) / 6; p.push(ts.slice(i0, i1 + 1).map((t) => roofPt(t, u))); }
    return p;
  };
  const gi = Math.round((S.glassFrom ?? 1) * N);
  if (gi > 0) K.ribbon(roofPaths(0, gi), S.roof, parent);
  if (gi < N) K.ribbon(roofPaths(gi, N), S.bands.length > 1 ? S.bands[1].mat : S.roof, parent);
  // tampas: popa (porta de vidro) e frente
  for (const [t, mat] of [[0, S.aft], [1, S.front]] as [number, Mat][]) {
    const pts: Vector3[] = [];
    for (let j = 0; j <= 6; j++) pts.push(side(t, j / 6, 1));
    for (let j = 6; j >= 0; j--) pts.push(roofPt(t, j / 6));
    K.ribbon([pts, pts.map((p) => V(-p.x, p.y, p.z))], mat, parent);
  }
};

// ---------------------------------------------------------------- rodas, motores, assentos, guarda-mancebo
const wheel = (K: Kit, M: Mats, parent: TransformNode, x: number, r: number, w: number, z: number, rim: Mat = M.rim) => {
  const s = Math.sign(x) || 1;
  K.cyl(w * 0.86, 2 * r, "x", x, r, z, M.tire, parent);                  // banda
  K.cyl(w, 2 * r * 0.93, "x", x, r, z, M.tire, parent);                  // ombro (perfil arredondado)
  K.cyl(0.03, 2 * r * 0.66, "x", x + s * (w / 2 - 0.005), r, z, rim, parent);  // aro
  K.cyl(0.04, 2 * r * 0.36, "x", x + s * (w / 2 + 0.01), r, z, rim, parent, 2 * r * 0.26); // cubo
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    K.cyl(0.03, 0.035, "x", x + s * (w / 2 + 0.02), r + Math.sin(a) * r * 0.2, z + Math.cos(a) * r * 0.2, M.steel, parent);
  }
};

/** Motor de popa (mesmo desenho do motor da lancha jogável, em escala). Pivô no espelho, inclinado `tilt` rad. */
const outboard = (K: Kit, M: Mats, parent: TransformNode, x: number, y: number, z: number, s: number, cowl: Mat, tilt: number) => {
  const e = K.node("fOb", parent, x, y, z);
  e.rotation.x = tilt; e.scaling.setAll(s);
  K.box(0.24, 0.36, 0.12, 0, -0.06, -0.05, M.black, e);                  // suporte
  const secs: Vector3[][] = [];
  const back = -0.84, NC = 18;
  const sec = (t: number, zz: number, sc = 1) => {
    const fr = Math.sqrt(smoothstep(0, 0.22, t));
    const bk = smoothstep(1, 0.85, t) * 0.12 + 0.88;
    const w = 0.48 * (0.45 + 0.55 * fr) * bk * sc, h = (0.56 * (0.55 + 0.45 * fr) + 0.06 * t) * bk * sc;
    return roundedRect(w, h, 0.1 * (0.5 + 0.5 * fr) * sc, 5).map((p) => V(p.x, p.y + 0.5 + 0.03 * t, zz));
  };
  for (let i = 0; i <= NC; i++) { const t = i / NC, zz = -0.1 + (back + 0.1) * t; secs.push(i === 0 ? sec(0, zz).map(() => V(0, 0.5, zz)) : sec(t, zz)); }
  secs.push(sec(1, back - 0.02, 0.9));
  secs.push(sec(1, back - 0.025, 0).map((p) => V(0, p.y, p.z)));
  K.ribbon(secs, cowl, e);
  K.rbox(0.42, 0.2, 0.64, 0.06, 0, 0.17, -0.46, M.black, e);             // capô inferior
  K.rbox(0.49, 0.035, 0.6, 0.015, 0, 0.29, -0.47, M.steel, e);           // friso
  const mid = K.cyl(1.0, 1, "y", 0, -0.35, -0.38, M.black, e); mid.scaling.set(0.11, 1, 0.32);
  const plate = K.cyl(0.018, 1, "y", 0, -0.79, -0.42, M.black, e); plate.scaling.set(0.34, 1, 0.56);
  const gear = K.add(MeshBuilder.CreateCapsule("fGear", { radius: 0.072, height: 0.56, orientation: V(0, 0, 1) }, K.scene), M.black, e);
  gear.position.set(0, -1.03, -0.36);
  const strut = K.cyl(0.26, 1, "y", 0, -0.92, -0.36, M.black, e); strut.scaling.set(0.08, 1, 0.26);
  const skeg = K.box(0.018, 0.22, 0.2, 0, -1.18, -0.42, M.black, e); skeg.rotation.x = 0.25;
  const tmp: Mesh[] = [];
  const { propBlur } = buildPropeller(K.scene, e, V(0, -1.03, -0.66), 0.19, 0.48, M.steel as PBRMaterial, (m, mat, p) => K.add(m, mat, p ?? e), tmp);
  for (const m of tmp) m.dispose();
  propBlur.dispose();
};

/** Guarda-mancebo: tubo superior + balaústres até `h` abaixo. */
export const rail = (K: Kit, M: Mats, parent: TransformNode, top: Vector3[], h: number, every = 3, r = 0.022) => {
  K.tube(top, r, M.steel, parent, 8);
  top.forEach((p, i) => { if (i % every === 0 || i === top.length - 1) K.tube([p, V(p.x, p.y - h, p.z)], r * 0.8, M.steel, parent, 6); });
};

/** Sofá: assento + encosto (estofado), centro em (x, y do assento, z), rotação yaw. */
const sofa = (K: Kit, M: Mats, parent: TransformNode, x: number, y: number, z: number, w: number, d: number, yaw: number, back = true, accent: Mat = M.navy) => {
  const n = K.node("fSofa", parent, x, y, z); n.rotation.y = yaw;
  K.rbox(w, 0.38, d, 0.05, 0, -0.19, 0, accent, n);                      // base
  K.rbox(w - 0.04, 0.14, d - 0.04, 0.06, 0, 0.06, 0.01, M.cushion, n);   // assento
  if (back) { const b = K.rbox(w - 0.04, 0.48, 0.14, 0.06, 0, 0.32, -d / 2 + 0.08, M.cushion, n); b.rotation.x = -0.18; }
  return n;
};

// ---------------------------------------------------------------- carretinha
interface Bunk { x: number; z0: number; z1: number; y: (z: number) => number; slope: number; side: number }
interface TrailerOpts {
  zc: number; zf: number; zr: number; halfW: number; railY: number;
  axleZ: number; axles: number; wheelR: number; track: number;
  bunks: Bunk[];
  rollers?: { zs: number[]; y: (z: number) => number };
  winch?: { z: number; bowZ: number; bowY: number };
  posts?: { x: number; z: number; top: number };
}
const slab = (K: Kit, parent: TransformNode, pts: Vector3[], slope: number, side: number, hw: number, th: number, mat: Mat) => {
  const n = Math.hypot(1, slope), ax = 1 / n, ay = (side * slope) / n, nx = -ay, ny = ax;
  const c = (p: Vector3, a: number, b: number) => V(p.x + ax * a - nx * b, p.y + ay * a - ny * b, p.z);
  K.ribbon([pts.map((p) => c(p, -hw, 0)), pts.map((p) => c(p, hw, 0)), pts.map((p) => c(p, hw, th)), pts.map((p) => c(p, -hw, th))], mat, parent, true);
};
const trailer = (K: Kit, M: Mats, g: TransformNode, o: TrailerOpts) => {
  const len = o.zf - o.zr, midZ = (o.zf + o.zr) / 2, ry = o.railY;
  for (const s of [-1, 1]) {
    K.box(0.07, 0.17, len, s * o.halfW, ry, midZ, M.galv, g);                         // longarina (perfil U)
    K.box(0.05, 0.025, len, s * (o.halfW - 0.02), ry + 0.085, midZ, M.galv, g);       // aba
  }
  const nX = Math.max(3, Math.round(len / 1.25));
  for (let i = 0; i <= nX; i++) K.box(2 * o.halfW + 0.06, 0.08, 0.07, 0, ry - 0.03, lerp(o.zr + 0.06, o.zf - 0.06, i / nX), M.galv, g);
  // cabeçalho em V + barra central até o acoplador
  const tip = o.zc + 0.6;
  for (const s of [-1, 1]) K.beam(V(s * o.halfW, ry, o.zf), V(s * 0.06, ry, tip), 0.08, 0.14, M.galv, g);
  K.box(0.1, 0.14, o.zf - tip + 0.1, 0, ry, (o.zf + tip) / 2, M.galv, g);
  K.beam(V(0, ry, tip + 0.05), V(0, 0.52, o.zc + 0.2), 0.11, 0.13, M.galv, g);     // pescoço até a altura da bola
  K.rbox(0.15, 0.12, 0.42, 0.04, 0, 0.55, o.zc + 0.12, M.galv, g);                   // acoplador
  K.cyl(0.08, 0.16, "y", 0, 0.49, o.zc, M.steelDark, g);
  for (const s of [-1, 1]) K.tube([V(s * 0.07, 0.5, o.zc + 0.35), V(s * 0.16, 0.3, o.zc + 0.05), V(s * 0.22, 0.42, o.zc - 0.28)], 0.012, M.steelDark, g, 5); // correntes
  // macaco (recolhido)
  K.cyl(0.6, 0.075, "y", 0.13, ry + 0.12, tip + 0.45, M.galv, g);
  K.cyl(0.04, 0.16, "y", 0.13, ry - 0.2, tip + 0.45, M.galv, g);
  K.tube([V(0.13, ry + 0.42, tip + 0.45), V(0.13, ry + 0.48, tip + 0.45), V(0.3, ry + 0.48, tip + 0.45), V(0.3, ry + 0.4, tip + 0.45)], 0.012, M.black, g, 5);
  // eixos, feixes de mola, rodas e para-lamas
  const zs: number[] = [];
  for (let a = 0; a < o.axles; a++) zs.push(o.axleZ + (a - (o.axles - 1) / 2) * (2 * o.wheelR + 0.16));
  for (const za of zs) {
    K.cyl(2 * o.track - 0.1, 0.08, "x", 0, o.wheelR, za, M.galv, g);
    for (const s of [-1, 1]) {
      K.box(0.06, 0.06, 0.85, s * o.halfW, (o.wheelR + ry) / 2 - 0.02, za, M.steelDark, g);
      wheel(K, M, g, s * o.track, o.wheelR, 0.2, za);
    }
  }
  const R = o.wheelR + 0.07, zF = zs[zs.length - 1], zB = zs[0];
  const arc: P2[] = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); arc.push([zF + R * Math.cos(a), o.wheelR + R * Math.sin(a)]); }
  for (let i = 0; i <= 8; i++) { const a = Math.PI / 2 + (i / 8) * (Math.PI / 2); arc.push([zB + R * Math.cos(a), o.wheelR + R * Math.sin(a)]); }
  for (const s of [-1, 1]) {
    K.ribbon([arc.map(([z, y]) => V(s * (o.track - 0.16), y, z)), arc.map(([z, y]) => V(s * (o.track + 0.16), y, z))], M.galv, g);
    K.box(0.04, 0.04, 0.08, s * (o.track + 0.17), o.wheelR + 0.1, zF + R - 0.05, M.lightAmber, g);
  }
  // berço: bunks acarpetados seguindo o fundo do casco + suportes
  for (const b of o.bunks) {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 10; i++) { const z = lerp(b.z0, b.z1, i / 10); pts.push(V(b.x, b.y(z) - 0.004, z)); }
    slab(K, g, pts, b.slope, b.side, 0.075, 0.06, M.carpet);
    for (const u of [0.15, 0.85]) {
      const z = lerp(b.z0, b.z1, u), top = b.y(z) - 0.06;
      if (top > ry + 0.1) K.box(0.06, top - ry, 0.08, b.x, (top + ry) / 2, z, M.galv, g);
    }
  }
  if (o.rollers) for (const z of o.rollers.zs) {
    const y = o.rollers.y(z);
    K.cyl(0.24, 0.13, "x", 0, y - 0.065, z, M.black, g);
    if (y - 0.13 > ry) K.box(0.05, y - 0.13 - ry + 0.04, 0.05, 0, (y - 0.13 + ry) / 2, z, M.galv, g);
  }
  if (o.winch) {
    const w = o.winch, top = w.bowY + 0.28;
    K.box(0.08, top - ry, 0.08, 0, (top + ry) / 2, w.z, M.galv, g);
    K.beam(V(0, ry, w.z + 0.7), V(0, top - 0.2, w.z + 0.02), 0.07, 0.07, M.galv, g);
    K.cyl(0.16, 0.13, "x", 0, top - 0.05, w.z + 0.09, M.galv, g);       // tambor do guincho
    K.tube([V(0.09, top - 0.05, w.z + 0.09), V(0.09, top + 0.12, w.z + 0.2), V(0.2, top + 0.12, w.z + 0.2)], 0.012, M.black, g, 5);
    for (const s of [-1, 1]) { const r = K.cyl(0.14, 0.09, "y", s * 0.06, w.bowY + 0.06, w.z - 0.04, M.black, g); r.rotation.z = s * 0.5; }
    K.beam(V(0, top - 0.05, w.z + 0.02), V(0, w.bowY, w.bowZ), 0.05, 0.006, M.strap, g); // cinta até o olhal
  }
  if (o.posts) for (const s of [-1, 1]) {
    const x = s * o.posts.x;
    K.cyl(o.posts.top - ry, 0.055, "y", x, (o.posts.top + ry) / 2, o.posts.z, M.galv, g);
    K.cyl(0.75, 0.11, "y", x, o.posts.top - 0.4, o.posts.z, M.offwhite, g);
    K.box(Math.abs(x) - o.halfW, 0.06, 0.06, s * (o.halfW + Math.abs(x)) / 2, ry, o.posts.z, M.galv, g);
  }
  // barra de luzes traseira
  K.box(2 * o.halfW + 0.5, 0.05, 0.05, 0, ry + 0.02, o.zr - 0.02, M.galv, g);
  for (const s of [-1, 1]) {
    K.rbox(0.2, 0.1, 0.05, 0.02, s * (o.halfW + 0.16), ry + 0.06, o.zr - 0.05, M.lightRed, g);
    K.box(0.04, 0.04, 0.06, s * (o.halfW + 0.02), ry + 0.04, o.zf - 0.1, M.lightAmber, g);
  }
};

/** Bunk que segue o fundo do casco `h` (no nó do barco em (0, by, bz)) na posição x (local do barco = x - xh). */
const bunkOn = (h: Hull, by: number, bz: number, x: number, xh: number, z0: number, z1: number): Bunk => {
  const xl = x - xh;
  const tm = h.tOf((z0 + z1) / 2 - bz);
  const slope = Math.abs((h.bottomY(tm, Math.abs(xl) + 0.02) - h.bottomY(tm, Math.abs(xl) - 0.02)) / 0.04);
  return { x, z0, z1, y: (z) => by + h.bottomY(h.tOf(z - bz), xl), slope, side: Math.sign(xl) || 1 };
};

// ---------------------------------------------------------------- cavalo mecânico (cabine longa, convencional)
const buildSemi = (K: Kit, M: Mats, g: TransformNode, F: number): number => {
  const P = M.truck;
  K.rbox(2.5, 0.36, 0.3, 0.1, 0, 0.72, F - 0.16, M.steel, g);                   // para-choque
  for (const s of [-1, 1]) K.rbox(0.3, 0.12, 0.05, 0.03, s * 0.95, 0.74, F - 0.0, M.lightWhite, g);
  // capô longo
  loftRR(K, loftFn(14, (t) => ({ z: F - 0.3 - 2.05 * t, w: lerp(1.75, 2.15, smoothstep(0, 0.4, t)), h: lerp(0.8, 1.08, t), y: lerp(1.33, 1.5, t), r: 0.22 })), P, g);
  K.rbox(1.05, 0.82, 0.06, 0.06, 0, 1.36, F - 0.3, M.steel, g);                 // grade
  for (let i = 0; i < 7; i++) K.box(0.92, 0.04, 0.03, 0, 1.03 + i * 0.1, F - 0.34, M.black, g);
  for (const s of [-1, 1]) {
    K.rbox(0.3, 0.17, 0.06, 0.05, s * 0.78, 1.22, F - 0.35, M.lightWhite, g);   // faróis
    // para-lamas dianteiros
    const R = 0.62, pts: P2[] = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; pts.push([F - 1.25 + R * Math.cos(a), 0.52 + R * Math.sin(a)]); }
    K.ribbon([pts.map(([z, y]) => V(s * 0.85, y, z)), pts.map(([z, y]) => V(s * 1.27, y, z))], P, g);
    K.box(0.08, 0.06, 0.12, s * 1.26, 1.05, F - 0.75, M.lightAmber, g);
  }
  // cabine + dormitório com defletor (um loft só)
  loftRR(K, loftFn(20, (t) => {
    const top = key(t, [[0, 3.05], [0.3, 3.15], [0.55, 3.62], [1, 3.62]]);
    return { z: F - 2.35 - 3.25 * t, w: 2.45, h: top - 1.0, y: (top + 1.0) / 2, r: 0.26 };
  }), P, g);
  const ws = K.rbox(2.2, 0.78, 0.05, 0.08, 0, 2.6, F - 2.42, M.glass, g); ws.rotation.x = -0.28;   // para-brisa
  K.box(0.06, 0.8, 0.06, 0, 2.6, F - 2.4, P, g).rotation.x = -0.28;             // coluna central
  K.box(2.35, 0.06, 0.32, 0, 3.05, F - 2.3, P, g).rotation.x = 0.15;            // pala de sol
  for (const s of [-1, 1]) {
    K.rbox(0.03, 0.62, 0.95, 0.08, s * 1.23, 2.55, F - 3.0, M.glass, g);        // janelas laterais
    K.rbox(0.03, 0.3, 0.5, 0.05, s * 1.23, 2.75, F - 4.9, M.glass, g);          // janela do dormitório
    K.tube([V(s * 1.22, 2.3, F - 2.5), V(s * 1.5, 2.3, F - 2.45), V(s * 1.5, 2.95, F - 2.45)], 0.018, M.steel, g, 6); // espelho
    K.rbox(0.1, 0.42, 0.2, 0.03, s * 1.52, 2.62, F - 2.45, M.black, g);
    K.cyl(0.6, 0.6, "z", s * 1.04, 0.82, F - 3.35, M.steel, g);                 // tanques
    for (const zz of [F - 3.1, F - 3.6]) K.cyl(0.04, 0.63, "z", s * 1.04, 0.82, zz, M.black, g);
    K.box(0.4, 0.06, 0.3, s * 1.1, 0.48, F - 2.6, M.steel, g);                  // degraus
    K.cyl(3.3, 0.14, "y", s * 1.0, 2.6, F - 5.68, M.steel, g);                   // escapamentos
    K.cyl(0.25, 0.17, "y", s * 1.0, 4.3, F - 5.68, M.steel, g, 0.15);
    K.cyl(0.5, 0.08, "z", s * 0.5, 3.66, F - 2.7, M.steel, g, 0.12);            // buzinas a ar
    for (const zz of [F - 2.5, F - 3.9]) K.box(0.05, 0.05, 0.06, s * 0.9, 3.67, zz, M.lightAmber, g);
  }
  // chassi, quinta roda, rodas (dianteira simples, 2 eixos de tração com rodado duplo)
  for (const s of [-1, 1]) K.box(0.12, 0.3, 7.2, s * 0.45, 0.95, F - 3.9, M.black, g);
  K.cyl(0.14, 1.05, "y", 0, 1.22, F - 6.4, M.black, g);
  K.box(1.2, 0.1, 1.2, 0, 1.12, F - 6.4, M.steelDark, g);
  for (const s of [-1, 1]) wheel(K, M, g, s * 1.02, 0.52, 0.3, F - 1.25);
  for (const za of [F - 5.75, F - 7.05]) {
    K.cyl(2.2, 0.14, "x", 0, 0.52, za, M.steelDark, g);
    for (const s of [-1, 1]) { wheel(K, M, g, s * 1.18, 0.52, 0.28, za); K.cyl(0.27, 1.02, "x", s * 0.88, 0.52, za, M.tire, g); }
  }
  for (const s of [-1, 1]) {
    K.rbox(0.75, 0.05, 2.1, 0.02, s * 1.03, 1.15, F - 6.4, M.black, g);         // para-lamas traseiros
    K.box(0.6, 0.55, 0.02, s * 1.03, 0.45, F - 7.7, M.black, g);                // lameiros
  }
  return F - 6.4; // pino-rei
};

// ---------------------------------------------------------------- montagem
export const buildFleet = (scene: Scene): Mesh[] => {
  const K = makeKit(scene);
  const M = makeMats(scene);
  const roots: TransformNode[] = [];
  for (const f of FLEET) roots.push(buildRig(K, M, f));
  // mescla por material (as poses dos nós são "assadas" nos vértices)
  for (const r of roots) { r.computeWorldMatrix(true); for (let p = 0; p < 2; p++) for (const n of r.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true); }
  const groups = new Map<string, Mesh[]>();
  for (const m of K.out) {
    if (!m.material || m.getTotalVertices() === 0) continue;
    const k = m.material.uniqueId + "|" + (m.isVerticesDataPresent(VertexBuffer.ColorKind) ? 1 : 0) + "|" + (m.isVerticesDataPresent(VertexBuffer.UVKind) ? 1 : 0);
    const list = groups.get(k);
    if (list) list.push(m); else groups.set(k, [m]);
  }
  const merged: Mesh[] = [];
  for (const list of groups.values()) {
    const mm = list.length === 1 ? null : Mesh.MergeMeshes(list, true, true);
    if (mm) { mm.name = "fleet_" + mm.material?.name; merged.push(mm); }
    else for (const m of list) { if (!m.isDisposed()) { m.setParent(null); m.bakeCurrentTransformIntoVertices(); merged.push(m); } }
  }
  for (const r of roots) r.dispose();
  for (const m of merged) { m.isPickable = false; m.receiveShadows = true; m.freezeWorldMatrix(); }
  return merged;
};

const buildRig = (K: Kit, M: Mats, f: (typeof FLEET)[number]): TransformNode => {
  const g = new TransformNode("fleet_" + f.kind, K.scene);
  g.position.set(f.x, LOT.y + 0.05, f.z);
  g.rotation.y = Math.PI / 2; // frente do conjunto para +X
  const front = f.len / 2;
  const vehicle = (kind: "car" | "pickup", paint: Color3) => {
    const v = kind === "car" ? buildCar(K.scene, "fCar_" + f.kind, paint) : buildPickup(K.scene, "fPickup_" + f.kind, paint);
    v.root.parent = g; v.root.position.set(0, 0, front - v.length / 2);
    K.out.push(...v.meshes);
    return front - v.length - 0.35; // z da bola do engate
  };
  switch (f.kind as FleetKind) {
    case "jetski": jetski(K, M, g, vehicle("car", C(0.1, 0.28, 0.62))); break;
    case "pontoon": pontoon(K, M, g, vehicle("pickup", C(0.2, 0.22, 0.24))); break;
    case "catamaran": catamaran(K, M, g, vehicle("pickup", C(0.92, 0.92, 0.9))); break;
    case "offshore": offshore(K, M, g, vehicle("pickup", C(0.05, 0.05, 0.06))); break;
    case "cruiser50": cruiser(K, M, g, front); break;
  }
  return g;
};

// ---------------------------------------------------------------- jet ski (moto aquática)
const jetski = (K: Kit, M: Mats, g: TransformNode, zc: number) => {
  const L = 3.3, by = 0.5, bow = zc - 1.25, bz = bow - L / 2;
  const b = K.node("fJet", g, 0, by, bz);
  const H = buildHull(K, b, {
    L, B: 1.18, D: 0.46, dead: 0.42, deadBow: 0.9, bowRise: 0.3, sheerRise: 0.1, flare: 0.05, chine: 0.045, entry: 0.5, crown: 0,
    bands: [{ top: () => 0.19, mat: M.matte }, { top: () => 0.26, mat: M.lime }, { top: () => 9, mat: M.white }],
    deck: M.matte, rub: M.black, rubR: 0.03, N: 48,
  });
  // corpo superior: plataforma de popa, pedestal do banco, console do guidão e capô
  const body = (t: number, grow = 0): RR => {
    const zz = H.z(t), hs = H.sec(t).hs;
    const w = Math.min(key(t, [[0, 1.0], [0.1, 0.96], [0.19, 0.6], [0.55, 0.6], [0.66, 0.94], [0.8, 0.86], [1, 0.04]]), 2 * hs - 0.03) + grow;
    const hh = key(t, [[0, 0.06], [0.1, 0.07], [0.19, 0.3], [0.55, 0.32], [0.65, 0.5], [0.8, 0.4], [1, 0.05]]) + grow;
    const base = H.deckY(t) - 0.03;
    return { z: zz, w, h: hh, y: base + hh / 2, r: Math.min(0.13, hh / 2) };
  };
  loftRR(K, loftFn(40, (t) => body(0.02 + 0.98 * t)), M.white, b);
  loftRR(K, loftFn(22, (t) => body(0.63 + 0.37 * t, 0.014)), M.lime, b);                 // capô colorido
  // banco (com friso)
  const seat = (t: number, grow = 0, dy = 0): RR => {
    const bb = body(t), w = key(t, [[0, 0.44], [0.5, 0.52], [1, 0.42]]) + grow;
    return { z: bb.z, w, h: 0.15 + grow, y: bb.y + bb.h / 2 + 0.07 + dy, r: 0.07 };
  };
  loftRR(K, loftFn(16, (t) => seat(0.17 + 0.4 * t)), M.black, b);
  loftRR(K, loftFn(16, (t) => seat(0.17 + 0.4 * t, 0.02, -0.06)), M.lime, b);
  // guidão, para-brisa, retrovisores, alça, bocal do jato
  const tp = body(0.66), zt = tp.z, yt = tp.y + tp.h / 2;
  K.tube([V(0, yt - 0.05, zt), V(0, yt + 0.13, zt - 0.08)], 0.035, M.black, b, 8);
  K.tube([V(-0.36, yt + 0.2, zt - 0.17), V(-0.15, yt + 0.15, zt - 0.1), V(0.15, yt + 0.15, zt - 0.1), V(0.36, yt + 0.2, zt - 0.17)], 0.016, M.steel, b, 8);
  for (const s of [-1, 1]) {
    K.cyl(0.13, 0.05, "x", s * 0.36, yt + 0.2, zt - 0.17, M.black, b);
    K.tube([V(s * 0.32, body(0.76).y + 0.15, H.z(0.76)), V(s * 0.4, body(0.76).y + 0.26, H.z(0.76) - 0.04)], 0.008, M.black, b, 5);
    K.rbox(0.12, 0.06, 0.03, 0.02, s * 0.42, body(0.76).y + 0.28, H.z(0.76) - 0.05, M.black, b);
  }
  const vis = K.rbox(0.5, 0.18, 0.02, 0.05, 0, yt + 0.06, zt + 0.12, M.glass, b); vis.rotation.x = -0.9;
  K.rbox(0.3, 0.1, 0.12, 0.03, 0, yt + 0.02, zt - 0.02, M.black, b);                      // painel
  K.tube([V(-0.18, seat(0.17).y + 0.02, H.z(0.15)), V(-0.18, seat(0.17).y + 0.08, H.z(0.12)), V(0.18, seat(0.17).y + 0.08, H.z(0.12)), V(0.18, seat(0.17).y + 0.02, H.z(0.15))], 0.018, M.black, b, 6);
  K.cyl(0.25, 0.2, "z", 0, 0.16, H.z(0) - 0.08, M.matte, b, 0.16);
  K.rbox(0.5, 0.03, 0.35, 0.02, 0, 0.02, H.z(0.05), M.steelDark, b);                      // placa de passeio
  // carretinha pequena: 2 bunks, 1 eixo
  const zf = bow + 0.2, zr = bz - L / 2 + 0.25;
  trailer(K, M, g, {
    zc, zf, zr, halfW: 0.42, railY: 0.36, axleZ: bz - 0.25, axles: 1, wheelR: 0.24, track: 0.72,
    bunks: [-1, 1].map((s) => bunkOn(H, by, bz, s * 0.27, 0, zr + 0.15, bow - 0.75)),
    winch: { z: zf + 0.05, bowZ: bow - 0.05, bowY: by + H.sec(0.98).s - 0.12 },
  });
};

// ---------------------------------------------------------------- pontoon (tritoon) com toldo bimini
const pontoon = (K: Kit, M: Mats, g: TransformNode, zc: number) => {
  const L = 7.3, R = 0.32, by = 0.62, bow = zc - 1.35, bz = bow - L / 2;
  const b = K.node("fPont", g, 0, by, bz);
  // flutuadores: loft circular com nariz em ogiva levantado e popa arredondada
  for (const x of [-0.92, 0, 0.92]) {
    const paths: Vector3[][] = [];
    for (let i = 0; i <= 34; i++) {
      const t = i / 34, z = -L / 2 + 0.1 + (L - 0.2) * t;
      const nose = smoothstep(0.8, 1, t);
      const r = R * (t < 0.03 ? 0.75 + 0.25 * smoothstep(0, 0.03, t) : Math.sqrt(Math.max(0.0004, 1 - nose * nose)));
      const yc = R + 0.16 * nose * nose;
      const ring: Vector3[] = [];
      for (let j = 0; j <= 20; j++) { const a = (j / 20) * Math.PI * 2; ring.push(V(x + Math.cos(a) * r, yc + Math.sin(a) * r, z)); }
      paths.push(ring);
    }
    paths.unshift(paths[0].map(() => V(x, R, -L / 2 + 0.1)));
    K.ribbon(paths, M.alu, b);
    K.box(0.06, 0.12, L - 1.4, x, 2 * R + 0.06, -0.2, M.alu, b);                  // suportes
    if (x !== 0) K.box(0.04, 0.05, L - 1.8, x * 1.3, R * 0.8, -0.3, M.alu, b);     // quilha de sustentação
  }
  // convés e saia
  const DY = 2 * R + 0.14, DW = 2.55, DL = L + 0.15;
  const deckShape = (w: number, l: number, r: number, y: number) => roundedRect(w, l, r, 6).map((p) => V(p.x, y, p.y - 0.05));
  K.ribbon([deckShape(DW, DL, 0.5, DY), deckShape(0.01, DL - DW + 0.02, 0, DY)], M.teak, b);
  K.ribbon([deckShape(DW + 0.02, DL + 0.02, 0.51, DY + 0.02), deckShape(DW + 0.02, DL + 0.02, 0.51, DY - 0.2)], M.navy, b);
  K.ribbon([deckShape(DW + 0.04, DL + 0.04, 0.52, DY - 0.2), deckShape(DW + 0.04, DL + 0.04, 0.52, DY - 0.24)], M.alu, b);
  // cerca em painéis: portão na proa e plataforma de popa aberta
  const coarse = deckShape(DW - 0.08, DL - 0.08, 0.46, 0);
  const ring: Vector3[] = [];
  for (let i = 0; i < coarse.length - 1; i++) {   // adensa (os lados retos só têm os cantos)
    const a = coarse[i], c = coarse[i + 1], n = Math.max(1, Math.ceil(Vector3.Distance(a, c) / 0.15));
    for (let k = 0; k < n; k++) ring.push(Vector3.Lerp(a, c, k / n));
  }
  const open = (p: Vector3) => (p.z > 0 && Math.abs(p.x) < 0.42) || p.z < -DL / 2 + 0.9;
  const start = ring.findIndex(open);
  const runs: Vector3[][] = [];
  let cur: Vector3[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[(start + i) % ring.length];
    if (open(p)) { if (cur.length) runs.push(cur); cur = []; } else cur.push(p);
  }
  if (cur.length) runs.push(cur);
  for (const run of runs) {
    if (run.length < 2) continue;
    const at = (y: number) => run.map((p) => V(p.x, DY + y, p.z));
    K.ribbon([at(0.04), at(0.42)], M.offwhite, b);
    K.ribbon([at(0.42), at(0.52)], M.navy, b);
    K.ribbon([at(0.52), at(0.72)], M.offwhite, b);
    K.tube(at(0.76), 0.025, M.alu, b, 8);
    K.tube(at(0.04), 0.02, M.alu, b, 6);
    run.forEach((p, i) => { if (i % 4 === 0 || i === run.length - 1) K.tube([V(p.x, DY + 0.02, p.z), V(p.x, DY + 0.76, p.z)], 0.018, M.alu, b, 6); });
  }
  // sofás em U na proa e na popa, console do piloto
  const sy = DY + 0.4;
  sofa(K, M, b, 0, sy, 2.95, 1.6, 0.6, Math.PI);
  for (const s of [-1, 1]) sofa(K, M, b, s * 0.88, sy, 1.85, 1.4, 0.6, -s * Math.PI / 2);
  sofa(K, M, b, 0, sy, -2.45, 2.2, 0.62, 0);
  sofa(K, M, b, -0.88, sy, -1.25, 1.6, 0.6, Math.PI / 2);
  const con = K.rbox(0.7, 0.95, 0.6, 0.12, 0.72, DY + 0.48, 0.6, M.offwhite, b);
  con.rotation.y = 0;
  K.rbox(0.66, 0.06, 0.4, 0.03, 0.72, DY + 0.99, 0.62, M.black, b).rotation.x = 0.35;
  const scr = K.rbox(0.64, 0.25, 0.02, 0.05, 0.72, DY + 1.14, 0.82, M.glass, b); scr.rotation.x = -0.5;
  const wh = K.add(MeshBuilder.CreateTorus("fWheel", { diameter: 0.34, thickness: 0.025, tessellation: 24 }, K.scene), M.black, b);
  wh.position.set(0.72, DY + 1.1, 0.42); wh.rotation.x = Math.PI / 2 - 0.5;
  const cap = K.node("fCapt", b, 0.72, DY + 0.5, -0.05);
  K.cyl(0.4, 0.08, "y", 0, -0.2, 0, M.steel, cap);
  K.rbox(0.5, 0.12, 0.48, 0.06, 0, 0.04, 0, M.cushion, cap);
  K.rbox(0.5, 0.45, 0.12, 0.06, 0, 0.3, -0.22, M.cushion, cap);
  K.rbox(0.82, 0.34, 0.5, 0.05, -0.75, DY + 0.17, 0.5, M.offwhite, b);           // mesinha/porta-objetos
  // toldo bimini: lona curva sobre arcos de inox
  const bim = (z: number, sag = 0) => { const p: Vector3[] = []; for (let j = 0; j <= 12; j++) { const x = -1.18 + (2.36 * j) / 12; p.push(V(x, DY + 1.95 + 0.22 * Math.cos((x / 1.18) * Math.PI / 2) - sag, z)); } return p; };
  K.ribbon([bim(-1.9), bim(-0.9, 0.04), bim(0.1, 0.04), bim(1.1)], M.canvas, b);
  for (const z of [-1.9, 1.1]) K.tube([V(-1.2, DY + 0.75, z), ...bim(z).map((p) => V(p.x, p.y - 0.03, p.z)), V(1.2, DY + 0.75, z)], 0.018, M.steel, b, 8);
  // motor 150 no suporte central
  K.rbox(0.5, 0.35, 0.5, 0.05, 0, DY - 0.1, -DL / 2 - 0.1, M.alu, b);
  outboard(K, M, b, 0, DY - 0.15, -DL / 2 - 0.35, 1.25, M.white, 0.9);
  K.tube([V(0.7, DY + 0.05, -DL / 2 - 0.02), V(0.7, DY - 0.5, -DL / 2 - 0.05)], 0.015, M.steel, b, 6); // escada
  // carretinha de pontoon: bunks sob os flutuadores, 2 eixos
  const zf = bow + 0.1, zr = bz - L / 2 + 0.4;
  trailer(K, M, g, {
    zc, zf, zr, halfW: 0.92, railY: 0.4, axleZ: bz - 0.4, axles: 2, wheelR: 0.27, track: 0.62,
    bunks: [-0.92, 0.92].map((x) => ({ x, z0: zr + 0.2, z1: zf - 0.5, y: () => by - 0.005, slope: 0, side: 1 })),
    winch: { z: zf + 0.05, bowZ: bow - 0.05, bowY: by + R + 0.1 },
  });
};

// ---------------------------------------------------------------- catamarã fisher (console central, T-top)
const catamaran = (K: Kit, M: Mats, g: TransformNode, zc: number) => {
  const L = 8.2, by = 0.72, bow = zc - 1.3, bz = bow - L / 2;
  const b = K.node("fCat", g, 0, by, bz);
  let sp: Hull | null = null;
  for (const x of [-1.0, 1.0]) {
    const n = K.node("fSponson", b, x, 0, 0);
    sp = buildHull(K, n, {
      L, B: 0.86, D: 0.95, dead: 0.55, deadBow: 1.1, bowRise: 0.62, sheerRise: 0.2, flare: 0.03, chine: 0.035, entry: 0.58,
      bands: [{ top: () => 0.3, mat: M.antifoul }, { top: () => 0.36, mat: M.white }, { top: () => 9, mat: M.steelBlue }], N: 44,
    });
  }
  const TY = 0.68, SR = 0.28;
  const bn = K.node("fCatBody", b, 0, TY, 0);
  const H = buildHull(K, bn, {
    L, B: 2.9, D: 0.68, dead: 0.04, deadBow: 0.2, bowRise: 0.42, sheerRise: SR, flare: 0.04, chine: 0.0, entry: 0.55, crown: 0.06,
    bands: [{ top: (t) => 0.68 + SR * t * t - 0.2, mat: M.steelBlue }, { top: () => 9, mat: M.white }],
    deck: M.white, rub: M.steel, rubR: 0.03,
    well: { depth: 0.58, t0: 0.03, t1: 0.74, floor: M.nonskid, gw: 0.16 },
  });
  const fy = (t: number) => H.deckY(t);                                  // piso (local do corpo)
  // console central
  const cz = H.z(0.48), cy = fy(0.48);
  loftRR(K, loftFn(10, (t) => ({ z: cz + 0.5 - 1.0 * t, w: lerp(0.8, 1.0, t), h: lerp(0.95, 1.1, t), y: cy + lerp(0.95, 1.1, t) / 2, r: 0.12 })), M.white, bn);
  const dash = K.rbox(0.9, 0.05, 0.5, 0.03, 0, cy + 1.12, cz + 0.1, M.black, bn); dash.rotation.x = 0.4;
  const ws = K.rbox(1.0, 0.42, 0.025, 0.08, 0, cy + 1.32, cz + 0.42, M.glass, bn); ws.rotation.x = -0.45;
  K.tube([V(-0.52, cy + 1.08, cz + 0.52), V(-0.52, cy + 1.5, cz + 0.3), V(0.52, cy + 1.5, cz + 0.3), V(0.52, cy + 1.08, cz + 0.52)], 0.018, M.steel, bn, 8);
  const wh = K.add(MeshBuilder.CreateTorus("fWheel", { diameter: 0.36, thickness: 0.025, tessellation: 24 }, K.scene), M.steel, bn);
  wh.position.set(0, cy + 1.2, cz - 0.05); wh.rotation.x = Math.PI / 2 - 0.55;
  // banco de proa do console + caixa térmica + encosto de pilotagem (leaning post)
  sofa(K, M, bn, 0, cy + 0.45, cz + 0.72, 0.9, 0.42, 0, false, M.white);
  K.rbox(1.0, 0.5, 0.55, 0.06, 0, cy + 0.25, cz - 1.45, M.white, bn);
  K.rbox(1.0, 0.08, 0.5, 0.04, 0, cy + 0.54, cz - 1.45, M.cushion, bn);
  K.rbox(1.0, 0.5, 0.12, 0.05, 0, cy + 0.92, cz - 1.7, M.cushion, bn).rotation.x = -0.15;
  for (let k = 0; k < 4; k++) K.tube([V(-0.36 + k * 0.24, cy + 0.6, cz - 1.75), V(-0.36 + k * 0.24, cy + 1.45, cz - 1.95)], 0.025, M.steel, bn, 8);
  // T-top: 4 colunas de inox e teto rígido com antenas e porta-varas
  const ty = cy + 2.35;
  for (const sx of [-1, 1]) for (const dz of [0.3, -0.75]) K.tube([V(sx * 0.48, cy + 0.9, cz + dz), V(sx * 0.62, ty - 0.08, cz + dz - 0.05)], 0.035, M.steel, bn, 10);
  K.rbox(1.9, 0.1, 2.0, 0.08, 0, ty, cz - 0.2, M.white, bn);
  K.rbox(1.85, 0.03, 1.95, 0.08, 0, ty - 0.06, cz - 0.2, M.matte, bn);
  for (let k = 0; k < 6; k++) K.tube([V(-0.6 + k * 0.24, ty + 0.05, cz - 1.15), V(-0.6 + k * 0.24, ty + 0.35, cz - 1.3)], 0.022, M.steel, bn, 6);
  K.cyl(0.18, 0.55, "y", 0, ty + 0.12, cz + 0.2, M.white, bn);            // radome
  for (const s of [-1, 1]) {
    K.tube([V(s * 0.85, ty + 0.05, cz + 0.3), V(s * 0.9, ty + 2.3, cz + 0.1)], 0.012, M.white, bn, 5);    // antenas
    K.tube([V(s * 0.9, ty + 0.02, cz - 0.6), V(s * 2.7, ty + 2.4, cz - 2.2)], 0.022, M.alu, bn, 6);      // tangones
  }
  // assentos da proa, guarda-mancebo baixo, motores de popa duplos
  const fz = H.z(0.86), fyy = fy(0.86);
  K.rbox(1.6, 0.08, 1.0, 0.25, 0, fyy + 0.06, fz, M.cushion, bn);
  const bowRail: Vector3[] = [];
  for (let i = 0; i <= 14; i++) { const t = 0.62 + (0.38 * i) / 14; const sc = H.sec(t); bowRail.push(V(Math.max(0, sc.hs - 0.08), sc.s + 0.45, H.z(t) - (i === 14 ? 0.1 : 0))); }
  const bowRailL = bowRail.map((p) => V(-p.x, p.y, p.z)).reverse();
  rail(K, M, bn, [...bowRail, ...bowRailL.slice(1)], 0.45, 3);
  for (const x of [-1.0, 1.0]) outboard(K, M, b, x, 0.95, -L / 2 - 0.02, 1.5, M.white, 0.72);
  // carretinha: 2 bunks por casco, 2 eixos
  const zf = bow + 0.15, zr = bz - L / 2 + 0.35;
  const h = sp!;
  trailer(K, M, g, {
    zc, zf, zr, halfW: 1.0, railY: 0.42, axleZ: bz - 0.4, axles: 2, wheelR: 0.3, track: 1.42,
    bunks: [-1, 1].flatMap((s) => [s * 0.82, s * 1.18].map((x) => bunkOn(h, by, bz, x, s * 1.0, zr + 0.15, bow - 1.6))),
    winch: { z: zf + 0.05, bowZ: bow - 0.05, bowY: by + TY + 0.35 },
    posts: { x: 1.62, z: zr + 0.3, top: 1.35 },
  });
};

// ---------------------------------------------------------------- offshore (degrau, capota de caça, 3 motores)
const offshore = (K: Kit, M: Mats, g: TransformNode, zc: number) => {
  const L = 11.2, by = 0.78, bow = zc - 1.3, bz = bow - L / 2, D = 1.05;
  const b = K.node("fOff", g, 0, by, bz);
  const H = buildHull(K, b, {
    L, B: 2.6, D, dead: 0.45, deadBow: 1.05, bowRise: 0.42, sheerRise: 0.06, flare: 0.05, chine: 0.07, entry: 0.36, crown: 0.12,
    bands: [
      { top: () => 0.42, mat: M.black },
      { top: (t) => 0.6 + 0.33 * t, mat: M.red },
      { top: (t) => 0.68 + 0.33 * t, mat: M.white },
      { top: () => 9, mat: M.black },
    ],
    deck: M.red, rub: M.black, rubR: 0.03, N: 72,
  });
  // capota (bolha de vidro) com moldura, tomadas de ar, capô do motor
  const cz = H.z(0.42), cy = H.deckY(0.42);
  const can = K.add(MeshBuilder.CreateSphere("fCanopy", { diameter: 1, segments: 20, slice: 0.5 }, K.scene), M.glass, b);
  can.scaling.set(1.25, 0.7, 2.7); can.position.set(0, cy - 0.04, cz);
  K.ribbon([0, 1].map((k) => { const p: Vector3[] = []; for (let j = 0; j <= 40; j++) { const a = (j / 40) * Math.PI * 2; p.push(V(Math.cos(a) * (0.64 + k * 0.08), cy + 0.02 - k * 0.04, cz + Math.sin(a) * (1.36 + k * 0.08))); } return p; }), M.black, b);
  K.tube([V(0, cy + 0.34, cz + 0.4), V(0, cy + 0.36, cz - 0.6)], 0.02, M.black, b, 6);
  loftRR(K, loftFn(14, (t) => ({ z: H.z(0.04 + 0.22 * t), w: lerp(1.7, 1.2, t * t), h: lerp(0.3, 0.06, smoothstep(0.5, 1, t)), y: H.deckY(0.15) + 0.1, r: 0.12 })), M.white, b);
  for (const s of [-1, 1]) {
    K.rbox(0.28, 0.24, 0.9, 0.08, s * 0.55, H.deckY(0.2) + 0.26, H.z(0.2), M.black, b);   // tomadas de ar
    K.rbox(0.22, 0.18, 0.04, 0.05, s * 0.55, H.deckY(0.2) + 0.28, H.z(0.2) + 0.45, M.matte, b);
  }
  K.rbox(0.45, 0.06, 0.3, 0.03, 0, H.deckY(0.95) + 0.03, H.z(0.95), M.steel, b);           // cunho de proa
  // 3 motores pretos de alta potência na popa (em placa elevadora)
  K.rbox(1.7, 0.3, 0.25, 0.05, 0, D - 0.2, -L / 2 - 0.12, M.steelDark, b);
  for (const x of [-0.62, 0, 0.62]) outboard(K, M, b, x, D - 0.08, -L / 2 - 0.25, 1.55, M.black, 0.62);
  const zf = bow + 0.15, zr = bz - L / 2 + 0.5;
  trailer(K, M, g, {
    zc, zf, zr, halfW: 0.62, railY: 0.42, axleZ: bz - 0.6, axles: 3, wheelR: 0.3, track: 1.02,
    bunks: [-1, 1].map((s) => bunkOn(H, by, bz, s * 0.48, 0, zr + 0.2, bow - 3.2)),
    rollers: { zs: [bow - 2.6, bow - 1.8], y: (z) => by + H.bottomY(H.tOf(z - bz), 0) },
    winch: { z: zf + 0.05, bowZ: bow - 0.08, bowY: by + H.sec(0.985).k + 0.15 },
    posts: { x: 1.42, z: zr + 0.3, top: 1.3 },
  });
};

// ---------------------------------------------------------------- lancha cabinada 50 pés (flybridge) no cavalo mecânico
const cruiser = (K: Kit, M: Mats, g: TransformNode, front: number) => {
  const kp = buildSemi(K, M, g, front);
  const L = 15.2, D = 2.2, SR = 0.55, by = 1.1, bow = kp - 1.1, bz = bow - L / 2;
  const b = K.node("fCruiser", g, 0, by, bz);
  const sheer = (t: number) => D + SR * t * t;
  const H = buildHull(K, b, {
    L, B: 4.4, D, dead: 0.33, deadBow: 0.95, bowRise: 1.25, sheerRise: SR, flare: 0.22, chine: 0.13, entry: 0.5, crown: 0.1, N: 80,
    bands: [
      { top: () => 0.72, mat: M.antifoul },
      { top: () => 0.82, mat: M.white },
      { top: (t) => sheer(t) - 0.32, mat: M.gunmetal },
      { top: () => 9, mat: M.white },
    ],
    deck: M.white, rub: M.steel, rubR: 0.04,
    well: { depth: 0.9, t0: 0.0, t1: 0.22, floor: M.teak, gw: 0.2 },
  });
  // janelas no costado (cabines)
  for (const s of [-1, 1]) for (const [t, len] of [[0.45, 1.6], [0.58, 1.3], [0.68, 0.7]] as P2[]) {
    const y = 1.45 + (t - 0.45) * 0.6, x = H.sideX(t, y);
    const dx = (H.sideX(t + 0.02, y) - H.sideX(t - 0.02, y)) / (0.04 * L);
    const w = K.add(MeshBuilder.CreateCapsule("fPort", { radius: 0.11, height: len, orientation: V(0, 0, 1) }, K.scene), M.glass, b);
    w.scaling.set(0.35, 1, 1); w.position.set(s * (x - 0.01), y, H.z(t)); w.rotation.y = s * Math.atan(dx);
  }
  // superestrutura com faixa de vidro e para-brisa
  const ct0 = 0.22, ct1 = 0.74;
  const tc = (u: number) => lerp(ct0, ct1, u);
  buildCabin(K, b, {
    z0: H.z(ct0), z1: H.z(ct1), N: 36,
    base: (u) => ({ y: H.deckY(tc(u)) - 0.02, hw: H.sec(tc(u)).hs - lerp(0.42, 0.55, u) }),
    h: (u) => key(u, [[0, 1.6], [0.5, 1.58], [1, 0.32]]),
    roofHw: (u) => H.sec(tc(u)).hs - lerp(0.42, 0.55, u) - key(u, [[0, 0.1], [0.5, 0.18], [1, 0.75]]),
    crown: 0.1,
    bands: [{ f: 0.28, mat: M.white }, { f: 0.9, mat: M.glass }, { f: 1, mat: M.white }],
    roof: M.white, glassFrom: 0.56, aft: M.glass, front: M.white,
  });
  // cockpit: sofá em U, mesa de teca, porta de popa e plataforma de banho
  const ky = H.deckY(0.1);
  sofa(K, M, b, 0, ky + 0.42, H.z(0.03) + 0.35, 3.0, 0.62, 0);
  for (const s of [-1, 1]) sofa(K, M, b, s * 1.45, ky + 0.42, H.z(0.11), 1.4, 0.6, -s * Math.PI / 2);
  K.rbox(1.3, 0.06, 0.8, 0.1, 0, ky + 0.68, H.z(0.11), M.teak, b);
  K.cyl(0.62, 0.1, "y", 0, ky + 0.34, H.z(0.11), M.steel, b);
  K.rbox(4.0, 0.1, 1.2, 0.15, 0, 0.75, -L / 2 - 0.55, M.teak, b);
  for (const s of [-1, 0, 1]) K.box(0.08, 0.4, 0.9, s * 1.5, 0.55, -L / 2 - 0.45, M.white, b);
  K.tube([V(1.6, 0.8, -L / 2 - 1.1), V(1.6, 0.2, -L / 2 - 1.25)], 0.018, M.steel, b, 6);
  K.tube([V(1.9, 0.8, -L / 2 - 1.1), V(1.9, 0.2, -L / 2 - 1.25)], 0.018, M.steel, b, 6);
  // flybridge: mureta, para-brisa, console, assentos; arco de radar com hardtop
  const fu = 0.25, ft = tc(fu), fyTop = H.deckY(ft) - 0.02 + 1.6 + 0.08;
  const fz0 = H.z(ct0) + 0.2, fz1 = H.z(tc(0.5));
  loftRR(K, loftFn(12, (t) => ({ z: lerp(fz0, fz1, t), w: H.sec(tc(lerp(0, 0.5, t))).hs * 2 - 1.25 - 0.4 * t * t, h: 0.55, y: fyTop + 0.27, r: 0.18 })), M.white, b);
  K.rbox(H.sec(tc(0.3)).hs * 2 - 1.5, 0.04, fz1 - fz0 - 0.3, 0.2, 0, fyTop + 0.56, (fz0 + fz1) / 2, M.teak, b);
  const fws = K.rbox(2.3, 0.35, 0.03, 0.1, 0, fyTop + 0.82, fz1 - 0.05, M.glass, b); fws.rotation.x = -0.55;
  K.rbox(1.3, 0.55, 0.5, 0.08, 0.5, fyTop + 0.85, fz1 - 0.55, M.white, b);
  K.rbox(1.25, 0.05, 0.4, 0.03, 0.5, fyTop + 1.13, fz1 - 0.52, M.black, b).rotation.x = 0.3;
  sofa(K, M, b, 0.5, fyTop + 0.98, fz1 - 1.3, 1.3, 0.6, 0);
  sofa(K, M, b, -0.8, fyTop + 0.98, (fz0 + fz1) / 2 - 0.4, 2.0, 0.6, Math.PI / 2);
  const ay = fyTop + 2.6, az = fz0 + 0.6;
  for (const s of [-1, 1]) {
    K.beam(V(s * 1.45, fyTop + 0.5, az - 0.25), V(s * 1.2, ay, az + 0.15), 0.16, 0.42, M.white, b);  // pernas do arco
    K.tube([V(s * 1.2, fyTop + 0.6, fz1 - 0.2), V(s * 1.1, ay - 0.05, fz1 - 0.35)], 0.035, M.steel, b, 8);
  }
  K.rbox(2.8, 0.14, (fz1 - 0.25) - (az - 0.2), 0.12, 0, ay + 0.05, (az - 0.2 + fz1 - 0.25) / 2, M.white, b);
  K.rbox(2.75, 0.03, (fz1 - 0.3) - (az - 0.15), 0.12, 0, ay - 0.04, (az - 0.2 + fz1 - 0.25) / 2, M.matte, b);
  K.cyl(0.24, 0.62, "y", 0, ay + 0.26, az + 0.3, M.white, b);                      // radome
  K.rbox(0.9, 0.12, 0.25, 0.05, 0, ay + 0.2, az - 0.1, M.black, b);                // antena aberta (radar)
  for (const s of [-1, 1]) K.tube([V(s * 1.1, ay + 0.1, az), V(s * 1.15, ay + 2.4, az - 0.2)], 0.012, M.white, b, 5);
  K.box(0.06, 0.06, 0.06, 0, ay + 0.15, az + 0.6, M.lightWhite, b);
  // solário de proa, guarda-mancebo, âncora
  const pz = H.z(0.8), py = H.deckY(0.8);
  K.rbox(2.4, 0.12, 1.8, 0.3, 0, py + 0.1, pz, M.cushion, b);
  const top: Vector3[] = [];
  for (let i = 0; i <= 26; i++) { const t = 0.3 + (0.7 * i) / 26; const sc = H.sec(t); top.push(V(Math.max(0.0, sc.hs - 0.1), sc.s + 0.62, H.z(t) - (i === 26 ? 0.18 : 0))); }
  const topL = top.map((p) => V(-p.x, p.y, p.z)).reverse();
  rail(K, M, b, [...top, ...topL.slice(1)], 0.62, 3, 0.025);
  K.rbox(0.25, 0.12, 0.55, 0.04, 0, H.sec(0.99).s + 0.02, H.z(0.99) + 0.1, M.steel, b);
  // pés IPS sob o casco (rabetas com hélices duplas)
  for (const s of [-1, 1]) {
    const t = 0.2, x = s * 0.75, yb = H.bottomY(t, x);
    const pod = K.add(MeshBuilder.CreateCapsule("fIps", { radius: 0.1, height: 0.7, orientation: V(0, 1, 0) }, K.scene), M.steelDark, b);
    pod.position.set(x, yb - 0.3, H.z(t)); pod.rotation.x = -0.2;
    const gear = K.add(MeshBuilder.CreateCapsule("fIpsG", { radius: 0.11, height: 0.75, orientation: V(0, 0, 1) }, K.scene), M.steelDark, b);
    gear.position.set(x, yb - 0.62, H.z(t) + 0.05);
    const tmp: Mesh[] = [];
    const pn = K.node("fIpsP", b, x, yb - 0.62, H.z(t) + 0.45);
    pn.rotation.y = Math.PI;
    const { propBlur } = buildPropeller(K.scene, pn, V(0, 0, 0), 0.24, 0.6, M.steel as PBRMaterial, (m, mat, p) => K.add(m, mat, p ?? pn), tmp);
    for (const m of tmp) m.dispose();
    propBlur.dispose();
  }
  // carreta de prancha rebaixada com berços hidráulicos (pescoço sobre a quinta roda)
  const zr = bz - L / 2 + 0.4, neck0 = kp - 1.7, neck1 = kp - 2.9;
  K.rbox(2.5, 0.3, 2.6, 0.08, 0, 1.47, kp - 0.45, M.black, g);
  K.cyl(0.1, 0.12, "y", 0, 1.28, kp, M.steelDark, g);
  for (const s of [-1, 1]) {
    K.beam(V(s * 0.55, 1.4, neck0 + 0.1), V(s * 0.55, 0.85, neck1), 0.2, 0.34, M.black, g);
    K.box(0.2, 0.34, neck1 - zr, s * 0.55, 0.82, (neck1 + zr) / 2, M.black, g);
    K.box(0.3, 0.1, 0.08, s * 1.15, 0.9, zr + 0.05, M.lightRed, g);
  }
  K.box(2.3, 0.06, 0.06, 0, 0.82, zr + 0.02, M.steelDark, g);
  const axZ = [bz - 2.4, bz - 3.5, bz - 4.6];
  for (const za of axZ) {
    K.cyl(2.2, 0.12, "x", 0, 0.5, za, M.steelDark, g);
    for (const s of [-1, 1]) { wheel(K, M, g, s * 1.15, 0.5, 0.3, za); K.cyl(0.27, 0.98, "x", s * 0.84, 0.5, za, M.tire, g); }
  }
  for (const s of [-1, 1]) K.rbox(0.75, 0.05, axZ[0] - axZ[2] + 1.3, 0.02, s * 1.0, 1.08, (axZ[0] + axZ[2]) / 2, M.black, g);
  // berços: macacos hidráulicos amarelos com sapatas, blocos de quilha
  for (const zz of [bz + 4.2, bz + 1.4, bz - 1.4, bz - 5.6]) {
    const t = H.tOf(zz - bz);
    K.box(2.9, 0.16, 0.22, 0, 0.82, zz, M.black, g);
    for (const s of [-1, 1]) {
      const x = s * 1.38, top = by + H.bottomY(t, x);
      K.cyl(top - 0.95, 0.12, "y", x, (top + 0.95) / 2 - 0.04, zz, M.hydraulic, g);
      K.cyl(0.2, 0.18, "y", x, 1.0, zz, M.steelDark, g);
      const sl = (H.bottomY(t, 1.42) - H.bottomY(t, 1.34)) / 0.08;
      const pad = K.rbox(0.36, 0.06, 0.4, 0.02, x, top - 0.04, zz, M.black, g); pad.rotation.z = s * Math.atan(sl);
    }
    const kt = by + H.bottomY(t, 0);
    if (kt > 1.05) K.box(0.3, kt - 0.98, 0.5, 0, (kt + 0.98) / 2, zz, M.wood, g);
  }
};
