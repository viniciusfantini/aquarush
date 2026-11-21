// BOTE DE RESGATE AR-R (RIB de 6,5 m) — visual procedural. Casco rígido em V grafite com FLUTUADORES laranja (com o
// cabo de alça e a inscrição RESGATE), convés antiderrapante, console central com o banco de montar, DOIS motores de
// popa (pivôs `enginePivot`/`enginePivot2`: trim, tilt e direção da física) cada um com o PROTETOR DE HÉLICE (gaiola de
// inox em volta do pé) e o ARCO de inox sobre os motores com o GIROFLEX (barra vermelha/azul), farol de busca, radar e
// antena. `updateRescue` pisca o giroflex (e as luzes que ele projeta) pela telemetria. Só lê a simulação.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3, PointLight, DynamicTexture } from "@babylonjs/core";
import { RESCUE } from "../sim/params.ts";
import type { BoatTelemetry } from "../sim/boat.ts";
import { type BoatVisual, buildPropeller } from "./boatMesh.ts";
import { makeKit, makeMats, buildHull, type Kit, type Mats } from "./fleet.ts";

export type RescueVisual = BoatVisual & { floor: number; updateRescue: (T: BoatTelemetry, time: number) => void };

const pbr = (scene: Scene, name: string, c: Color3, metal: number, rough: number) => {
  const m = new PBRMaterial(name, scene); m.albedoColor = c; m.metallic = metal; m.roughness = rough; return m;
};

/** um motor de popa de 115 hp com o protetor de hélice (gaiola de inox) — tudo no pivô (gira com trim/tilt/direção) */
const outboard = (K: Kit, M: Mats, root: TransformNode, x: number, name: string, cowlMat: PBRMaterial) => {
  const P = RESCUE;
  const piv = K.node(name, root, P.drivePivot.x + x, P.drivePivot.y, P.drivePivot.z);
  const dz = P.propPos.z - P.drivePivot.z, dy = P.propPos.y - P.drivePivot.y;
  // suporte no espelho, capô, carenagem e o pé
  K.rbox(0.18, 0.22, 0.16, 0.03, 0, -0.02, -0.05, M.black, piv);
  K.rbox(0.46, 0.5, 0.62, 0.14, 0, 0.42, -0.34, cowlMat, piv);
  K.rbox(0.48, 0.06, 0.64, 0.03, 0, 0.18, -0.34, M.black, piv);
  K.rbox(0.34, 0.3, 0.42, 0.08, 0, 0.0, -0.36, M.black, piv);
  const legTop = new Vector3(0, -0.12, -0.4), legBot = new Vector3(0, dy + 0.14, dz + 0.26);
  const L = Vector3.Distance(legTop, legBot);
  const leg = K.cyl(L, 1, "y", 0, (legTop.y + legBot.y) / 2, (legTop.z + legBot.z) / 2, M.black, piv);
  leg.scaling.set(0.11, 1, 0.3); leg.rotation.x = Math.atan2(legTop.z - legBot.z, legTop.y - legBot.y);
  const plate = K.cyl(0.016, 1, "y", 0, dy + 0.24, dz + 0.16, M.black, piv); plate.scaling.set(0.34, 1, 0.52);
  const torp = K.add(MeshBuilder.CreateCapsule(name + "Torp", { radius: 0.075, height: 0.5, orientation: new Vector3(0, 0, 1) }, K.scene), M.black, piv);
  torp.position.set(0, dy, dz + 0.24);
  const skeg = K.box(0.02, 0.2, 0.18, 0, dy - 0.14, dz + 0.22, M.black, piv);
  const tmp: Mesh[] = [];
  const pr = buildPropeller(K.scene, piv, new Vector3(0, dy, dz), P.propRadius, 0.55, M.steel as PBRMaterial, (m, mat, p) => K.add(m, mat, p ?? piv), tmp);
  K.out.push(...tmp);
  // PROTETOR DE HÉLICE: gaiola de inox (anéis na frente e atrás da hélice + barras longitudinais + a grade traseira)
  const R = P.propRadius + 0.06, z0 = dz + 0.1, z1 = dz - 0.16;
  for (const z of [z0, z1]) {
    K.tube(Array.from({ length: 25 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return new Vector3(Math.cos(a) * R, dy + Math.sin(a) * R, z); }), 0.013, M.steel, piv, 6);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    K.tube([new Vector3(Math.cos(a) * R, dy + Math.sin(a) * R, z0), new Vector3(Math.cos(a) * R, dy + Math.sin(a) * R, z1)], 0.011, M.steel, piv, 5);
  }
  for (const a of [0, Math.PI / 2]) K.tube([new Vector3(Math.cos(a) * R, dy + Math.sin(a) * R, z1), new Vector3(-Math.cos(a) * R, dy - Math.sin(a) * R, z1)], 0.01, M.steel, piv, 5);
  // braço que prende a gaiola na placa anticavitação
  K.tube([new Vector3(0, dy + R, z0 + 0.02), new Vector3(0, dy + 0.24, dz + 0.16)], 0.014, M.steel, piv, 5);
  return { engine: piv, propeller: pr.propeller, propBlur: pr.propBlur, skeg };
};

