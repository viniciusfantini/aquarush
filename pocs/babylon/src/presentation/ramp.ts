// Rampa de concreto, carretinhas de reboque e veículos (carro comum para o bote, caminhonete para a lancha).
// Tudo procedural. A geometria segue a física: a rampa é a mesma de sim/world.ts (RAMP, rampY) e a
// carretinha usa o TrailerLayout de sim/trailer.ts (berço, postes-guia, batente nos mesmos lugares).

import { type Scene, Mesh, MeshBuilder, PBRMaterial, StandardMaterial, Color3, TransformNode, Vector3, Quaternion, DynamicTexture, Texture } from "@babylonjs/core";
import { RAMP, rampY } from "../sim/world.ts";
import type { TrailerLayout } from "../sim/trailer.ts";
import { pbr, roundedBox, roundedRect } from "./boatMesh.ts";

const SLOPE_ANG = Math.atan(RAMP.slope);

/** Faixa de concreto com ranhuras antiderrapantes, guias laterais e área de manobra em terra. */
export const buildRamp = (scene: Scene): Mesh[] => {
  const meshes: Mesh[] = [];
  // textura: concreto com ranhuras transversais (antiderrapante) e manchas de uso
  const tex = new DynamicTexture("rampTex", { width: 256, height: 1024 }, scene, true);
  const c = tex.getContext() as CanvasRenderingContext2D;
  c.fillStyle = "#9a9890"; c.fillRect(0, 0, 256, 1024);
  for (let i = 0; i < 4000; i++) { const v = 130 + Math.random() * 50; c.fillStyle = `rgba(${v},${v - 2},${v - 8},0.35)`; c.fillRect(Math.random() * 256, Math.random() * 1024, 2, 2); }
  for (let y = 0; y < 1024; y += 16) { c.fillStyle = "rgba(60,60,58,0.45)"; c.fillRect(0, y, 256, 3); }
  c.fillStyle = "rgba(40,45,40,0.25)"; c.fillRect(70, 0, 30, 1024); c.fillRect(156, 0, 30, 1024); // marcas de pneu
  tex.update();
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  const mat = new PBRMaterial("rampConcrete", scene);
  mat.albedoTexture = tex; mat.metallic = 0; mat.roughness = 0.9; mat.environmentIntensity = 0.5;
  // laje acompanhando a rampa (ligeiramente acima do terreno para não "piscar")
  const N = 40;
  const rows: Vector3[][] = [];
  for (let i = 0; i <= N; i++) {
    const s = RAMP.sMin + (RAMP.sMax - RAMP.sMin) * (i / N);
    const y = rampY(s) + 0.03, z = RAMP.z0 + s;
    rows.push([new Vector3(RAMP.x - RAMP.width / 2, y, z), new Vector3(RAMP.x + RAMP.width / 2, y, z)]);
  }
  const slab = MeshBuilder.CreateRibbon("rampSlab", { pathArray: rows, sideOrientation: Mesh.DOUBLESIDE }, scene);
  slab.material = mat;
  // UV: repete as ranhuras ao longo da rampa
  const uv = slab.getVerticesData("uv")!;
  for (let i = 0; i < uv.length; i += 2) uv[i + 1] *= (RAMP.sMax - RAMP.sMin) / 6;
  slab.setVerticesData("uv", uv);
  meshes.push(slab);
  // guias laterais (meio-fio de concreto)
  const curbMat = pbr(scene, "rampCurb", new Color3(0.68, 0.67, 0.63), 0, 0.85);
  for (const side of [-1, 1]) {
    const path: Vector3[] = [];
    for (let i = 0; i <= N; i++) { const s = RAMP.sMin + (RAMP.sMax - RAMP.sMin) * (i / N); path.push(new Vector3(RAMP.x + side * (RAMP.width / 2 + 0.12), rampY(s) + 0.08, RAMP.z0 + s)); }
    const curb = MeshBuilder.ExtrudeShape("rampCurbM", { shape: roundedRect(0.24, 0.22, 0.04, 2), path, cap: Mesh.CAP_ALL }, scene);
    curb.material = curbMat; meshes.push(curb);
  }
  // placa "RAMPA" em terra
  const signTex = new DynamicTexture("rampSign", { width: 256, height: 128 }, scene, true);
  const sc = signTex.getContext() as CanvasRenderingContext2D;
  sc.fillStyle = "#0d4f8b"; sc.fillRect(0, 0, 256, 128); sc.fillStyle = "#fff"; sc.font = "bold 46px Arial";
  sc.textAlign = "center"; sc.textBaseline = "middle"; sc.fillText("RAMPA", 128, 50); sc.font = "24px Arial"; sc.fillText("descida de barcos", 128, 96);
  signTex.update();
  const signMat = new StandardMaterial("rampSignMat", scene); signMat.diffuseTexture = signTex; signMat.specularColor = Color3.Black();
  const sx = RAMP.x + RAMP.width / 2 + 1.2, sz = RAMP.z0 + RAMP.sMin + 3;
  const sign = MeshBuilder.CreatePlane("rampSignM", { width: 1.2, height: 0.6, sideOrientation: Mesh.DOUBLESIDE }, scene);
  sign.material = signMat; sign.position.set(sx, rampY(RAMP.sMin + 3) + 1.9, sz); sign.rotation.y = Math.PI; meshes.push(sign);
  const pole = MeshBuilder.CreateCylinder("rampSignPole", { height: 2, diameter: 0.06 }, scene);
  pole.material = curbMat; pole.position.set(sx, rampY(RAMP.sMin + 3) + 0.9, sz + 0.02); meshes.push(pole);
  for (const m of meshes) m.isPickable = false;
  return meshes;
};

