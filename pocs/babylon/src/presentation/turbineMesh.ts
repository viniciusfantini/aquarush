// Lancha de turbina AR-10 (10 m, piloto único no centro, habitáculo fechado) — visual procedural.
// Casco em V profundo com pintura de corrida, CANOPY (bolha de vidro com arcos de estrutura) sobre o poço do
// piloto, tampa da turbina com duas tomadas de ar laterais e UM duto de escape de inox polido que sai da tampa e
// curva para cima (boca a 45°, para cima e para trás), e a
// transmissão de superfície no espelho: eixo inclinado, quilha-leme e a hélice de superfície (meio fora d'água
// em planeio). Nó do pivô = trim/direção da transmissão (mesmos ângulos da física). Só lê a simulação.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3 } from "@babylonjs/core";
import type { Kit, Mats } from "./fleet.ts";
import { TURBINA } from "../sim/params.ts";
import { type BoatVisual } from "./boatMesh.ts";
import { makeKit, makeMats, buildHull, loftRR, loftFn } from "./fleet.ts";
import { smoothstep } from "../sim/math.ts";

/**
 * Hélice de SUPERFÍCIE (surface piercing) estilo "cleaver" (cutelo): 6 pás de inox polido com bordo de ataque afiado
 * e curvo, bordo de fuga RETO (radial) e grosso — a pá é uma cunha, fina na entrada e larga na saída — com "cup" (a
 * borda de fuga dobrada para a face de pressão) e um leve caimento para trás; cubo longo e cônico. Gira em torno de
 * Z local (o nó devolvido); o disco de borrão aparece com a rotação.
 */
const buildSurfaceProp = (scene: Scene, K: Kit, M: Mats, parent: TransformNode, pos: Vector3, R: number, pitch: number) => {
  const prop = new TransformNode("propeller", scene);
  prop.parent = parent; prop.position.copyFrom(pos);
  const BLADES = 6, NR = 14, NS = 9, RH = 0.085;
  for (let b = 0; b < BLADES; b++) {
    const th0 = (b / BLADES) * Math.PI * 2;
    const rows: Vector3[][] = [];
    for (let i = 0; i <= NR; i++) {
      const u = i / NR, r = RH + (R - RH) * u;
      // corda cresce para a ponta (cutelo); a ponta é cortada quase reta, com um arredondamento pequeno
      const chord = (0.08 + 0.2 * Math.pow(u, 0.85)) * (u > 0.92 ? Math.sqrt(Math.max(0.05, 1 - ((u - 0.92) / 0.08) ** 2)) : 1);
      const phi = Math.atan(pitch / (2 * Math.PI * r));                  // ângulo do passo nesse raio
      const tMax = 0.018 * (1 - 0.55 * u) + 0.005;                       // espessura máxima (no bordo de fuga)
      const rake = -0.05 * u;                                            // caimento para trás
      const upper: Vector3[] = [], lower: Vector3[] = [];
      for (let j = 0; j <= NS; j++) {
        const s = j / NS;                                                // 0 = bordo de ataque, 1 = bordo de fuga
        const a = (1 - s) * chord;                                       // o bordo de FUGA fica na linha radial th0
        const th = th0 + (a * Math.cos(phi)) / r;
        const z = -a * Math.sin(phi) + rake;
        const t = tMax * Math.pow(s, 0.65);                              // cunha: afiada na entrada, grossa na saída
        const cup = 0.008 * Math.pow(Math.max(0, (s - 0.8) / 0.2), 2);    // cup na borda de fuga (face de pressão)
        const x = r * Math.cos(th), y = r * Math.sin(th);
        upper.push(new Vector3(x, y, z + t * 0.5));
        lower.push(new Vector3(x, y, z - t * 0.5 - cup));
      }
      rows.push([...upper, ...lower.reverse()]);
    }
    // ponta fechada (última seção colapsada no meio)
    const last = rows[rows.length - 1];
    const c = last.reduce((acc, p) => acc.addInPlace(p), new Vector3()).scaleInPlace(1 / last.length);
    rows.push(last.map((p) => Vector3.Lerp(p, c, 0.85)));
    const blade = MeshBuilder.CreateRibbon("spBlade", { pathArray: rows, closePath: true, sideOrientation: Mesh.DOUBLESIDE }, scene);
    K.add(blade, M.steel, prop);
  }
  // cubo longo e cônico (a transmissão de superfície tem o eixo exposto) + porca cônica atrás
  const hub = K.add(MeshBuilder.CreateCylinder("spHub", { height: 0.26, diameterTop: 0.13, diameterBottom: 0.18, tessellation: 24 }, scene), M.steel, prop);
  hub.rotation.x = Math.PI / 2; hub.position.z = 0.02;
  const nut = K.add(MeshBuilder.CreateCylinder("spNut", { height: 0.1, diameterTop: 0.02, diameterBottom: 0.13, tessellation: 24 }, scene), M.steel, prop);
  nut.rotation.x = -Math.PI / 2; nut.position.z = -0.16;
  // disco de borrão (a hélice girando rápido)
  const propBlur = new PBRMaterial("spBlur", scene);
  propBlur.albedoColor = new Color3(0.78, 0.8, 0.83); propBlur.metallic = 1; propBlur.roughness = 0.35; propBlur.alpha = 0; propBlur.backFaceCulling = false;
  const disc = MeshBuilder.CreateDisc("propDisc", { radius: R, tessellation: 40 }, scene);
  disc.material = propBlur; disc.parent = parent; disc.position.copyFrom(pos); disc.isPickable = false;
  K.out.push(disc);
  return { propeller: prop, propBlur };
};