export const buildRescue = (scene: Scene): RescueVisual => {
  const K = makeKit(scene);
  const M = makeMats(scene);
  const P = RESCUE;
  const root = new TransformNode("boat", scene);
  const L = P.length, keel = -0.46;
  const orange = pbr(scene, "rsOrange", new Color3(0.98, 0.33, 0.02), 0, 0.5);
  const grey = pbr(scene, "rsGrey", new Color3(0.2, 0.21, 0.22), 0.1, 0.45);
  const hullN = K.node("rsHull", root, 0, keel, 0);
  // casco rígido (a borda fica baixa: os flutuadores formam o costado)
  const H = buildHull(K, hullN, {
    L: L - 0.25, B: P.beam - 0.55, D: 0.62, dead: 0.42, deadBow: 1.0, bowRise: 0.3, sheerRise: 0.05, flare: 0.02, chine: 0.07, entry: 0.42, crown: 0.02, N: 70,
    bands: [{ top: () => 0.38, mat: grey }, { top: () => 9, mat: grey }],
    deck: M.nonskid, rub: M.black, rubR: 0.02,
    well: { depth: 0.36, t0: 0.08, t1: 0.86, floor: M.nonskid, gw: 0.04 },
  });
  const deckY = (z: number) => keel + H.deckY(H.tOf(z));
  const floor = deckY(P.seats.helm.z);
  // ---- FLUTUADORES: tubo contínuo em U (bombordo → proa → boreste), com as pontas de popa cônicas ----
  const TR = 0.27, tY = keel + 0.62, hw = P.beam / 2 - TR;
  const path: Vector3[] = [];
  const zs = -L / 2 + 0.05, zb = L / 2 - 1.0;
  for (let i = 0; i <= 12; i++) path.push(new Vector3(-hw, tY, zs + (zb - zs) * (i / 12)));
  for (let i = 1; i < 16; i++) { const a = Math.PI - (i / 16) * Math.PI; path.push(new Vector3(Math.cos(a) * hw, tY + 0.12 * Math.sin(a), zb + Math.sin(a) * 1.0)); }
  for (let i = 0; i <= 12; i++) path.push(new Vector3(hw, tY, zb - (zb - zs) * (i / 12)));
  const tube = MeshBuilder.CreateTube("rsTube", { path, radius: TR, tessellation: 24, cap: Mesh.NO_CAP }, scene);
  K.add(tube, orange, root);
  for (const s of [-1, 1]) {
    const cone = K.cyl(0.42, TR * 2, "z", s * hw, tY, zs - 0.2, orange, root, 0.08); cone.rotation.x = -Math.PI / 2;
    // cabo de alça ao longo do flutuador (pontos de fixação a cada ~0,6 m)
    const rope: Vector3[] = [];
    for (let i = 0; i <= 20; i++) { const z = zs + 0.3 + (zb - zs - 0.4) * (i / 20); rope.push(new Vector3(s * (hw + TR * 0.72), tY + TR * 0.55 - (i % 2 ? 0.07 : 0), z)); }
    K.tube(rope, 0.011, M.black, root, 5);
    K.tube(path.filter((p) => Math.sign(p.x) === s || Math.abs(p.x) < 0.01).map((p) => new Vector3(p.x + s * 0.02, p.y - TR * 0.86, p.z)), 0.03, M.black, root, 6); // defensa (friso) na base do tubo
  }
  // inscrição RESGATE nos dois flutuadores
  const tex = new DynamicTexture("rsText", { width: 512, height: 96 }, scene, false);
  { const c = tex.getContext() as unknown as CanvasRenderingContext2D; c.fillStyle = "rgba(0,0,0,0)"; c.clearRect(0, 0, 512, 96); c.fillStyle = "#ffffff"; c.font = "bold 72px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("RESGATE", 256, 52); tex.hasAlpha = true; tex.update(); }
  const txtMat = new StandardMaterial("rsTextMat", scene); txtMat.diffuseTexture = tex; txtMat.useAlphaFromDiffuseTexture = true; txtMat.emissiveColor = new Color3(0.4, 0.4, 0.4); txtMat.backFaceCulling = false;
  for (const s of [-1, 1]) {
    const pl = MeshBuilder.CreatePlane("rsTextPlane", { width: 1.9, height: 0.36 }, scene);
    pl.material = txtMat; pl.parent = root; pl.position.set(s * (hw + TR + 0.006), tY + 0.02, 0.4); pl.rotation.y = -s * Math.PI / 2; K.out.push(pl); // (o plano é lido pela frente: −π/2 em boreste, +π/2 em bombordo)
  }
  // ---- console central, para-brisa, banco de montar (jockey) e o arco de proa ----
  const hz = P.seats.helm.z;
  K.rbox(0.72, 0.95, 0.62, 0.08, 0, floor + 0.47, hz + 0.75, grey, root);
  const ws = K.rbox(0.74, 0.34, 0.03, 0.02, 0, floor + 1.12, hz + 0.98, M.glass, root); ws.rotation.x = -0.35;
  K.rbox(0.42, 0.24, 0.98, 0.1, 0, floor + 0.62, hz - 0.3, M.black, root);           // assento de montar (piloto + tripulante)
  K.rbox(0.32, 0.55, 0.85, 0.06, 0, floor + 0.27, hz - 0.3, grey, root);
  for (const s of [-1, 1]) K.tube([new Vector3(s * 0.28, floor + 0.75, hz - 0.65), new Vector3(s * 0.32, floor + 0.95, hz - 0.3), new Vector3(s * 0.3, floor + 0.9, hz + 0.1)], 0.016, M.steel, root, 6); // alças
  // ---- ARCO DE INOX sobre os motores: pés nos cantos do espelho, travessa no alto com o giroflex ----
  const zA = -2.95, topY = keel + 2.1, xs = 1.0;
  for (const s of [-1, 1]) {
    K.tube([new Vector3(s * xs, tY + 0.2, zA + 0.35), new Vector3(s * xs, topY - 0.25, zA), new Vector3(s * (xs - 0.2), topY, zA - 0.05)], 0.035, M.steel, root, 10);
    K.tube([new Vector3(s * xs, tY + 0.2, zA - 0.55), new Vector3(s * xs, topY - 0.6, zA - 0.2)], 0.025, M.steel, root, 8); // escora
  }
  K.tube([new Vector3(-(xs - 0.2), topY, zA - 0.05), new Vector3(xs - 0.2, topY, zA - 0.05)], 0.035, M.steel, root, 10);
  // giroflex: barra com módulos vermelhos (bombordo) e azuis (boreste) + um branco no meio
  const lbOff = (c: Color3) => { const m = new StandardMaterial("rsLb", scene); m.diffuseColor = c.scale(0.25); m.emissiveColor = Color3.Black(); m.specularColor = new Color3(0.6, 0.6, 0.6); return m; };
  const redM = lbOff(new Color3(1, 0.1, 0.05)), blueM = lbOff(new Color3(0.1, 0.3, 1)), whiteM = lbOff(new Color3(1, 1, 1));
  K.rbox(1.25, 0.08, 0.26, 0.03, 0, topY + 0.09, zA - 0.05, M.black, root);
  const mods: { m: Mesh; mat: StandardMaterial; side: number; i: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const x = -0.52 + i * 0.208, side = x < -0.05 ? -1 : x > 0.05 ? 1 : 0;
    const mat = side < 0 ? redM : side > 0 ? blueM : whiteM;
    const m = K.rbox(0.18, 0.1, 0.22, 0.03, x, topY + 0.18, zA - 0.05, mat, root);
    m.material = mat; mods.push({ m, mat, side, i });
  }
  // farol de busca, radar e antena
  K.cyl(0.14, 0.16, "z", 0.4, topY + 0.32, zA + 0.05, M.black, root);
  K.cyl(0.02, 0.13, "z", 0.4, topY + 0.32, zA + 0.13, M.lightWhite, root);
  K.cyl(0.18, 0.5, "y", -0.3, topY + 0.35, zA - 0.05, M.white, root);
  K.tube([new Vector3(0.6, topY + 0.15, zA - 0.1), new Vector3(0.6, topY + 1.5, zA - 0.18)], 0.012, M.white, root, 5);
  // luzes de navegação na proa e o branco de alcançado no arco
  const navMat = (n: string) => { const m = new StandardMaterial(n, scene); m.diffuseColor = new Color3(0.2, 0.2, 0.2); m.emissiveColor = Color3.Black(); return m; };
  const port = navMat("rsNavPort"), star = navMat("rsNavStar"), stern = navMat("rsNavStern");
  K.box(0.05, 0.05, 0.1, -0.14, floor + 1.0, hz + 1.06, port, root);
  K.box(0.05, 0.05, 0.1, 0.14, floor + 1.0, hz + 1.06, star, root);
  K.cyl(0.07, 0.06, "y", 0, topY + 0.26, zA + 0.15, stern, root);
  // ---- DOIS motores de popa com as gaiolas ----
  const ds = (P.engines ?? []).map((e, i) => outboard(K, M, root, e.x, i === 0 ? "enginePivot" : "enginePivot2", i === 0 ? M.white as PBRMaterial : M.white as PBRMaterial));
  ds[0].skeg.name = "skeg";
  // luzes projetadas pelo giroflex (iluminam a água e o casco à noite)
  const lr = new PointLight("rsBeaconR", new Vector3(-0.4, topY + 0.3, zA), scene); lr.parent = root; lr.diffuse = new Color3(1, 0.12, 0.05); lr.range = 28; lr.intensity = 0;
  const lb = new PointLight("rsBeaconB", new Vector3(0.4, topY + 0.3, zA), scene); lb.parent = root; lb.diffuse = new Color3(0.15, 0.35, 1); lb.range = 28; lb.intensity = 0;
  // tampa invisível do convés (só profundidade)
  const lidMat = new StandardMaterial("rsLidMat", scene);
  lidMat.disableColorWrite = true; lidMat.forceDepthWrite = true; lidMat.alpha = 0.01; lidMat.backFaceCulling = false;
  const ckZ: number[] = [];
  for (let i = 0; i <= 14; i++) ckZ.push(H.z(0.09) + (H.z(0.85) - H.z(0.09)) * (i / 14));
  const cockpitLid = MeshBuilder.CreateRibbon("cockpitLid", { pathArray: ckZ.map((z) => { const sc = H.sec(H.tOf(z)); return [new Vector3(-(sc.hs - 0.05), keel + sc.s - 0.03, z), new Vector3(sc.hs - 0.05, keel + sc.s - 0.03, z)]; }) }, scene);
  cockpitLid.material = lidMat; cockpitLid.parent = root; cockpitLid.alphaIndex = 0;
  const telltale = new TransformNode("telltale", scene); telltale.parent = ds[0].engine;
  const meshes = [...K.out, cockpitLid];
  for (const m of meshes) { m.isPickable = false; m.receiveShadows = true; }
  return {
    root, engine: ds[0].engine, propeller: ds[0].propeller, telltale, propBlur: ds[0].propBlur, lights: { port, star, stern }, cockpitLid, meshes, floor,
    drives: ds.map((d) => ({ engine: d.engine, propeller: d.propeller, propBlur: d.propBlur })),
    updateRescue: (T, time) => {
      // padrão de giroflex: rajadas duplas alternando vermelho / azul (4 Hz) e o branco piscando no meio
      const on = !!T.rescue?.beacon;
      const ph = (time * 2) % 1, redOn = on && (ph < 0.12 || (ph > 0.2 && ph < 0.32)), blueOn = on && ((ph > 0.5 && ph < 0.62) || (ph > 0.7 && ph < 0.82));
      const whiteOn = on && Math.floor(time * 6) % 3 === 0;
      redM.emissiveColor.set(redOn ? 1 : 0, redOn ? 0.08 : 0, redOn ? 0.04 : 0);
      blueM.emissiveColor.set(blueOn ? 0.1 : 0, blueOn ? 0.3 : 0, blueOn ? 1 : 0);
      whiteM.emissiveColor.set(whiteOn ? 0.9 : 0, whiteOn ? 0.9 : 0, whiteOn ? 0.9 : 0);
      lr.intensity = redOn ? 2.2 : 0; lb.intensity = blueOn ? 2.2 : 0;
      void mods;
    },
  };
};