/** Pose sobre a rampa: posição em s (ao longo da rampa), alinhada com ela; yaw π = de frente para a terra. */
const placeOnRamp = (node: TransformNode, s: number, x: number, facingLand: boolean) => {
  node.position.set(x, rampY(s), RAMP.z0 + s);
  // de frente para a terra o nariz sobe (−pitch); de costas (frente para o lago) o "nariz" desce
  node.rotationQuaternion = Quaternion.FromEulerAngles(facingLand ? -SLOPE_ANG : SLOPE_ANG, facingLand ? Math.PI : 0, 0);
};

/** Roda: nó de esterço (rotation.y, rodas da frente) → nó de giro (rotation.x) → pneu, aro e raios (o giro aparece). */
export interface WheelNode { steer: TransformNode; spin: TransformNode; front: boolean }
const wheel = (scene: Scene, parent: TransformNode, name: string, r: number, w: number, x: number, y: number, z: number, tire: PBRMaterial, rim: PBRMaterial, meshes: Mesh[], front = false): WheelNode => {
  const steer = new TransformNode(name + "Steer", scene); steer.parent = parent; steer.position.set(x, y, z);
  const spin = new TransformNode(name + "Spin", scene); spin.parent = steer;
  const t = MeshBuilder.CreateCylinder(name + "Tire", { height: w, diameter: r * 2, tessellation: 24 }, scene);
  t.rotation.z = Math.PI / 2; t.parent = spin; t.material = tire; meshes.push(t);
  const h = MeshBuilder.CreateCylinder(name + "Rim", { height: w + 0.01, diameter: r * 1.25, tessellation: 18 }, scene);
  h.rotation.z = Math.PI / 2; h.parent = spin; h.material = rim; meshes.push(h);
  const side = Math.sign(x) || 1;
  for (let k = 0; k < 5; k++) { // raios do aro (lado de fora)
    const sp = MeshBuilder.CreateBox(name + "Spoke", { width: 0.02, height: r * 1.15, depth: 0.05 }, scene);
    sp.parent = spin; sp.material = tire; sp.position.x = side * (w / 2 + 0.008); sp.rotation.x = (k / 5) * Math.PI; meshes.push(sp);
  }
  return { steer, spin, front };
};

