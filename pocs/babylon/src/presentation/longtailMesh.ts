// LONG-TAIL tailandês de corrida AR-T — visual procedural. Casco de madeira longo e estreito, pintado, com a proa
// alta enfeitada com guirlandas; bancos de tábua para a tripulação; na popa o TURBO DIESEL de 6 cilindros EXPOSTO
// num pivô: bloco, cabeçote com a tampa de válvulas vermelha, cárter, coletor de escape e o TURBO com a chaminé reta
// para cima, intercooler na frente com os tubos de alumínio, POLIAS e CORREIA na frente do motor (virabrequim, bomba
// d'água, alternador, esticador), motor de arranque, e o EIXO longo até a hélice de 2 pás, com a mangueira da água de
// resfriamento ao longo dele. A cana sai da frente do motor até a mão do piloto.
// O nó do pivô (`engine`) recebe a direção (por fora) e a subida do eixo (por dentro) — o main monta essa ordem.
// `updateEngine` lê a telemetria: polias girando, vibração do motor e a fumaça (preta com o turbo atrasado, branca a
// frio). Só lê a simulação.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, Color4, TransformNode, Vector3, ParticleSystem, DynamicTexture } from "@babylonjs/core";
import { LONGTAIL } from "../sim/params.ts";
import type { BoatTelemetry } from "../sim/boat.ts";
import type { VehicleInput } from "../gameplay/vehicleInput.ts";
import { type BoatVisual, buildPropeller } from "./boatMesh.ts";
import type { DinghyControls } from "./dinghyMesh.ts";
import { makeKit, makeMats, buildHull, loftRR, loftFn } from "./fleet.ts";

export type LongtailVisual = BoatVisual & { floor: number; controls: DinghyControls; updateEngine: (T: BoatTelemetry, dt: number) => void };

const pbr = (scene: Scene, name: string, c: Color3, metal: number, rough: number) => {
  const m = new PBRMaterial(name, scene); m.albedoColor = c; m.metallic = metal; m.roughness = rough; return m;
};

