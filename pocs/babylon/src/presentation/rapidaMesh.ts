// Lancha rápida AR-9 (8,6 m, 2 lugares, dois V8 de centro com rabeta) — visual procedural.
// Casco em V profundo com pintura de corrida, convés longo, cockpit de dois lugares com para-brisa baixo,
// tampa da praça de máquinas com tomadas de ar e DUAS rabetas (sterndrive), cada uma com o seu nó de
// pivô (trim/tilt/direção, os mesmos ângulos da física) e a sua hélice. Só lê a simulação.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3 } from "@babylonjs/core";
import { RAPIDA } from "../sim/params.ts";
import { buildPropeller, type BoatVisual } from "./boatMesh.ts";
import { makeKit, makeMats, buildHull, loftRR, loftFn, rail, type Kit, type Mats } from "./fleet.ts";
import { smoothstep } from "../sim/math.ts";

/** Uma rabeta (sterndrive): carcaça do gimbal, perna, torpedo, quilha e hélice. Pivô no espelho. */
const sterndrive = (K: Kit, M: Mats, root: TransformNode, x: number, name: string, withSkeg: boolean) => {
  const P = RAPIDA;
  const piv = K.node(name, root, P.drivePivot.x + x, P.drivePivot.y, P.drivePivot.z);
  const leg = K.node(name + "Leg", piv, 0, 0, 0); // a perna gira junto com o pivô (trim/tilt/direção)
  const dz = P.propPos.z - P.drivePivot.z, dy = P.propPos.y - P.drivePivot.y;
  K.rbox(0.34, 0.3, 0.32, 0.06, 0, 0.0, -0.12, M.black, leg);              // carcaça do gimbal (cardã)
  K.rbox(0.28, 0.22, 0.42, 0.06, 0, -0.05, -0.38, M.matte, leg);           // carenagem superior
  // perna (perfil hidrodinâmico) inclinada para trás até o torpedo
  const top = new Vector3(0, -0.12, -0.42), bot = new Vector3(0, dy + 0.06, dz + 0.12);
  const len = Vector3.Distance(top, bot);
  const strut = K.cyl(len, 1, "y", 0, (top.y + bot.y) / 2, (top.z + bot.z) / 2, M.black, leg);
  strut.scaling.set(0.1, 1, 0.3); strut.rotation.x = Math.atan2(top.z - bot.z, top.y - bot.y);
  const plate = K.cyl(0.018, 1, "y", 0, dy + 0.27, dz + 0.08, M.black, leg); plate.scaling.set(0.36, 1, 0.6); // placa anticavitação
  const torp = K.add(MeshBuilder.CreateCapsule(name + "Torp", { radius: 0.085, height: 0.62, orientation: new Vector3(0, 0, 1) }, K.scene), M.black, leg);
  torp.position.set(0, dy, dz + 0.28);
  const skeg = K.box(0.02, 0.24, 0.22, 0, dy - 0.16, dz + 0.24, M.black, leg); skeg.rotation.x = 0.22;
  if (withSkeg) skeg.name = "skeg";
  const tmp: Mesh[] = [];
  const { propeller, propBlur } = buildPropeller(K.scene, leg, new Vector3(0, dy, dz), P.propRadius, 0.6, M.steel as PBRMaterial, (m, mat, p) => K.add(m, mat, p ?? leg), tmp);
  K.out.push(...tmp);
  return { engine: piv, propeller, propBlur };
};