/** Carretinha (chassi galvanizado, bunks acarpetados, roletes de quilha, guincho, postes-guia, rodas e para-lamas). */
export const buildTrailerMesh = (scene: Scene, t: TrailerLayout): { root: TransformNode; meshes: Mesh[]; wheels: WheelNode[] } => {
  const wheels: WheelNode[] = [];
  const meshes: Mesh[] = [];
  const root = new TransformNode("trailer_" + t.kind, scene);
  placeOnRamp(root, t.sFront, t.cx, false); // +Z local = descendo a rampa (frente da carretinha = guincho)
  const add = <M extends Mesh>(m: M, mat: PBRMaterial | StandardMaterial): M => { m.material = mat; m.parent = root; meshes.push(m); return m; };
  const galv = pbr(scene, "galvanized_" + t.kind, new Color3(0.72, 0.74, 0.76), 0.8, 0.45);
  const carpet = pbr(scene, "bunkCarpet_" + t.kind, new Color3(0.12, 0.13, 0.16), 0, 0.95);
  const tire = pbr(scene, "tire_" + t.kind, new Color3(0.04, 0.04, 0.045), 0, 0.85);
  const rim = pbr(scene, "rimT_" + t.kind, new Color3(0.8, 0.8, 0.82), 0.9, 0.3);
  const pvc = pbr(scene, "pvc_" + t.kind, new Color3(0.95, 0.95, 0.93), 0, 0.5);
  const rubber = pbr(scene, "roller_" + t.kind, new Color3(0.08, 0.08, 0.09), 0, 0.7);
  const redL = new StandardMaterial("trailerRed_" + t.kind, scene); redL.diffuseColor = new Color3(0.7, 0.05, 0.05); redL.emissiveColor = new Color3(0.25, 0, 0);
  const L = t.sRear - t.sFront;
  const big = t.kind !== "bote";
  const wr = big ? 0.33 : 0.23;        // raio da roda
  const railY = big ? 0.42 : 0.3;      // altura dos longarinas
  const railX = big ? 0.5 : 0.36;
  const halfW = t.frameW / 2;
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: PBRMaterial) => {
    const b = add(MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene), mat); b.position.set(x, y, z); return b;
  };
  // longarinas e travessas
  for (const sx of [-1, 1]) box("trailerRail", 0.07, 0.11, L - 0.3, sx * railX, railY, L / 2 + 0.1, galv);
  for (const z of [0.4, L * 0.3, L * 0.55, L * 0.8, L - 0.1]) box("trailerCross", t.frameW - 0.25, 0.06, 0.07, 0, railY - 0.03, z, galv);
  // cabeçalho em V até o engate
  const zc = -(t.sFront - t.coupler);
  for (const sx of [-1, 1]) {
    const a = new Vector3(sx * railX, railY, 0.6), b = new Vector3(0, railY, zc + 0.25);
    const d = b.subtract(a);
    const beam = add(MeshBuilder.CreateBox("trailerTongue", { width: 0.07, height: 0.1, depth: d.length() }, scene), galv);
    beam.position.copyFrom(a.add(b).scale(0.5)); beam.rotation.y = Math.atan2(d.x, d.z);
  }
  box("coupler", 0.1, 0.1, 0.32, 0, railY + 0.02, zc + 0.12, galv);
  const jack = add(MeshBuilder.CreateCylinder("jack", { height: railY + 0.25, diameter: 0.06 }, scene), galv); jack.position.set(0.12, (railY + 0.25) / 2, zc + 0.6);
  // eixo, rodas, para-lamas
  const za = L * 0.58;
  box("axle", t.frameW + 0.1, 0.07, 0.07, 0, wr, za, galv);
  for (const sx of [-1, 1]) {
    wheels.push(wheel(scene, root, "trailerWheel", wr, big ? 0.2 : 0.14, sx * (halfW + 0.05), wr, za, tire, rim, meshes));
    // para-lama: chapa curva sobre a roda (arco de 180° em volta do eixo X)
    const arcPts: Vector3[] = [];
    for (let i = 0; i <= 12; i++) { const a = Math.PI * (i / 12); arcPts.push(new Vector3(0, wr + Math.sin(a) * (wr + 0.07), Math.cos(a) * (wr + 0.07))); }
    const fw = big ? 0.26 : 0.18;
    const fender = add(MeshBuilder.CreateRibbon("fender", { pathArray: [arcPts.map((p) => p.add(new Vector3(-fw / 2, 0, 0))), arcPts.map((p) => p.add(new Vector3(fw / 2, 0, 0)))], sideOrientation: Mesh.DOUBLESIDE }, scene), galv);
    fender.position.set(sx * (halfW + 0.05), 0, za);
  }
  // bunks acarpetados: topo no berço da física (clear + V·x), suportes até a longarina
  const bunkX = big ? 0.55 : 0.42;
  const bunkTop = t.clear + t.vSlope * bunkX;
  for (const sx of [-1, 1]) {
    const bunk = box("bunk", 0.11, 0.07, L - 0.9, sx * bunkX, bunkTop - 0.035, L / 2 + 0.25, carpet);
    bunk.rotation.z = -sx * Math.atan(t.vSlope);
    for (const z of [L * 0.3, L * 0.8]) box("bunkBracket", 0.05, bunkTop - railY, 0.05, sx * bunkX, (bunkTop + railY) / 2 - 0.03, z, galv);
  }
  // roletes de quilha
  for (const z of [L * 0.2, L * 0.45, L * 0.7, L * 0.92]) {
    const r = add(MeshBuilder.CreateCylinder("keelRoller", { height: 0.18, diameter: 0.1, tessellation: 12 }, scene), rubber);
    r.rotation.z = Math.PI / 2; r.position.set(0, t.clear - 0.05, z);
    box("rollerBracket", 0.04, t.clear - railY + 0.02, 0.05, 0, (t.clear + railY) / 2 - 0.06, z, galv);
  }
  // guincho com coluna, rolete de proa (V) e cinta
  const postH = t.clear + (big ? 1.35 : 0.9);       // coluna do guincho (mesma altura do batente da física)
  const rollerY = t.clear + (big ? 0.75 : 0.45);     // rolete de proa na altura do olhal
  box("winchPost", 0.08, postH - railY, 0.08, 0, (postH + railY) / 2, 0.1, galv);
  const bowRoller = add(MeshBuilder.CreateCylinder("bowRoller", { height: 0.2, diameter: 0.09, tessellation: 12 }, scene), rubber);
  bowRoller.rotation.z = Math.PI / 2; bowRoller.position.set(0, rollerY, 0.17);
  // guias laterais da proa (V) — a boca do batente da física (±0,6 m)
  for (const sx of [-1, 1]) { const g = box("bowGuide", 0.04, 0.5, 0.06, sx * 0.42, rollerY + 0.12, 0.17, rubber); g.rotation.z = sx * 0.75; }
  const drum = add(MeshBuilder.CreateCylinder("winchDrum", { height: 0.14, diameter: 0.12, tessellation: 14 }, scene), galv);
  drum.rotation.z = Math.PI / 2; drum.position.set(0, postH - 0.25, 0.0);
  box("winchHandle", 0.02, 0.02, 0.18, 0.1, postH - 0.25, -0.08, galv);
  box("winchStrap", 0.05, 0.005, 0.25, 0, rollerY + 0.05, 0.2, carpet);
  // postes-guia (mesmos lugares dos colisores) com capas de PVC
  for (const [zl, h] of [[L - 0.15, big ? 1.8 : 1.3], [L * 0.55, big ? 1.6 : 1.15]] as const) {
    for (const sx of [-1, 1]) {
      box("guidePost", 0.05, h, 0.05, sx * t.postX, h / 2, zl, galv);
      const sleeve = add(MeshBuilder.CreateCylinder("guideSleeve", { height: h * 0.6, diameter: 0.075, tessellation: 12 }, scene), pvc);
      sleeve.position.set(sx * t.postX, h * 0.7, zl);
      if (zl === L * 0.55) continue;
      box("guideArm", Math.abs(t.postX - railX) + 0.05, 0.05, 0.05, sx * (t.postX + railX) / 2, railY, zl, galv);
    }
  }
  // barra de luzes traseira
  for (const sx of [-1, 1]) { const l = box("tailLight", 0.16, 0.08, 0.04, sx * (halfW - 0.05), railY + 0.08, L + 0.02, galv); l.material = redL; }
  for (const m of meshes) m.isPickable = false;
  return { root, meshes, wheels };
};

