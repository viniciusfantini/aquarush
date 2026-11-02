// Lancha de turbina AR-10 (10 m, piloto único no centro, habitáculo fechado) — visual procedural.
// Casco em V profundo com pintura de corrida, CANOPY (bolha de vidro com arcos de estrutura) sobre o poço do
// piloto, tampa da turbina com duas tomadas de ar laterais e a CHAMINÉ do escape saindo para trás, e a
// transmissão de superfície no espelho: eixo inclinado, quilha-leme e a hélice de superfície (meio fora d'água
// em planeio). Nó do pivô = trim/direção da transmissão (mesmos ângulos da física). Só lê a simulação.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3 } from "@babylonjs/core";
import { TURBINA } from "../sim/params.ts";
import { buildPropeller, type BoatVisual } from "./boatMesh.ts";
import { makeKit, makeMats, buildHull, loftRR, loftFn } from "./fleet.ts";
import { smoothstep } from "../sim/math.ts";

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

  // ---- tampa da turbina, tomadas de ar e chaminé do escape ----
  const z0 = -1.6, z1 = -4.7;
  loftRR(K, loftFn(18, (t) => ({ z: z0 + (z1 - z0) * t, w: 1.55 - 0.15 * t, h: 0.18 + 0.32 * smoothstep(0, 0.25, t) - 0.1 * smoothstep(0.75, 1, t), y: deckTop(-3) - 0.02, r: 0.14 })), M.gunmetal, root);
  for (const s of [-1, 1]) {
    // tomada de ar (scoop) com a boca preta voltada para a frente
    const x = s * 0.82, zc = -2.15, y = deckTop(zc) + 0.2;
    K.rbox(0.34, 0.36, 1.0, 0.08, x, y, zc - 0.25, M.gunmetal, root);
    K.rbox(0.26, 0.28, 0.05, 0.05, x, y + 0.01, zc + 0.26, M.black, root);
    K.rbox(0.36, 0.05, 1.02, 0.02, x, y + 0.19, zc - 0.25, M.yellow, root); // filete
  }
  // grade do topo (radiador de óleo) e a chaminé do escape (curva para trás), com a boca enegrecida
  K.rbox(0.7, 0.03, 0.8, 0.02, 0, deckTop(-3.2) + 0.47, -3.2, M.black, root);
  const ey = deckTop(-4.2) + 0.32;
  const stack = [new Vector3(0, ey - 0.15, -3.95), new Vector3(0, ey + 0.2, -4.15), new Vector3(0, ey + 0.38, -4.45), new Vector3(0, ey + 0.42, -4.85), new Vector3(0, ey + 0.4, -5.12)];
  K.tube(stack, 0.21, M.steel, root, 18);
  K.cyl(0.04, 0.38, "z", 0, ey + 0.4, -5.14, M.black, root);
  K.tube(stack.slice(2).map((v) => new Vector3(v.x, v.y + 0.005, v.z - 0.02)), 0.215, M.matte, root, 18); // fuligem na ponta

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
  const tmp: Mesh[] = [];
  const { propeller, propBlur } = buildPropeller(scene, piv, new Vector3(0, dy, dz), P.propRadius, 0.9, M.steel as PBRMaterial, (m, mat, p) => K.add(m, mat, p ?? piv), tmp);
  K.out.push(...tmp);

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
  return { root, engine: piv, propeller, telltale, propBlur, lights: { port, star, stern }, cockpitLid, meshes, floor };
};