export const buildLongtail = (scene: Scene): LongtailVisual => {
  const K = makeKit(scene);
  const M = makeMats(scene);
  const P = LONGTAIL;
  const root = new TransformNode("boat", scene);
  const L = P.length, keel = -0.36;
  const hullN = K.node("ltHull", root, 0, keel, 0);
  const tOf = (z: number) => (z + L / 2) / L;
  const red = pbr(scene, "ltRed", new Color3(0.62, 0.05, 0.04), 0.05, 0.35);
  const blue = pbr(scene, "ltBlue", new Color3(0.02, 0.12, 0.42), 0.05, 0.35);
  const gold = pbr(scene, "ltGold", new Color3(0.95, 0.68, 0.12), 0.6, 0.3);
  const woodIn = pbr(scene, "ltWoodIn", new Color3(0.45, 0.28, 0.14), 0, 0.75);
  // casco: fundo azul, faixa vermelha e filete dourado, borda de madeira; quase todo aberto por dentro
  const Hh = buildHull(K, hullN, {
    L, B: P.beam, D: 0.72, dead: 0.5, deadBow: 1.15, bowRise: 0.62, sheerRise: 0.18, flare: 0.08, chine: 0.04, entry: 0.5, crown: 0.06, N: 100,
    bands: [
      { top: () => 0.33, mat: blue },
      { top: (t) => 0.5 + 0.1 * t, mat: red },
      { top: (t) => 0.54 + 0.1 * t, mat: gold },
      { top: () => 9, mat: blue },
    ],
    deck: M.wood, rub: M.wood, rubR: 0.03,
    well: { depth: 0.48, t0: 0.05, t1: 0.9, floor: woodIn, gw: 0.07 },
  });
  const yD = (z: number) => keel + Hh.deckY(Hh.tOf(z));
  const deckTop = (z: number) => keel + Hh.sec(Hh.tOf(z)).s;
  const floor = yD(P.seats.helm.z);

  // ---- proa: bico alto enfeitado (guirlandas de flores e fitas coloridas) ----
  const bowZ = L / 2 - 0.05, bowY = deckTop(bowZ);
  K.cyl(0.5, 0.05, "y", 0, bowY + 0.2, bowZ - 0.05, gold, root, 0.02);
  const flowers = [new Color3(1, 0.85, 0.1), new Color3(1, 0.35, 0.05), new Color3(0.95, 0.1, 0.4), new Color3(1, 1, 1)];
  for (let i = 0; i < 4; i++) {
    const m = pbr(scene, "ltFlower" + i, flowers[i], 0, 0.6);
    K.tube(Array.from({ length: 13 }, (_, j) => { const a = (j / 12) * Math.PI * 2; return new Vector3(Math.cos(a) * 0.07, bowY + 0.08 + i * 0.09 + Math.sin(a) * 0.02, bowZ - 0.08 + Math.sin(a) * 0.07); }), 0.022, m, root, 6);
    // fitas caindo pelos lados
    for (const s of [-1, 1]) K.tube([new Vector3(s * 0.06, bowY + 0.1 + i * 0.09, bowZ - 0.1), new Vector3(s * (0.18 + i * 0.03), bowY - 0.05, bowZ - 0.25 - i * 0.12)], 0.008, m, root, 4);
  }
  // ---- bancos de tábua (tripulação) e o banquinho do piloto ----
  for (const k of ["p1", "p2", "p3"] as const) {
    const z = P.seats[k].z, sc = Hh.sec(tOf(z)), w = 2 * (sc.hs - 0.06);
    K.box(w, 0.04, 0.26, 0, yD(z) + 0.28, z - 0.05, M.wood, root);
  }
  K.rbox(0.42, 0.06, 0.34, 0.02, 0, floor + 0.3, P.seats.helm.z - 0.05, M.wood, root);
  K.box(0.06, 0.28, 0.06, 0, floor + 0.14, P.seats.helm.z - 0.05, M.wood, root);
  // tanque de diesel (galão azul) e a bateria
  K.rbox(0.34, 0.34, 0.5, 0.06, 0.25, yD(-3.6) + 0.17, -3.6, blue, root);
  K.rbox(0.3, 0.22, 0.18, 0.02, -0.25, yD(-3.6) + 0.11, -3.6, M.black, root);

  // ---- poste de reboque no bico da popa (a corda passa por cima do eixo) ----
  { const tw = P.tow!; K.tube([new Vector3(0, deckTop(tw.eyeZ + 0.05) - 0.05, tw.eyeZ + 0.05), new Vector3(0, tw.eyeY - 0.06, tw.eyeZ)], 0.035, M.steelDark, root, 8); }
  // ---- PIVÔ do motor: coluna de aço na popa ----
  const pv = P.drivePivot;
  K.cyl(pv.y - deckTop(pv.z) + 0.02, 0.14, "y", 0, (pv.y + deckTop(pv.z)) / 2, pv.z, M.steelDark, root);
  K.rbox(0.5, 0.05, 0.4, 0.02, 0, deckTop(pv.z) + 0.02, pv.z, M.steelDark, root);
  const piv = K.node("enginePivot", root, pv.x, pv.y, pv.z);
  K.cyl(0.18, 0.16, "y", 0, 0, 0, M.steelDark, piv);                                       // cabeça do pivô (gira)
  for (const s of [-1, 1]) K.rbox(0.04, 0.2, 0.16, 0.01, s * 0.12, -0.02, 0, M.steelDark, piv); // garfo do eixo de subida
  // eixo do motor alinhado com o eixo da rabeta (15° para baixo atrás): no nó `ax`, −Z vai para a hélice
  const dy = P.propPos.y - pv.y, dz = P.propPos.z - pv.z, shaftLen = Math.hypot(dy, dz);
  const ax = K.node("ltAxis", piv, 0, 0, 0);
  ax.rotation.x = -Math.atan2(-dy, -dz);
  const eng = K.node("ltEngine", ax, 0, 0.0, 0); // (vibra)
  const block = pbr(scene, "ltBlock", new Color3(0.18, 0.22, 0.2), 0.35, 0.55);
  const head = pbr(scene, "ltHead", new Color3(0.55, 0.56, 0.58), 0.7, 0.35);
  const valve = pbr(scene, "ltValve", new Color3(0.8, 0.06, 0.04), 0.3, 0.25);
  const castIron = pbr(scene, "ltCast", new Color3(0.16, 0.14, 0.13), 0.6, 0.6);
  const alu = M.alu, rubber = M.black;
  // carcaça da embreagem/volante (cone) logo à frente do pivô e o bloco de 6 cilindros
  K.cyl(0.22, 0.5, "z", 0, 0.08, 0.1, block, eng, 0.36);
  K.rbox(0.44, 0.5, 1.12, 0.05, 0, 0.22, 0.78, block, eng);
  K.rbox(0.48, 0.17, 1.14, 0.04, 0, 0.55, 0.78, head, eng);
  loftRR(K, loftFn(6, (t) => ({ z: 0.24 + 1.08 * t, w: 0.36, h: 0.07 + 0.02 * Math.sin(Math.PI * t), y: 0.66, r: 0.03 })), valve, eng);
  K.rbox(0.38, 0.22, 0.95, 0.04, 0, -0.12, 0.8, block, eng);                         // cárter
  for (let i = 0; i < 6; i++) K.cyl(0.05, 0.035, "y", 0, 0.71, 0.3 + i * 0.19, M.steel, eng); // porcas da tampa
  // bomba injetora (lado esquerdo) com os 6 tubos dos bicos
  K.rbox(0.12, 0.18, 0.5, 0.02, -0.29, 0.25, 0.8, M.steel, eng);
  for (let i = 0; i < 6; i++) K.tube([new Vector3(-0.29, 0.35, 0.6 + i * 0.08), new Vector3(-0.27, 0.5, 0.3 + i * 0.19), new Vector3(-0.17, 0.6, 0.3 + i * 0.19)], 0.006, M.steel, eng, 4);
  // coletor de escape (lado direito) até o TURBO na traseira direita
  for (let i = 0; i < 6; i++) K.tube([new Vector3(0.22, 0.42, 0.3 + i * 0.19), new Vector3(0.31, 0.42, 0.3 + i * 0.19), new Vector3(0.33, 0.42, 0.55)], 0.03, castIron, eng, 6);
  K.cyl(1.0, 0.09, "z", 0.33, 0.42, 0.75, castIron, eng);
  // turbo: carcaça quente (caracol de ferro) + carcaça fria (alumínio), eixo transversal
  const turbo = K.node("ltTurbo", eng, 0.42, 0.5, 0.12);
  const hot = MeshBuilder.CreateTorus("ltTurboHot", { diameter: 0.2, thickness: 0.09, tessellation: 20 }, scene); K.add(hot, castIron, turbo); hot.rotation.z = Math.PI / 2; hot.position.x = -0.04;
  const cold = MeshBuilder.CreateTorus("ltTurboCold", { diameter: 0.22, thickness: 0.1, tessellation: 20 }, scene); K.add(cold, alu, turbo); cold.rotation.z = Math.PI / 2; cold.position.x = 0.1;
  K.cyl(0.2, 0.1, "x", 0.03, 0, 0, M.steel, turbo);
  // CHAMINÉ: reta para cima (levemente para trás), boca aberta — o escape sem abafador
  const stackTop = new Vector3(0.38, 1.55, -0.08);
  K.tube([new Vector3(0.38, 0.55, 0.12), new Vector3(0.38, 0.8, 0.08), stackTop], 0.055, M.steel, eng, 14);
  const lip = MeshBuilder.CreateTorus("ltStackLip", { diameter: 0.12, thickness: 0.018, tessellation: 18 }, scene); K.add(lip, M.steel, eng); lip.position.copyFrom(stackTop);
  const exhaustNode = K.node("exhaust", eng, stackTop.x, stackTop.y, stackTop.z);
  // INTERCOOLER na frente (colmeia de alumínio) e os tubos do compressor até ele e dele até a admissão
  K.rbox(0.5, 0.32, 0.09, 0.02, 0, 0.62, 1.52, alu, eng);
  K.box(0.44, 0.26, 0.095, 0, 0.62, 1.52, M.black, eng);
  K.tube([new Vector3(0.52, 0.5, 0.12), new Vector3(0.52, 0.7, 0.5), new Vector3(0.36, 0.72, 1.48)], 0.045, alu, eng, 10);
  K.tube([new Vector3(-0.3, 0.62, 1.48), new Vector3(-0.34, 0.5, 1.1), new Vector3(-0.26, 0.45, 0.8)], 0.045, alu, eng, 10);
  K.rbox(0.08, 0.1, 0.95, 0.02, -0.24, 0.45, 0.75, alu, eng);                          // coletor de admissão
  // POLIAS na frente do motor (eixo z) e a correia
  const pulleys: { n: TransformNode; ratio: number }[] = [];
  const pulley = (x: number, y: number, d: number, ratio: number, mat = M.steel) => {
    const n = K.node("ltPulley", eng, x, y, 1.36);
    K.cyl(0.05, d, "z", 0, 0, 0, mat, n);
    K.cyl(0.055, d * 0.55, "z", 0, 0, 0.005, castIron, n);
    for (let i = 0; i < 4; i++) { const sp = K.box(d * 0.9, 0.012, 0.01, 0, 0, 0.028, castIron, n); sp.rotation.z = (i * Math.PI) / 4; }
    pulleys.push({ n, ratio });
    return { x, y, r: d / 2 };
  };
  const crank = pulley(0, 0.02, 0.24, 1);
  const wp = pulley(0, 0.33, 0.15, 1.6);
  const alt = pulley(-0.22, 0.27, 0.09, 2.7);
  const idl = pulley(0.19, 0.18, 0.07, 3.4, M.steelDark);
  // correia: contorno passando por fora das polias (bem aproximado por pontos na circunferência)
  const around = (p: { x: number; y: number; r: number }, a0: number, a1: number, n = 6) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / n); return new Vector3(p.x + Math.cos(a) * (p.r + 0.006), p.y + Math.sin(a) * (p.r + 0.006), 1.36); });
  const belt = [...around(crank, Math.PI * 0.15, Math.PI * 1.15), ...around(alt, Math.PI * 1.05, Math.PI * 0.45), ...around(wp, Math.PI * 0.75, Math.PI * 0.05), ...around(idl, Math.PI * 0.55, -Math.PI * 0.3)];
  belt.push(belt[0].clone());
  K.tube(belt, 0.009, rubber, eng, 5);
  // alternador (corpo atrás da polia) e o motor de arranque embaixo à esquerda
  K.cyl(0.16, 0.15, "z", -0.22, 0.27, 1.24, alu, eng);
  K.cyl(0.26, 0.1, "z", -0.24, -0.05, 0.2, M.black, eng);
  // EIXO da rabeta até a hélice, mancal e a mangueira da água de resfriamento
  K.cyl(shaftLen - 0.1, 0.075, "z", 0, 0, -(shaftLen - 0.1) / 2, M.steel, ax);
  K.cyl(0.5, 0.1, "z", 0, 0, -0.3, M.steelDark, ax);
  K.cyl(0.3, 0.11, "z", 0, 0, -shaftLen + 0.28, M.steelDark, ax);
  const hose = pbr(scene, "ltHose", new Color3(0.05, 0.25, 0.75), 0, 0.6);
  K.tube([new Vector3(0, -0.06, -shaftLen + 0.35), new Vector3(0, -0.06, -1.0), new Vector3(0.12, 0.05, -0.1), new Vector3(0.25, 0.2, 0.4)], 0.016, hose, ax, 6);
  const skeg = K.box(0.012, 0.18, 0.28, 0, -0.14, -shaftLen + 0.25, M.steelDark, ax); skeg.name = "skeg";
  const tmp: Mesh[] = [];
  const { propeller, propBlur } = buildPropeller(scene, ax, new Vector3(0, 0, -shaftLen), P.propRadius, 0.55, M.steel as PBRMaterial, (m, mat, p) => K.add(m, mat, p ?? ax), tmp);
  // hélice de 2 pás: some a 3ª pá da hélice padrão
  { const blades = propeller.getChildMeshes(false).filter((m) => m.name === "blade"); if (blades[2]) blades[2].setEnabled(false); }
  K.out.push(...tmp);
  // CANA: tubo da frente do motor até a mão do piloto, com a manopla do acelerador
  // (no frame do eixo: até ~0,5 m à frente do banco do piloto; o eixo sobe 15° para a proa, então a ponta fica mais alta)
  const tZ = P.seats.helm.z - pv.z + 0.5, tY = 0.0;
  K.tube([new Vector3(-0.12, 0.5, 1.2), new Vector3(-0.16, 0.42, 1.7), new Vector3(-0.18, tY, tZ)], 0.022, M.steel, ax, 8);
  K.cyl(0.16, 0.045, "z", -0.18, tY, tZ + 0.05, rubber, ax);
  const gripNode = K.node("ltGrip", ax, -0.18, tY, tZ);

  // fumaça do escape
  const dot = new DynamicTexture("ltSmokeTex", { width: 64, height: 64 }, scene, false);
  { const c = dot.getContext() as unknown as CanvasRenderingContext2D; const g = c.createRadialGradient(32, 32, 2, 32, 32, 31); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); dot.hasAlpha = true; dot.update(); }
  const smoke = new ParticleSystem("ltSmoke", 600, scene);
  smoke.particleTexture = dot; smoke.emitter = Vector3.Zero(); smoke.minEmitBox = new Vector3(-0.02, 0, -0.02); smoke.maxEmitBox = new Vector3(0.02, 0, 0.02);
  smoke.minSize = 0.12; smoke.maxSize = 0.4; smoke.minLifeTime = 0.8; smoke.maxLifeTime = 2.2; smoke.minEmitPower = 2; smoke.maxEmitPower = 4;
  smoke.gravity = new Vector3(0, 0.6, 0); smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  smoke.addSizeGradient(0, 0.15); smoke.addSizeGradient(1, 1.4);
  smoke.emitRate = 0; smoke.start();

  const telltale = new TransformNode("telltale", scene); telltale.parent = ax;
  // tampa invisível do interior (só profundidade)
  const lidMat = new StandardMaterial("ltLidMat", scene);
  lidMat.disableColorWrite = true; lidMat.forceDepthWrite = true; lidMat.alpha = 0.01; lidMat.backFaceCulling = false;
  const ckZ: number[] = [];
  for (let i = 0; i <= 20; i++) ckZ.push(Hh.z(0.06) + (Hh.z(0.89) - Hh.z(0.06)) * (i / 20));
  const cockpitLid = MeshBuilder.CreateRibbon("cockpitLid", { pathArray: ckZ.map((z) => { const sc = Hh.sec(Hh.tOf(z)); return [new Vector3(-(sc.hs - 0.07), keel + sc.s - 0.03, z), new Vector3(sc.hs - 0.07, keel + sc.s - 0.03, z)]; }) }, scene);
  cockpitLid.material = lidMat; cockpitLid.parent = root; cockpitLid.alphaIndex = 0;
  const meshes = [...K.out, cockpitLid];
  for (const m of meshes) { m.isPickable = false; m.receiveShadows = true; }

  // mãos do piloto: as duas na cana (a direita na manopla do acelerador)
  const leftHand = new TransformNode("ltLeftHand", scene); leftHand.parent = root;
  const rightHand = new TransformNode("ltRightHand", scene); rightHand.parent = root;
  const toRoot = (n: TransformNode, off: Vector3) => {
    piv.computeWorldMatrix(true); ax.computeWorldMatrix(true); n.computeWorldMatrix(true);
    const w = Vector3.TransformCoordinates(off, n.getWorldMatrix());
    const inv = root.getWorldMatrix().clone(); inv.invert();
    return Vector3.TransformCoordinates(w, inv);
  };
  let phase = 0;
  const controls: DinghyControls = {
    meshes: [], wheelGrip: leftHand, leverGrip: rightHand, pilotAboard: true,
    setLantern() { /* sem luzes */ },
    update(_dt: number, _t: BoatTelemetry, _i: VehicleInput) {
      leftHand.position.copyFrom(toRoot(gripNode, new Vector3(0, 0, -0.32)));
      rightHand.position.copyFrom(toRoot(gripNode, new Vector3(0, 0, 0.04)));
    },
  };
  return {
    root, engine: piv, propeller, telltale, propBlur, lights: null, cockpitLid, meshes, floor, controls,
    updateEngine: (T, dt) => {
      // polias giram com o motor (escala visual, como a hélice) e o motor treme (mais na lenta e a frio)
      const rps = (T.rpm / 60) * 0.12;
      phase += rps * 2 * Math.PI * dt;
      for (const p of pulleys) p.n.rotation.z = -phase * p.ratio;
      const run = T.engine === "running", shake = run ? 0.004 + 0.005 * (1 - Math.min(1, T.rpm / 2500)) + 0.004 * (T.diesel?.white ?? 0) : T.engine === "cranking" ? 0.006 : 0;
      eng.position.set(Math.sin(phase * 7.3) * shake, Math.sin(phase * 11.1) * shake * 0.6, 0);
      // fumaça: cinza no giro, PRETA com o turbo atrasado (soot), BRANCA a frio / partindo
      exhaustNode.computeWorldMatrix(true);
      smoke.emitter = exhaustNode.getAbsolutePosition().clone();
      const D = T.diesel, soot = D?.soot ?? 0, white = D?.white ?? 0;
      const base = run ? 18 + 60 * (T.rpm / 3800) : T.engine === "cranking" ? 25 : 0;
      smoke.emitRate = base + 260 * soot + 120 * white;
      const g = 0.62 - 0.55 * soot + 0.35 * white;
      const a = Math.min(0.75, 0.1 + 0.6 * soot + 0.45 * white);
      smoke.color1 = new Color4(g, g, g, a); smoke.color2 = new Color4(g * 0.9, g * 0.9, g * 0.9, a * 0.7); smoke.colorDead = new Color4(g, g, g, 0);
      smoke.direction1 = new Vector3(-0.3, 1.4, -0.8); smoke.direction2 = new Vector3(0.3, 2.2, -1.6);
    },
  };
};
