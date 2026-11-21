// Barco elétrico com foils AR-E (9,5 m, piloto + 12 passageiros) — visual procedural. Casco de compósito branco com
// faixa azul-petróleo, cabine com teto rígido e vidros laterais (popa aberta para o embarque), 13 bancos, DOIS foils
// dianteiros com struts e flaps e o POD elétrico no strut de trás (com o foil de popa e duas hélices
// contrarrotativas). Struts, foils e pod SOBEM ao recolher (`updateFoil` lê a telemetria: posição, flaps, giro).
// Nó do pivô = direção do pod (mesmo ângulo da física). Só lê a simulação.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3 } from "@babylonjs/core";
import { FOILER } from "../sim/params.ts";
import type { BoatTelemetry } from "../sim/boat.ts";
import { type BoatVisual, buildPropeller } from "./boatMesh.ts";
import { makeKit, makeMats, buildHull, loftRR, loftFn } from "./fleet.ts";

export type FoilVisual = BoatVisual & { floor: number; updateFoil: (T: BoatTelemetry) => void; snapFoils: (deploy: number) => void };

export const buildFoiler = (scene: Scene): FoilVisual => {
  const K = makeKit(scene);
  const M = makeMats(scene);
  const P = FOILER, H = P.hydrofoil!;
  const root = new TransformNode("boat", scene);
  const L = P.length, keel = -0.55;
  const hullN = K.node("foilHull", root, 0, keel, 0);
  const tOf = (z: number) => (z + L / 2) / L;
  const teal = new PBRMaterial("foilTeal", scene);
  teal.albedoColor = new Color3(0.0, 0.32, 0.36); teal.metallic = 0.2; teal.roughness = 0.3;
  // casco: fundo grafite (antiincrustante), costado branco com faixa azul-petróleo; convés aberto (cabine)
  const Hh = buildHull(K, hullN, {
    L, B: P.beam, D: 1.1, dead: 0.3, deadBow: 0.95, bowRise: 0.35, sheerRise: 0.08, flare: 0.05, chine: 0.07, entry: 0.42, crown: 0.12, N: 90,
    bands: [
      { top: () => 0.4, mat: M.matte },
      { top: (t) => 0.62 + 0.15 * t, mat: M.white },
      { top: (t) => 0.7 + 0.15 * t, mat: teal },
      { top: () => 9, mat: M.white },
    ],
    deck: M.white, rub: M.gunmetal, rubR: 0.03,
    well: { depth: 0.62, t0: tOf(-3.3), t1: tOf(3.1), floor: M.nonskid, gw: 0.16 },
  });
  const yD = (z: number) => keel + Hh.deckY(Hh.tOf(z));
  const deckTop = (z: number) => keel + Hh.sec(Hh.tOf(z)).s;
  const floor = yD(0);

  // ---- cabine: teto rígido em colunas, para-brisa e vidros laterais (popa aberta) ----
  const glassMat = new StandardMaterial("foilGlass", scene);
  glassMat.diffuseColor = new Color3(0.05, 0.1, 0.13); glassMat.specularColor = new Color3(0.9, 0.95, 1); glassMat.specularPower = 160;
  glassMat.alpha = 0.28; glassMat.backFaceCulling = false;
  const roofY = floor + 2.05, zF = 2.85, zR = -3.15, hw = 1.22;
  loftRR(K, loftFn(12, (t) => ({ z: zR + (zF - zR) * t, w: 2.62 - 0.25 * Math.pow(t, 3), h: 0.09, y: roofY + 0.04 * Math.sin(Math.PI * t), r: 0.04 })), M.white, root);
  loftRR(K, loftFn(4, (t) => ({ z: zR + 0.05 + 0.3 * t, w: 2.5, h: 0.05, y: roofY - 0.07, r: 0.02 })), teal, root);
  const pillars = [zF - 0.05, 1.3, -0.4, -2.0, zR + 0.1];
  for (const s of [-1, 1]) for (const z of pillars) {
    const y0 = deckTop(z) - 0.02;
    K.tube([new Vector3(s * hw, y0, z), new Vector3(s * (hw - 0.04), roofY - 0.02, z - (z === pillars[0] ? 0.25 : 0))], 0.035, M.gunmetal, root, 8);
  }
  const glassPane = (pts: Vector3[][]) => { const g = MeshBuilder.CreateRibbon("foilGlassPane", { pathArray: pts, sideOrientation: Mesh.DOUBLESIDE }, scene); g.material = glassMat; g.parent = root; g.alphaIndex = 20; K.out.push(g); return g; };
  // para-brisa (inclinado, envolvente)
  const ws: Vector3[][] = [0, 1].map((k) => Array.from({ length: 13 }, (_, j) => { const a = -1 + (2 * j) / 12; const x = a * (hw - 0.03); return new Vector3(x, k ? roofY - 0.04 : deckTop(zF) + 0.05, (k ? zF - 0.3 : zF) - 0.08 * a * a); }));
  glassPane(ws);
  // vidros laterais (da borda até o teto, entre a primeira e a penúltima coluna)
  for (const s of [-1, 1]) {
    const z0 = pillars[0] - 0.1, z1 = pillars[3];
    glassPane([0, 1].map((k) => Array.from({ length: 10 }, (_, j) => { const z = z0 + (z1 - z0) * (j / 9); return new Vector3(s * (hw - 0.01), k ? roofY - 0.06 : deckTop(z) + 0.28, z); })));
  }
  // corrimão no teto e luz de alcançado
  K.tube([new Vector3(-0.9, roofY + 0.1, zR + 0.4), new Vector3(-0.9, roofY + 0.14, 1.8), new Vector3(0.9, roofY + 0.14, 1.8), new Vector3(0.9, roofY + 0.1, zR + 0.4)], 0.02, M.steel, root, 6);

  // ---- bancos: piloto (central, à frente) e 12 passageiros (3 fileiras de 2 + corredor + 2) ----
  const seat = (x: number, z: number, w = 0.46, mat = M.cushion) => {
    const fy = yD(z);
    K.rbox(w, 0.12, 0.46, 0.06, x, fy + 0.3, z - 0.05, mat, root);
    const back = K.rbox(w, 0.58, 0.12, 0.06, x, fy + 0.62, z - 0.3, mat, root); back.rotation.x = -0.14;
    K.rbox(w * 0.8, 0.24, 0.38, 0.04, x, fy + 0.12, z - 0.05, M.gunmetal, root);
  };
  seat(P.seats.helm.x, P.seats.helm.z, 0.52, M.navy);
  for (const [k, p] of Object.entries(P.seats)) if (/^p\d+$/.test(k)) seat(p.x, p.z, 0.46, teal);
  // tomada do carregador (costado de bombordo, à ré) e a bateria sob o piso (tampa de inspeção)
  { const sc = Hh.sec(tOf(-2.6)); K.rbox(0.02, 0.16, 0.22, 0.01, -(sc.hs + 0.005), keel + sc.s - 0.14, -2.6, M.steelBlue, root); }
  K.rbox(1.1, 0.012, 1.4, 0.01, 0, yD(-2.2) + 0.006, -2.2, M.matte, root);

  // ---- luzes de navegação ----
  const navMat = (n: string) => { const m = new StandardMaterial(n, scene); m.diffuseColor = new Color3(0.2, 0.2, 0.2); m.emissiveColor = Color3.Black(); return m; };
  const port = navMat("foilNavPort"), star = navMat("foilNavStar"), stern = navMat("foilNavStern");
  for (const [s, m] of [[-1, port], [1, star]] as [number, StandardMaterial][]) K.box(0.04, 0.05, 0.12, s * (hw + 0.02), roofY - 0.02, zF - 0.4, m, root);
  K.cyl(0.07, 0.06, "y", 0, roofY + 0.12, zR + 0.25, stern, root);

  // ---- foils dianteiros (struts + asa + flap), num nó que sobe ao recolher ----
  const front = H.foils.filter((f) => f.role === "front");
  const frontNodes: TransformNode[] = [], flapNodes: TransformNode[] = [];
  for (const f of front) {
    const n = K.node(f.name, root, 0, 0, 0);
    const sLen = f.strutTopY - f.pos.y + 0.35; // (+ o trecho que fica dentro do poço do casco)
    K.rbox(0.045, sLen, f.strutChord, 0.02, f.pos.x, f.pos.y + sLen / 2, f.pos.z - f.chord * 0.25 + f.strutChord * 0.35, M.gunmetal, n);
    K.cyl(f.chord * 0.95, 0.09, "z", f.pos.x, f.pos.y, f.pos.z - f.chord * 0.2, M.gunmetal, n, 0.06); // bulbo da junção
    // asa: perfil fino, pontas arredondadas, com leve diedro
    const span = f.span, c = f.chord;
    for (const sd of [-1, 1]) {
      const half = K.ribbon([0, 1, 2].map((k) => Array.from({ length: 9 }, (_, j) => {
        const u = j / 8, x = f.pos.x + sd * u * span / 2, cl = c * (1 - 0.45 * u * u);
        const y = f.pos.y + 0.04 * u * u + (k === 1 ? 0.022 * (1 - 0.5 * u) : 0);
        const z = f.pos.z + c * 0.25 - (k === 0 ? 0 : k === 1 ? cl * 0.35 : cl * 0.78);
        return new Vector3(x, k === 2 ? y - 0.004 : y, z);
      })), M.gunmetal, n);
      half.name = "foilWing";
      const under = K.ribbon([0, 1].map((k) => Array.from({ length: 9 }, (_, j) => {
        const u = j / 8, x = f.pos.x + sd * u * span / 2, cl = c * (1 - 0.45 * u * u);
        return new Vector3(x, f.pos.y + 0.04 * u * u - 0.008, f.pos.z + c * 0.25 - (k === 0 ? 0 : cl * 0.78));
      })), M.black, n);
      under.name = "foilWingUnder";
    }
    // flap: articulado no bordo de fuga (gira em X)
    const fl = K.node(f.name + "Flap", n, f.pos.x, f.pos.y + 0.006, f.pos.z - c * 0.53);
    K.box(span * 0.62, 0.012, c * 0.24, 0, 0, -c * 0.12, M.yellow, fl);
    frontNodes.push(n); flapNodes.push(fl);
  }

  // ---- pod de trás: pivô de direção (yaw) → nó que sobe ao recolher → strut, foil de popa, motor e hélices ----
  const piv = K.node("enginePivot", root, P.drivePivot.x, P.drivePivot.y, P.drivePivot.z);
  const pod = K.node("podLift", piv, 0, 0, 0);
  const rf = H.foils.find((f) => f.role === "rear")!;
  const ax = P.propPos.y - P.drivePivot.y, pz = P.propPos.z - P.drivePivot.z;
  const sTop = rf.strutTopY - P.drivePivot.y + 0.35, sBot = ax;
  K.rbox(0.05, sTop - sBot, rf.strutChord, 0.02, 0, (sTop + sBot) / 2, pz + 0.12, M.gunmetal, pod);
  // corpo do motor (charuto) com o nariz e a cauda cônicos
  K.cyl(0.62, 0.21, "z", 0, ax, pz + 0.18, M.gunmetal, pod);
  const nose = K.cyl(0.22, 0.21, "z", 0, ax, pz + 0.6, M.gunmetal, pod, 0.03); nose.rotation.x = Math.PI / 2;
  K.cyl(0.14, 0.13, "z", 0, ax, pz - 0.2, M.steel, pod, 0.1);
  // foil de popa sob o motor, com o flap (profundor)
  const rfy = rf.pos.y - P.drivePivot.y, rfz = rf.pos.z - P.drivePivot.z;
  K.ribbon([0, 1, 2].map((k) => Array.from({ length: 11 }, (_, j) => {
    const u = -1 + (2 * j) / 10, x = u * rf.span / 2, cl = rf.chord * (1 - 0.4 * u * u);
    return new Vector3(x, rfy + 0.03 * u * u + (k === 1 ? 0.02 : 0), rfz + rf.chord * 0.25 - (k === 0 ? 0 : k === 1 ? cl * 0.35 : cl * 0.78));
  })), M.gunmetal, pod);
  const rearFlap = K.node("rearFlap", pod, 0, rfy + 0.006, rfz - rf.chord * 0.53);
  K.box(rf.span * 0.6, 0.012, rf.chord * 0.24, 0, 0, -rf.chord * 0.12, M.yellow, rearFlap);
  // duas hélices contrarrotativas na cauda
  const tmp: Mesh[] = [];
  const { propeller, propBlur } = buildPropeller(scene, pod, new Vector3(0, ax, pz - 0.3), P.propRadius, 0.45, M.steel as PBRMaterial, (m, mat, p) => K.add(m, mat, p ?? pod), tmp);
  const p2 = buildPropeller(scene, pod, new Vector3(0, ax, pz - 0.44), P.propRadius * 0.94, 0.45, M.steel as PBRMaterial, (m, mat, p) => K.add(m, mat, p ?? pod), tmp);
  p2.propeller.scaling.x = -1; // passo espelhado (gira ao contrário)
  K.out.push(...tmp);
  const skeg = K.box(0.01, 0.01, 0.01, 0, ax, pz, M.gunmetal, pod); skeg.name = "skeg"; skeg.isVisible = false;

  // tampa invisível do piso da cabine (só profundidade): a água não aparece dentro do barco
  const lidMat = new StandardMaterial("foilLidMat", scene);
  lidMat.disableColorWrite = true; lidMat.forceDepthWrite = true; lidMat.alpha = 0.01; lidMat.backFaceCulling = false;
  const ckZ: number[] = [];
  for (let i = 0; i <= 16; i++) ckZ.push(-3.3 + 6.4 * (i / 16));
  const cockpitLid = MeshBuilder.CreateRibbon("cockpitLid", { pathArray: ckZ.map((z) => { const sc = Hh.sec(Hh.tOf(z)); return [new Vector3(-(sc.hs - 0.16), keel + sc.s - 0.03, z), new Vector3(sc.hs - 0.16, keel + sc.s - 0.03, z)]; }) }, scene);
  cockpitLid.material = lidMat; cockpitLid.parent = root; cockpitLid.alphaIndex = 0;
  const telltale = new TransformNode("telltale", scene); telltale.parent = pod;
  const meshes = [...K.out, cockpitLid];
  for (const m of meshes) { m.isPickable = false; m.receiveShadows = true; }

  let shown = -1;
  const place = (dep: number) => {
    const drop = (1 - dep) * H.rise;
    for (const n of frontNodes) n.position.y = drop;
    pod.position.y = (1 - dep) * H.podRise;
    shown = dep;
  };
  place(0);
  return {
    root, engine: piv, propeller, telltale, propBlur, lights: { port, star, stern }, cockpitLid, meshes, floor,
    snapFoils: (dep) => place(dep),
    updateFoil: (T) => {
      const F = T.foil;
      if (!F) return;
      if (Math.abs(F.deploy - shown) > 1e-4) place(F.deploy);
      flapNodes.forEach((fl, i) => { fl.rotation.x = (front[i].side < 0 ? F.flapL : F.flapR); });
      rearFlap.rotation.x = F.flapRear;
      p2.propeller.rotation.z = -propeller.rotation.z;
      p2.propBlur.alpha = propBlur.alpha;
    },
  };
};