/** Carro comum (hatch médio, ~4,3 m) — reboca o bote. Frente em +Z local; rodas tocam y = 0. */
export const buildCar = (scene: Scene, name: string, paint: Color3): VehicleVis => {
  const meshes: Mesh[] = [], wheels: WheelNode[] = [];
  const root = new TransformNode(name, scene);
  const bodyNode = new TransformNode(name + "BodyNode", scene); bodyNode.parent = root;
  const body = pbr(scene, name + "Paint", paint, 0.4, 0.25, 1);
  const glass = pbr(scene, name + "Glass", new Color3(0.06, 0.08, 0.1), 0, 0.05);
  const dark = pbr(scene, name + "Trim", new Color3(0.05, 0.05, 0.055), 0, 0.6);
  const tire = pbr(scene, name + "Tire", new Color3(0.04, 0.04, 0.045), 0, 0.85);
  const rim = pbr(scene, name + "Rim", new Color3(0.75, 0.76, 0.78), 0.9, 0.3);
  // carroceria num nó próprio (pivô na altura dos eixos) para inclinar com a transferência de carga
  const add = <M extends Mesh>(m: M, mat: PBRMaterial | StandardMaterial): M => { m.material = mat; m.parent = bodyNode; meshes.push(m); return m; };
  const L = 4.3, W = 1.78;
  const lower = add(roundedBox(name + "Body", scene, W, 0.62, L, 0.16), body); lower.position.set(0, 0.62, 0);
  // cabine: loft afinando para cima (para-brisa inclinado na frente, traseira de hatch)
  const secs: Vector3[][] = [];
  for (const [z, w, h] of [[1.0, 1.62, 0.0], [0.55, 1.5, 0.5], [-0.2, 1.42, 0.56], [-1.35, 1.44, 0.52], [-1.85, 1.6, 0.05]] as const) secs.push(roundedRect(w, Math.max(h, 0.02), 0.12, 3).map((p) => new Vector3(p.x, p.y + 0.92 + Math.max(h, 0.02) / 2, z)));
  add(MeshBuilder.CreateRibbon(name + "Cabin", { pathArray: secs, closePath: false, sideOrientation: Mesh.DOUBLESIDE }, scene), glass);
  const roof = add(roundedBox(name + "Roof", scene, 1.36, 0.06, 1.25, 0.03), body); roof.position.set(0, 1.47, -0.75);
  for (const sx of [-1, 1]) {
    add(MeshBuilder.CreateBox(name + "Pillar", { width: 0.05, height: 0.55, depth: 0.08 }, scene), body).position.set(sx * 0.7, 1.2, 0.5);
    for (const z of [1.28, -1.3]) wheels.push(wheel(scene, root, name + "Wheel", 0.31, 0.2, sx * 0.79, 0.31, z, tire, rim, meshes, z > 0));
    add(MeshBuilder.CreateBox(name + "Mirror", { width: 0.16, height: 0.09, depth: 0.05 }, scene), dark).position.set(sx * 0.95, 1.05, 0.55);
  }
  for (const z of [L / 2 - 0.02, -L / 2 + 0.02]) add(roundedBox(name + "Bumper", scene, W + 0.02, 0.2, 0.1, 0.05), dark).position.set(0, 0.4, z);
  const head = new StandardMaterial(name + "Head", scene); head.emissiveColor = new Color3(0.6, 0.6, 0.55); head.diffuseColor = Color3.White();
  const tail = new StandardMaterial(name + "Tail", scene); tail.emissiveColor = new Color3(0.35, 0.02, 0.02); tail.diffuseColor = new Color3(0.6, 0.05, 0.05);
  for (const sx of [-1, 1]) {
    add(MeshBuilder.CreateBox(name + "HeadL", { width: 0.34, height: 0.1, depth: 0.04 }, scene), head).position.set(sx * 0.62, 0.78, L / 2 + 0.01);
    add(MeshBuilder.CreateBox(name + "TailL", { width: 0.28, height: 0.12, depth: 0.04 }, scene), tail).position.set(sx * 0.66, 0.85, -L / 2 - 0.01);
  }
  // engate de reboque (bola) atrás
  add(MeshBuilder.CreateBox(name + "Hitch", { width: 0.07, height: 0.07, depth: 0.3 }, scene), dark).position.set(0, 0.42, -L / 2 - 0.12);
  add(MeshBuilder.CreateSphere(name + "Ball", { diameter: 0.06, segments: 8 }, scene), rim).position.set(0, 0.48, -L / 2 - 0.25);
  for (const m of meshes) m.isPickable = false;
  return { root, body: bodyNode, wheels, meshes, length: L };
};