/** `floor`: altura local do piso do cockpit (pés do piloto e do navegador; base do painel). */
export const buildRapida = (scene: Scene): BoatVisual & { floor: number } => {
  const K = makeKit(scene);
  const M = makeMats(scene);
  const P = RAPIDA;
  const root = new TransformNode("boat", scene);
  const L = P.length, keel = -0.52;
  const hullN = K.node("rapHull", root, 0, keel, 0);
  // casco: V profundo (24°), proa longa e fina, pintura de corrida (fundo preto, faixas vermelha/amarela, costado branco)
  const H = buildHull(K, hullN, {
    L, B: P.beam, D: 1.02, dead: 0.44, deadBow: 1.05, bowRise: 0.5, sheerRise: 0.12, flare: 0.06, chine: 0.08, entry: 0.38, crown: 0.14, N: 80,
    bands: [
      { top: () => 0.42, mat: M.black },
      { top: (t) => 0.56 + 0.28 * t, mat: M.red },
      { top: (t) => 0.63 + 0.28 * t, mat: M.yellow },
      { top: () => 9, mat: M.white },
    ],
    deck: M.white, rub: M.black, rubR: 0.035,
    well: { depth: 0.48, t0: 0.27, t1: 0.47, floor: M.nonskid, gw: 0.18 }, // cockpit de 2 lugares
  });
  const yD = (z: number) => keel + H.deckY(H.tOf(z));
  // praça de máquinas: tampa longa com tomadas de ar
  loftRR(K, loftFn(16, (t) => ({ z: -4.15 + 2.0 * t, w: 1.75 - 0.25 * t * t, h: 0.24 - 0.12 * smoothstep(0.6, 1, t), y: yD(-3.1) + 0.1, r: 0.12 })), M.white, root);
  for (const s of [-1, 1]) {
    K.rbox(0.3, 0.2, 0.9, 0.07, s * 0.62, yD(-3.2) + 0.24, -3.2, M.black, root);
    K.rbox(0.22, 0.14, 0.04, 0.05, s * 0.62, yD(-3.2) + 0.26, -2.74, M.matte, root);
  }
  // para-brisa baixo e envolvente, moldura preta
  const wsZ = -0.12, wsY = yD(wsZ);
  const glass = K.ribbon([0, 1].map((k) => {
    const p: Vector3[] = [];
    for (let j = 0; j <= 16; j++) { const a = -1 + (2 * j) / 16; p.push(new Vector3(a * 1.05, wsY + 0.02 + k * 0.32, wsZ + 0.18 * (1 - a * a) - k * 0.2)); }
    return p;
  }), M.glass, root);
  glass.name = "windshield";
  K.tube(Array.from({ length: 17 }, (_, j) => { const a = -1 + (2 * j) / 16; return new Vector3(a * 1.05, wsY + 0.34, wsZ + 0.18 * (1 - a * a) - 0.2); }), 0.018, M.black, root, 6);
  // bancos tipo concha (piloto em boreste, navegador em bombordo) e encosto de apoio
  for (const s of [P.seats.helm, P.seats.passenger]) {
    const fy = yD(s.z);
    K.rbox(0.5, 0.14, 0.5, 0.07, s.x, fy + 0.3, s.z - 0.05, M.cushion, root);
    const back = K.rbox(0.5, 0.62, 0.14, 0.08, s.x, fy + 0.62, s.z - 0.32, M.cushion, root); back.rotation.x = -0.18;
    K.rbox(0.56, 0.28, 0.56, 0.06, s.x, fy + 0.11, s.z - 0.05, M.navy, root);
  }
  // corrimãos de inox no convés de proa e cunhos
  const deckRail: Vector3[] = [];
  for (let i = 0; i <= 12; i++) { const t = 0.62 + 0.3 * (i / 12); const sc = H.sec(t); deckRail.push(new Vector3(sc.hs - 0.12, keel + sc.s + 0.18, H.z(t))); }
  rail(K, M, root, deckRail, 0.18, 4, 0.016);
  rail(K, M, root, deckRail.map((p) => new Vector3(-p.x, p.y, p.z)), 0.18, 4, 0.016);
  for (const s of [-1, 1]) K.rbox(0.05, 0.04, 0.22, 0.015, s * 0.95, yD(-3.9) + 0.03, -3.9, M.steel, root);
  // luzes de navegação: laterais na proa (vermelha/verde) e luz de alcançado no mastro da popa
  const navMat = (n: string) => { const m = new StandardMaterial(n, scene); m.diffuseColor = new Color3(0.2, 0.2, 0.2); m.emissiveColor = Color3.Black(); return m; };
  const port = navMat("rapNavPort"), star = navMat("rapNavStar"), stern = navMat("rapNavStern");
  for (const [s, m] of [[-1, port], [1, star]] as [number, StandardMaterial][]) {
    const t = 0.82, sc = H.sec(t);
    K.box(0.04, 0.05, 0.12, s * (sc.hs - 0.02), keel + sc.s + 0.03, H.z(t), m, root);
  }
  K.tube([new Vector3(0, yD(-3.6) + 0.1, -3.6), new Vector3(0, yD(-3.6) + 0.9, -3.6)], 0.018, M.steel, root, 6);
  K.cyl(0.07, 0.06, "y", 0, yD(-3.6) + 0.93, -3.6, stern, root);
  // duas rabetas (bombordo, boreste)
  const drives = (P.engines ?? [{ x: 0 }]).map((e, i) => sterndrive(K, M, root, e.x, i === 0 ? "enginePivot" : "enginePivot2", i === 0));
  // tampa invisível do cockpit (só profundidade): a água não aparece dentro do barco
  const lidMat = new StandardMaterial("rapLidMat", scene);
  lidMat.disableColorWrite = true; lidMat.forceDepthWrite = true; lidMat.alpha = 0.01; lidMat.backFaceCulling = false;
  const ckZ: number[] = [];
  for (let i = 0; i <= 12; i++) ckZ.push(H.z(0.27) + (H.z(0.47) - H.z(0.27)) * (i / 12));
  const cockpitLid = MeshBuilder.CreateRibbon("cockpitLid", { pathArray: ckZ.map((z) => { const sc = H.sec(H.tOf(z)); return [new Vector3(-(sc.hs - 0.18), keel + sc.s - 0.03, z), new Vector3(sc.hs - 0.18, keel + sc.s - 0.03, z)]; }) }, scene);
  cockpitLid.material = lidMat; cockpitLid.parent = root; cockpitLid.alphaIndex = 0;
  // esguicho: os V8 de centro descarregam pelo cubo da hélice (não há esguicho de refrigeração)
  const telltale = new TransformNode("telltale", scene); telltale.parent = drives[0].engine;
  const meshes = [...K.out, cockpitLid];
  for (const m of meshes) { m.isPickable = false; m.receiveShadows = true; }
  return {
    root, engine: drives[0].engine, propeller: drives[0].propeller, telltale, propBlur: drives[0].propBlur,
    lights: { port, star, stern }, cockpitLid, meshes,
    drives: drives.map((d) => ({ engine: d.engine, propeller: d.propeller, propBlur: d.propBlur })),
    floor: yD(P.seats.helm.z),
  };
};