export const buildTurbina = (scene: Scene): BoatVisual & { floor: number } => {
  const K = makeKit(scene);
  const M = makeMats(scene);
  const P = TURBINA;
  const root = new TransformNode("boat", scene);
  const L = P.length, keel = -0.55;
  const hullN = K.node("turHull", root, 0, keel, 0);
  const seat = P.seats.helm;
  const H0 = { L, B: P.beam, D: 1.06, dead: 0.46, deadBow: 1.1, bowRise: 0.45, sheerRise: 0.1, flare: 0.05, chine: 0.08, entry: 0.4, crown: 0.16, N: 90 };
  const tOf = (z: number) => (z + L / 2) / L;
  // casco: fundo preto, costado grafite com faixa amarela; poço estreito só para o piloto (convés largo dos lados)
  const H = buildHull(K, hullN, {
    ...H0,
    bands: [
      { top: () => 0.42, mat: M.black },
      { top: (t) => 0.6 + 0.24 * t, mat: M.gunmetal },
      { top: (t) => 0.66 + 0.24 * t, mat: M.yellow },
      { top: () => 9, mat: M.gunmetal },
    ],
    deck: M.white, rub: M.black, rubR: 0.035,
    well: { depth: 0.62, t0: tOf(-1.35), t1: tOf(0.2), floor: M.nonskid, gw: 0.78 },
  });
  const yD = (z: number) => keel + H.deckY(H.tOf(z));
  const deckTop = (z: number) => keel + H.sec(H.tOf(z)).s;
  const floor = yD(seat.z);

  // ---- canopy: bolha de vidro (visível de dentro) com arcos de estrutura ----
  const cz = -0.5, cLen = 2.3, cW = 1.16, cH = 0.86, cy = deckTop(cz) - 0.02;
  const glassMat = new StandardMaterial("turCanopy", scene);
  glassMat.diffuseColor = new Color3(0.05, 0.09, 0.12); glassMat.specularColor = new Color3(0.9, 0.95, 1); glassMat.specularPower = 180;
  glassMat.alpha = 0.3; glassMat.backFaceCulling = false;
  const bubble = MeshBuilder.CreateSphere("canopyGlass", { diameter: 1, segments: 24, slice: 0.5 }, scene);
  bubble.material = glassMat; bubble.parent = root;
  bubble.scaling.set(cW, cH * 2, cLen); bubble.position.set(0, cy, cz);
  bubble.alphaIndex = 20; // depois da água (10): o vidro não some contra ela
  K.out.push(bubble);
  // arcos (moldura): central e dois transversais, mais o anel da base
  const arc = (k: number, n = 18) => Array.from({ length: n + 1 }, (_, i) => { const a = Math.PI * (i / n); return new Vector3(Math.cos(a) * (cW / 2) * k, cy + Math.sin(a) * cH * k, 0); });
  // (sem arco longitudinal no meio: ele ficaria bem na frente dos olhos do piloto)
  for (const dz of [-0.35, 0.3]) {
    const k = Math.sqrt(Math.max(0, 1 - (dz / (cLen / 2)) ** 2)) * 1.01;
    const p = arc(k).map((v) => new Vector3(v.x, cy + (v.y - cy), cz + dz));
    K.tube(p, 0.022, M.gunmetal, root, 6);
  }
  K.tube(Array.from({ length: 37 }, (_, i) => { const a = 2 * Math.PI * (i / 36); return new Vector3(Math.cos(a) * cW / 2 * 1.02, cy + 0.01, cz + Math.sin(a) * cLen / 2 * 1.02); }), 0.03, M.gunmetal, root, 6);
  // escotilha de saída de emergência (marcação vermelha no topo) e antena
  K.rbox(0.36, 0.012, 0.42, 0.01, 0, cy + cH - 0.005, cz + 0.05, M.red, root);

  // ---- banco do piloto (concha alta, cinto de 5 pontos) ----
  K.rbox(0.52, 0.12, 0.5, 0.06, seat.x, floor + 0.24, seat.z - 0.05, M.black, root);
  const back = K.rbox(0.54, 0.72, 0.14, 0.07, seat.x, floor + 0.62, seat.z - 0.34, M.black, root); back.rotation.x = -0.22;
  for (const s of [-1, 1]) K.box(0.05, 0.6, 0.012, s * 0.12, floor + 0.62, seat.z - 0.26, M.red, root).rotation.x = -0.22; // cintos
  K.rbox(0.58, 0.2, 0.58, 0.05, seat.x, floor + 0.09, seat.z - 0.05, M.gunmetal, root);

  // ---- tampa da turbina, tomadas de ar e dutos do escape ----
  const z0 = -1.6, z1 = -4.7;
  loftRR(K, loftFn(18, (t) => ({ z: z0 + (z1 - z0) * t, w: 1.55 - 0.15 * t, h: 0.18 + 0.32 * smoothstep(0, 0.25, t) - 0.1 * smoothstep(0.75, 1, t), y: deckTop(-3) - 0.02, r: 0.14 })), M.gunmetal, root);
  for (const s of [-1, 1]) {
    // tomada de ar (scoop) com a boca preta voltada para a frente
    const x = s * 0.82, zc = -2.15, y = deckTop(zc) + 0.2;
    K.rbox(0.34, 0.36, 1.0, 0.08, x, y, zc - 0.25, M.gunmetal, root);
    K.rbox(0.26, 0.28, 0.05, 0.05, x, y + 0.01, zc + 0.26, M.black, root);
    K.rbox(0.36, 0.05, 1.02, 0.02, x, y + 0.19, zc - 0.25, M.yellow, root); // filete
  }
  // grade do topo (radiador de óleo)
  K.rbox(0.7, 0.03, 0.8, 0.02, 0, deckTop(-3.2) + 0.47, -3.2, M.black, root);
  // escape: UM duto de aço inox polido (prata) sai da traseira da tampa pelo centro, corre para trás e faz uma curva
  // suave para cima: a boca aponta 45° para cima e para trás (o gás quente e a fumaça vão para longe do convés)
  const exhausts: TransformNode[] = [];
  {
    const R = 0.2, bend = 0.45, yC = deckTop(-4.0) + 0.24, zB = -4.5;
    const path: Vector3[] = [new Vector3(0, yC, -3.95), new Vector3(0, yC, zB)];
    for (let i = 1; i <= 10; i++) { const a = (Math.PI / 4) * (i / 10); path.push(new Vector3(0, yC + bend * (1 - Math.cos(a)), zB - bend * Math.sin(a))); }
    const d45 = new Vector3(0, Math.SQRT1_2, -Math.SQRT1_2);
    const tip = path[path.length - 1].add(d45.scale(0.24));
    path.push(tip);
    K.tube(path, R, M.steel, root, 24);
    // lábio da boca (anel), a boca escura e a fuligem logo dentro
    const lip = MeshBuilder.CreateTorus("exhLip", { diameter: 2 * R + 0.02, thickness: 0.035, tessellation: 28 }, scene);
    lip.parent = root; lip.material = M.steel; lip.position.copyFrom(tip); lip.rotation.x = -Math.PI / 4;
    const mouth = MeshBuilder.CreateDisc("exhMouth", { radius: R * 0.97, tessellation: 24 }, scene);
    mouth.parent = root; mouth.material = M.black; mouth.position.copyFrom(tip.subtract(d45.scale(0.03))); mouth.rotation.x = Math.PI / 4;
    K.out.push(lip, mouth);
    // abraçadeiras e o suporte no convés (o duto passa por cima da chapa de proteção térmica)
    for (const z of [-4.25, zB]) K.tube(Array.from({ length: 21 }, (_, i) => { const a = (2 * Math.PI * i) / 20; return new Vector3(Math.cos(a) * (R + 0.012), yC + Math.sin(a) * (R + 0.012), z); }), 0.014, M.gunmetal, root, 6);
    K.rbox(0.08, yC - deckTop(zB) - R + 0.02, 0.12, 0.02, 0, (yC - R + deckTop(zB)) / 2, zB, M.gunmetal, root);
    K.rbox(0.62, 0.012, 1.0, 0.01, 0, deckTop(-4.6) + 0.01, -4.6, M.matte, root);
    // nó da boca: −Z local = saída do gás (45° para cima, para trás)
    const n = K.node("exhaust", root, tip.x, tip.y, tip.z);
    n.rotation.x = Math.PI / 4;
    exhausts.push(n);
  }

  // ---- tomada de força externa (GPU) nos dois costados, à ré: tampa preta com aro amarelo ----
  for (const s of [-1, 1]) {
    const t = H.tOf(-2.8), sc = H.sec(t), y = keel + sc.s - 0.1;
    K.rbox(0.02, 0.16, 0.2, 0.01, s * (sc.hs + 0.005), y, -2.8, M.yellow, root);
    K.rbox(0.024, 0.11, 0.14, 0.01, s * (sc.hs + 0.008), y, -2.8, M.black, root);
  }

  // ---- abas de trim no espelho e cunhos ----
  for (const s of [-1, 1]) {
    K.box(0.42, 0.02, 0.32, s * 0.75, keel + 0.12, -L / 2 - 0.14, M.steel, root);
    K.rbox(0.05, 0.04, 0.22, 0.015, s * 0.95, yD(-4.6) + 0.03, -4.6, M.steel, root);
  }
  K.rbox(0.05, 0.04, 0.22, 0.015, 0, yD(4.4) + 0.03, 4.4, M.steel, root);

  // ---- luzes de navegação ----
  const navMat = (n: string) => { const m = new StandardMaterial(n, scene); m.diffuseColor = new Color3(0.2, 0.2, 0.2); m.emissiveColor = Color3.Black(); return m; };
  const port = navMat("turNavPort"), star = navMat("turNavStar"), stern = navMat("turNavStern");
  for (const [s, m] of [[-1, port], [1, star]] as [number, StandardMaterial][]) {
    const t = 0.84, sc = H.sec(t);
    K.box(0.04, 0.05, 0.12, s * (sc.hs - 0.02), keel + sc.s + 0.03, H.z(t), m, root);
  }
  K.cyl(0.06, 0.06, "y", 0, deckTop(-4.5) + 0.52, -4.5, stern, root);

  // ---- transmissão de superfície: pivô no espelho (trim + direção), eixo, quilha-leme e hélice ----
  const piv = K.node("enginePivot", root, P.drivePivot.x, P.drivePivot.y, P.drivePivot.z);
  const dz = P.propPos.z - P.drivePivot.z, dy = P.propPos.y - P.drivePivot.y;
  K.rbox(0.42, 0.34, 0.3, 0.08, 0, 0.02, 0.05, M.gunmetal, piv);                     // caixa da junta (no espelho)
  K.tube([new Vector3(0, 0, -0.05), new Vector3(0, dy * 0.92, dz * 0.92 + 0.12)], 0.085, M.steel, piv, 14); // tubo do eixo
  K.cyl(0.32, 0.17, "z", 0, dy + 0.02, dz + 0.3, M.steel, piv, 0.13);               // mancal da hélice
  const skeg = K.box(0.025, 0.42, 0.42, 0, dy - 0.24, dz + 0.42, M.black, piv); skeg.name = "skeg"; skeg.rotation.x = 0.18; // quilha-leme
  for (const s of [-1, 1]) {
    // cilindros hidráulicos do trim e da direção (do espelho ao eixo)
    K.tube([new Vector3(s * 0.28, 0.18, 0), new Vector3(s * 0.12, dy * 0.5 + 0.08, dz * 0.55)], 0.035, M.hydraulic, piv, 8);
  }
  const { propeller, propBlur } = buildSurfaceProp(scene, K, M, piv, new Vector3(0, dy, dz), P.propRadius, 1.05);

  // tampa invisível do poço do piloto (só profundidade): a água não aparece dentro do barco
  const lidMat = new StandardMaterial("turLidMat", scene);
  lidMat.disableColorWrite = true; lidMat.forceDepthWrite = true; lidMat.alpha = 0.01; lidMat.backFaceCulling = false;
  const ckZ: number[] = [];
  for (let i = 0; i <= 10; i++) ckZ.push(-1.35 + 1.55 * (i / 10));
  const cockpitLid = MeshBuilder.CreateRibbon("cockpitLid", { pathArray: ckZ.map((z) => { const sc = H.sec(H.tOf(z)); return [new Vector3(-(sc.hs - 0.78), keel + sc.s - 0.03, z), new Vector3(sc.hs - 0.78, keel + sc.s - 0.03, z)]; }) }, scene);
  cockpitLid.material = lidMat; cockpitLid.parent = root; cockpitLid.alphaIndex = 0;
  // turbina: não há esguicho de refrigeração (o óleo é resfriado por trocador de calor)
  const telltale = new TransformNode("telltale", scene); telltale.parent = piv;
  const meshes = [...K.out, cockpitLid];
  for (const m of meshes) { m.isPickable = false; m.receiveShadows = true; }
  return { root, engine: piv, propeller, telltale, propBlur, lights: { port, star, stern }, cockpitLid, meshes, floor, exhausts };
};