/** Caminhonete cabine dupla (~5,4 m) — reboca a lancha. */
export const buildPickup = (scene: Scene, name: string, paint: Color3): VehicleVis => {
  const meshes: Mesh[] = [], wheels: WheelNode[] = [];
  const root = new TransformNode(name, scene);
  const bodyNode = new TransformNode(name + "BodyNode", scene); bodyNode.parent = root;
  const body = pbr(scene, name + "Paint", paint, 0.35, 0.28, 1);
  const glass = pbr(scene, name + "Glass", new Color3(0.06, 0.08, 0.1), 0, 0.05);
  const dark = pbr(scene, name + "Trim", new Color3(0.06, 0.06, 0.065), 0, 0.55);
  const tire = pbr(scene, name + "Tire", new Color3(0.04, 0.04, 0.045), 0, 0.9);
  const rim = pbr(scene, name + "Rim", new Color3(0.55, 0.56, 0.58), 0.9, 0.35);
  const add = <M extends Mesh>(m: M, mat: PBRMaterial | StandardMaterial): M => { m.material = mat; m.parent = bodyNode; meshes.push(m); return m; };
  const L = 5.4, W = 1.9;
  // chassi/carroceria baixa, capô, cabine dupla, caçamba
  const lower = add(roundedBox(name + "Lower", scene, W, 0.55, L, 0.12), body); lower.position.set(0, 0.82, 0);
  const hood = add(roundedBox(name + "Hood", scene, W - 0.04, 0.25, 1.35, 0.1), body); hood.position.set(0, 1.2, L / 2 - 0.72);
  const cab = add(roundedBox(name + "Cab", scene, W - 0.08, 0.62, 2.1, 0.12), body); cab.position.set(0, 1.55, 0.55);
  // vidros: para-brisa, vigia traseira e 2 janelas de cada lado (cabine dupla)
  const ws = add(MeshBuilder.CreateBox(name + "Windshield", { width: W - 0.3, height: 0.48, depth: 0.03 }, scene), glass);
  ws.position.set(0, 1.6, 1.61); ws.rotation.x = -0.35;
  add(MeshBuilder.CreateBox(name + "RearGlass", { width: W - 0.4, height: 0.36, depth: 0.03 }, scene), glass).position.set(0, 1.62, -0.51);
  for (const sx of [-1, 1]) for (const z of [1.0, 0.05]) add(MeshBuilder.CreateBox(name + "SideGlass", { width: 0.03, height: 0.38, depth: 0.8 }, scene), glass).position.set(sx * (W / 2 - 0.035), 1.62, z);
  const cabRoof = add(roundedBox(name + "Roof", scene, W - 0.1, 0.08, 1.95, 0.04), body); cabRoof.position.set(0, 1.88, 0.5);
  for (const sx of [-1, 1]) {
    add(MeshBuilder.CreateBox(name + "BedSide", { width: 0.07, height: 0.5, depth: 1.75 }, scene), body).position.set(sx * (W / 2 - 0.035), 1.32, -L / 2 + 0.95);
    for (const z of [1.62, -1.55]) wheels.push(wheel(scene, root, name + "Wheel", 0.4, 0.27, sx * 0.84, 0.4, z, tire, rim, meshes, z > 0));
    for (const z of [1.62, -1.55]) {
      // moldura da caixa de roda (arco plástico preto)
      const pts: Vector3[] = [];
      for (let i = 0; i <= 12; i++) { const ang = Math.PI * (i / 12); pts.push(new Vector3(0, 0.4 + Math.sin(ang) * 0.5, Math.cos(ang) * 0.5)); }
      const arch = add(MeshBuilder.CreateRibbon(name + "Arch", { pathArray: [pts.map((p) => p.add(new Vector3(-0.12, 0, 0))), pts.map((p) => p.add(new Vector3(0.12, 0, 0)))], sideOrientation: Mesh.DOUBLESIDE }, scene), dark);
      arch.position.set(sx * 0.9, 0, z);
    }
    add(MeshBuilder.CreateBox(name + "Mirror", { width: 0.2, height: 0.14, depth: 0.06 }, scene), dark).position.set(sx * 1.05, 1.5, 1.55);
    add(MeshBuilder.CreateBox(name + "Step", { width: 0.12, height: 0.05, depth: 2.0 }, scene), dark).position.set(sx * 1.0, 0.52, 0.5);
  }
  add(MeshBuilder.CreateBox(name + "BedFloor", { width: W - 0.1, height: 0.05, depth: 1.75 }, scene), dark).position.set(0, 1.08, -L / 2 + 0.95);
  add(MeshBuilder.CreateBox(name + "Tailgate", { width: W - 0.04, height: 0.5, depth: 0.07 }, scene), body).position.set(0, 1.32, -L / 2 + 0.06);
  add(MeshBuilder.CreateBox(name + "Grille", { width: 1.2, height: 0.32, depth: 0.05 }, scene), dark).position.set(0, 1.0, L / 2 + 0.01);
  for (const z of [L / 2 + 0.04, -L / 2 - 0.02]) add(roundedBox(name + "Bumper", scene, W + 0.04, 0.2, 0.12, 0.05), dark).position.set(0, 0.62, z);
  const head = new StandardMaterial(name + "Head", scene); head.emissiveColor = new Color3(0.6, 0.6, 0.55); head.diffuseColor = Color3.White();
  const tail = new StandardMaterial(name + "Tail", scene); tail.emissiveColor = new Color3(0.35, 0.02, 0.02); tail.diffuseColor = new Color3(0.6, 0.05, 0.05);
  for (const sx of [-1, 1]) {
    add(MeshBuilder.CreateBox(name + "HeadL", { width: 0.3, height: 0.14, depth: 0.04 }, scene), head).position.set(sx * 0.72, 1.12, L / 2 + 0.02);
    add(MeshBuilder.CreateBox(name + "TailL", { width: 0.1, height: 0.3, depth: 0.04 }, scene), tail).position.set(sx * 0.9, 1.3, -L / 2 + 0.02);
  }
  add(MeshBuilder.CreateBox(name + "Hitch", { width: 0.07, height: 0.07, depth: 0.3 }, scene), dark).position.set(0, 0.5, -L / 2 - 0.12);
  add(MeshBuilder.CreateSphere(name + "Ball", { diameter: 0.06, segments: 8 }, scene), rim).position.set(0, 0.56, -L / 2 - 0.25);
  for (const m of meshes) m.isPickable = false;
  return { root, body: bodyNode, wheels, meshes, length: L };
};

/** Veículo de reboque engatado na carretinha (de ré na rampa, frente para a terra). */
export interface VehicleVis { root: TransformNode; body: TransformNode; wheels: WheelNode[]; meshes: Mesh[]; length: number }

export const buildTowVehicle = (scene: Scene, t: TrailerLayout): VehicleVis => {
  const v = t.kind !== "bote" ? buildPickup(scene, "pickup", new Color3(0.93, 0.93, 0.92)) : buildCar(scene, "car", new Color3(0.62, 0.08, 0.08));
  // o engate (bola, 0,25 m atrás do para-choque) fica sobre o acoplador da carretinha
  const sCenter = t.coupler - (v.length / 2 + 0.25);
  placeOnRamp(v.root, sCenter, t.cx, true);
  return v;
};
