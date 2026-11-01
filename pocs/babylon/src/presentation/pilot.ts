// Piloto sentado no posto de boreste, com proporções humanas e braços articulados por IK de
// 2 ossos: a mão esquerda segue o aro do volante e a direita a manopla da manete.
// Cabeça/tronco recebem nomes "pilot*" (escondidos na câmera de cockpit — a câmera fica nos olhos).

import { type Scene, Mesh, MeshBuilder, PBRMaterial, Color3, TransformNode, Vector3, Quaternion } from "@babylonjs/core";
import { HELM_X } from "./helm.ts";


const FLOOR_LANCHA = 0.02;

const pbr = (scene: Scene, name: string, c: Color3, rough = 0.6): PBRMaterial => {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = c; m.metallic = 0; m.roughness = rough; m.environmentIntensity = 0.7;
  return m;
};

/** Cilindro de altura 1 orientado entre dois pontos (membro). */
const setLimb = (m: Mesh, a: Vector3, b: Vector3) => {
  const d = b.subtract(a);
  const L = d.length();
  m.position.copyFrom(a.add(b).scale(0.5));
  m.scaling.y = L;
  const q = m.rotationQuaternion ?? new Quaternion();
  Quaternion.FromUnitVectorsToRef(Vector3.Up(), d.scale(1 / Math.max(L, 1e-6)), q);
  m.rotationQuaternion = q;
};

/** IK de 2 ossos: devolve o cotovelo dado ombro, alvo, comprimentos e vetor de "polo". */
const solveElbow = (s: Vector3, t: Vector3, l1: number, l2: number, pole: Vector3): Vector3 => {
  const st = t.subtract(s);
  let d = st.length();
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  const dir = st.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  // componente do polo perpendicular à linha ombro-alvo
  const p = pole.subtract(dir.scale(Vector3.Dot(pole, dir))).normalize();
  return s.add(dir.scale(a)).add(p.scale(h));
};

export interface Pilot {
  meshes: Mesh[];
  /** nó da pessoa: filho do barco (sentada) ou solto no mundo (na água) */
  group: TransformNode;
  /** alvos das mãos no espaço local da lancha */
  update(leftHand: Vector3, rightHand: Vector3): void;
  /** na água: centro do colete em `pos` (mundo), virada para `yaw`; `swim` 0..1 = esforço de nado (braçadas) */
  float(pos: Vector3, yaw: number, t: number, swim?: number): void;
  /** em pé no píer: pés em `pos` (mundo), virada para `yaw`, braços soltos */
  stand(pos: Vector3, yaw: number, t: number): void;
  /** de volta ao banco */
  board(root: TransformNode): void;
}

export interface PersonOpts {
  x: number;            // centro do banco (local)
  zc: number;           // centro do assento (local, z)
  prefix: string;       // prefixo dos nomes das malhas ("pilot" = escondido na câmera de cockpit)
  skin: Color3; shirt: Color3; vest: Color3; shorts: Color3; cap: Color3; hair: Color3;
  floor?: number;       // altura do piso sob os pés (local); padrão = piso da lancha
}

/** Pessoa sentada (proporções humanas, braços por IK). */
export const buildPerson = (scene: Scene, root: TransformNode, o: PersonOpts): Pilot => {
  const meshes: Mesh[] = [];
  const k = o.prefix;
  const group = new TransformNode(k + "Group", root.getScene());
  group.parent = root;
  const add = (m: Mesh, mat: PBRMaterial) => { m.material = mat; m.parent = group; m.isPickable = false; meshes.push(m); return m; };
  const skin = pbr(scene, k + "Skin", o.skin, 0.55);
  const shirt = pbr(scene, k + "Shirt", o.shirt, 0.7);
  const vest = pbr(scene, k + "VestM", o.vest, 0.55);
  const shorts = pbr(scene, k + "ShortsM", o.shorts, 0.8);
  const shoe = pbr(scene, k + "ShoeM", new Color3(0.92, 0.92, 0.9), 0.5);
  const capM = pbr(scene, k + "CapM", o.cap, 0.6);
  const glasses = pbr(scene, k + "GlassesM", new Color3(0.02, 0.02, 0.03), 0.08);
  const hair = pbr(scene, k + "HairM", o.hair, 0.8);

  const FLOOR = o.floor ?? FLOOR_LANCHA;
  const X = o.x;
  const DZ = o.zc + 0.22; // o modelo foi feito para um assento centrado em z = −0,22
  // ---- tronco (levemente reclinado) ----
  const hips = new Vector3(X, FLOOR + 0.53, -0.27 + DZ);
  const chest = new Vector3(X, FLOOR + 0.97, -0.31 + DZ);
  const pelvis = add(MeshBuilder.CreateSphere(k + "Pelvis", { diameter: 1, segments: 12 }, scene), shorts);
  pelvis.scaling.set(0.34, 0.2, 0.28); pelvis.position.copyFrom(hips);
  const torso = add(MeshBuilder.CreateCapsule(k + "Torso", { radius: 0.5, height: 2.2, tessellation: 16 }, scene), shirt);
  torso.scaling.set(0.34, 0.25, 0.22);
  torso.position.copyFrom(hips.add(chest).scale(0.5).add(new Vector3(0, 0.02, 0)));
  torso.rotation.x = -0.09;
  const vestM = add(MeshBuilder.CreateCapsule(k + "Vest", { radius: 0.5, height: 1.6, tessellation: 16 }, scene), vest);
  vestM.scaling.set(0.36, 0.22, 0.24);
  vestM.position.copyFrom(torso.position.add(new Vector3(0, 0.07, 0.005)));
  vestM.rotation.x = -0.09;
  // ombros
  const shL = chest.add(new Vector3(-0.19, 0.0, 0.0)), shR = chest.add(new Vector3(0.19, 0.0, 0.0));
  for (const s of [shL, shR]) add(MeshBuilder.CreateSphere(k + "Shoulder", { diameter: 0.11, segments: 10 }, scene), shirt).position.copyFrom(s);
  // pescoço, cabeça, boné, óculos
  const neck = add(MeshBuilder.CreateCylinder(k + "Neck", { height: 0.08, diameter: 0.085 }, scene), skin);
  neck.position.set(X, FLOOR + 1.05, -0.3 + DZ);
  const headC = new Vector3(X, FLOOR + 1.17, -0.29 + DZ);
  const head = add(MeshBuilder.CreateSphere(k + "Head", { diameter: 1, segments: 16 }, scene), skin);
  head.scaling.set(0.18, 0.225, 0.2); head.position.copyFrom(headC);
  const jaw = add(MeshBuilder.CreateSphere(k + "Jaw", { diameter: 1, segments: 12 }, scene), skin);
  jaw.scaling.set(0.14, 0.1, 0.14); jaw.position.copyFrom(headC.add(new Vector3(0, -0.06, 0.035)));
  const nose = add(MeshBuilder.CreateBox(k + "Nose", { width: 0.022, height: 0.04, depth: 0.03 }, scene), skin);
  nose.position.copyFrom(headC.add(new Vector3(0, -0.005, 0.1)));
  for (const s of [-1, 1]) add(MeshBuilder.CreateSphere(k + "Ear", { diameter: 0.045, segments: 8 }, scene), skin).position.copyFrom(headC.add(new Vector3(s * 0.09, 0, 0)));
  const hairM = add(MeshBuilder.CreateSphere(k + "Hair", { diameter: 1, segments: 12, slice: 0.55 }, scene), hair);
  hairM.scaling.set(0.19, 0.2, 0.21); hairM.position.copyFrom(headC.add(new Vector3(0, 0.01, -0.01)));
  const capDome = add(MeshBuilder.CreateSphere(k + "Cap", { diameter: 1, segments: 14, slice: 0.5 }, scene), capM);
  capDome.scaling.set(0.195, 0.2, 0.215); capDome.position.copyFrom(headC.add(new Vector3(0, 0.035, 0)));
  const brim = add(MeshBuilder.CreateCylinder(k + "CapBrim", { height: 0.01, diameter: 1, tessellation: 20, arc: 0.5 }, scene), capM);
  brim.scaling.set(0.17, 1, 0.16); brim.rotation.y = Math.PI / 2 + Math.PI / 2; brim.rotation.x = 0.12;
  brim.position.copyFrom(headC.add(new Vector3(0, 0.045, 0.1)));
  const shades = add(MeshBuilder.CreateBox(k + "Glasses", { width: 0.17, height: 0.035, depth: 0.012 }, scene), glasses);
  shades.position.copyFrom(headC.add(new Vector3(0, 0.02, 0.098)));

  // ---- pernas: sentado (coxa para frente, canela para baixo) ou em pé (retas; na água, batendo as pernas) ----
  const legs = [-1, 1].map((s) => ({
    s,
    thigh: add(MeshBuilder.CreateCylinder(k + "Thigh", { height: 1, diameterTop: 0.12, diameterBottom: 0.15, tessellation: 12 }, scene), shorts),
    knee: add(MeshBuilder.CreateSphere(k + "Knee", { diameter: 0.115, segments: 10 }, scene), skin),
    shin: add(MeshBuilder.CreateCylinder(k + "Shin", { height: 1, diameterTop: 0.105, diameterBottom: 0.075, tessellation: 12 }, scene), skin),
    foot: add(MeshBuilder.CreateCapsule(k + "Shoe", { radius: 0.045, height: 0.25, orientation: new Vector3(0, 0, 1) }, scene), shoe),
  }));
  const SOLE = FLOOR - 0.465; // sola do pé em pé (local)
  /** stand: 0 = sentado, 1 = em pé; kick: amplitude da pernada (m), ph: fase */
  const setLegs = (stand: number, kick = 0, ph = 0) => {
    for (const L of legs) {
      const s = L.s, kk = kick * Math.sin(ph + (s > 0 ? Math.PI : 0));
      const hip = new Vector3(X + s * 0.1, FLOOR + 0.5, -0.24 + DZ - 0.03 * stand);
      const knee = Vector3.Lerp(new Vector3(X + s * 0.12, FLOOR + 0.52, 0.16 + DZ), new Vector3(X + s * 0.11, FLOOR + 0.06, -0.24 + DZ + 0.6 * kk), stand);
      const ankle = Vector3.Lerp(new Vector3(X + s * 0.13, FLOOR + 0.09, 0.27 + DZ), new Vector3(X + s * 0.11, FLOOR - 0.38, -0.3 + DZ + kk), stand);
      setLimb(L.thigh, knee, hip);
      L.knee.position.copyFrom(knee);
      setLimb(L.shin, knee, ankle);
      L.foot.position.copyFrom(ankle.add(new Vector3(0, -0.04, 0.07)));
    }
  };
  setLegs(0);

  // ---- braços (IK) ----
  const upper: Mesh[] = [], fore: Mesh[] = [], elbowM: Mesh[] = [], hand: Mesh[] = [], sleeve: Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    upper.push(add(MeshBuilder.CreateCylinder("armUpper", { height: 1, diameterTop: 0.085, diameterBottom: 0.075, tessellation: 12 }, scene), skin));
    sleeve.push(add(MeshBuilder.CreateCylinder("armSleeve", { height: 1, diameterTop: 0.11, diameterBottom: 0.1, tessellation: 12 }, scene), shirt));
    fore.push(add(MeshBuilder.CreateCylinder("armFore", { height: 1, diameterTop: 0.07, diameterBottom: 0.055, tessellation: 12 }, scene), skin));
    elbowM.push(add(MeshBuilder.CreateSphere("armElbow", { diameter: 0.075, segments: 8 }, scene), skin));
    const h = add(MeshBuilder.CreateSphere("armHand", { diameter: 1, segments: 10 }, scene), skin);
    h.scaling.set(0.06, 0.085, 0.05);
    hand.push(h);
  }
  const L1 = 0.3, L2 = 0.29;
  // centro do colete (local do barco) — é o ponto que boia na linha d'água
  const anchor = new Vector3(X, FLOOR + 0.78, -0.29 + DZ);
  const q = new Quaternion();

  const api: Pilot = {
    meshes,
    group,
    float(pos: Vector3, yaw: number, t: number, swim = 0) {
      if (group.parent) group.parent = null;
      // parada: em pé na água (o colete segura a cabeça fora), pernas retas batendo devagar;
      // nadando: corpo inclina para a frente, pernada mais forte e um pouco de rolamento a cada braçada
      const stroke = t * 3.2;
      setLegs(1, 0.07 + 0.13 * swim, t * (2.4 + 3 * swim));
      Quaternion.FromEulerAnglesToRef(0.04 + 1.05 * swim + 0.05 * Math.sin(t * 1.3), yaw, 0.04 * Math.sin(t * 0.9) + 0.12 * swim * Math.sin(stroke), q);
      group.rotationQuaternion = q;
      const off = anchor.applyRotationQuaternion(q);
      group.position.copyFrom(pos.subtract(off));
      // braços: abertos remando devagar (parada) ou braçadas alternadas para a frente (nadando)
      const sw = 0.06 * Math.sin(t * 2.2);
      const arm = (side: number, ph: number) => {
        const c = Math.cos(stroke + ph), sn = Math.sin(stroke + ph);
        const idle = new Vector3(X + side * 0.42, FLOOR + 0.82 + side * sw, -0.1 + DZ);
        const swimT = new Vector3(X + side * 0.22, FLOOR + 0.85 + 0.25 * Math.max(0, sn), -0.05 + DZ + 0.42 * c);
        return Vector3.Lerp(idle, swimT, swim);
      };
      api.update(arm(-1, 0), arm(1, Math.PI));
    },
    stand(pos: Vector3, yaw: number, t: number) {
      if (group.parent) group.parent = null;
      setLegs(1);
      Quaternion.FromEulerAnglesToRef(0, yaw + 0.06 * Math.sin(t * 0.4), 0, q);
      group.rotationQuaternion = q;
      group.position.copyFrom(pos.subtract(new Vector3(X, SOLE, -0.27 + DZ).applyRotationQuaternion(q)));
      const sw = 0.02 * Math.sin(t * 1.1);
      api.update(new Vector3(X - 0.25, FLOOR + 0.46 + sw, -0.25 + DZ), new Vector3(X + 0.25, FLOOR + 0.46 - sw, -0.25 + DZ));
    },
    board(root2: TransformNode) {
      setLegs(0);
      group.parent = root2;
      group.position.setAll(0);
      group.rotationQuaternion = Quaternion.Identity();
    },
    update(leftHand: Vector3, rightHand: Vector3) {
      const targets = [leftHand, rightHand];
      const shoulders = [shL, shR];
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const s = shoulders[i];
        const t = targets[i];
        const pole = new Vector3(side * 0.6, -1, -0.25); // cotovelos para baixo e para fora
        const e = solveElbow(s, t, L1, L2, pole);
        setLimb(upper[i], s, e);
        setLimb(sleeve[i], s, Vector3.Lerp(s, e, 0.45));
        setLimb(fore[i], e, t);
        elbowM[i].position.copyFrom(e);
        hand[i].position.copyFrom(t);
      }
    },
  };
  return api;
};

/** Piloto no posto de boreste (mãos controladas por IK no volante e na manete). */
export const buildPilot = (scene: Scene, root: TransformNode, seat = { x: HELM_X, zc: -0.08, floor: FLOOR_LANCHA }): Pilot => buildPerson(scene, root, {
  x: seat.x, zc: seat.zc, floor: seat.floor, prefix: "pilot",
  skin: new Color3(0.78, 0.57, 0.43), shirt: new Color3(0.06, 0.45, 0.55), vest: new Color3(0.95, 0.4, 0.05),
  shorts: new Color3(0.82, 0.78, 0.66), cap: new Color3(0.06, 0.12, 0.28), hair: new Color3(0.18, 0.12, 0.08),
});

/** Passageiro sentado com as mãos sobre as coxas. */
export const buildPassenger = (scene: Scene, root: TransformNode, x: number, zc: number, prefix: string, look: number, floor = FLOOR_LANCHA): Pilot => {
  const FLOOR = floor;
  const looks = [
    { skin: new Color3(0.55, 0.38, 0.27), shirt: new Color3(0.85, 0.2, 0.25), cap: new Color3(0.9, 0.9, 0.88), hair: new Color3(0.08, 0.06, 0.05) },
    { skin: new Color3(0.86, 0.68, 0.55), shirt: new Color3(0.95, 0.85, 0.3), cap: new Color3(0.15, 0.5, 0.3), hair: new Color3(0.55, 0.38, 0.18) },
    { skin: new Color3(0.68, 0.48, 0.35), shirt: new Color3(0.35, 0.3, 0.75), cap: new Color3(0.8, 0.35, 0.1), hair: new Color3(0.12, 0.08, 0.06) },
  ][look % 3];
  const p = buildPerson(scene, root, { x, zc, prefix, floor, vest: new Color3(0.95, 0.4, 0.05), shorts: new Color3(0.2, 0.3, 0.45), ...looks });
  const DZ = zc + 0.22;
  const rest = () => p.update(new Vector3(x - 0.12, FLOOR + 0.6, 0.06 + DZ), new Vector3(x + 0.12, FLOOR + 0.6, 0.06 + DZ));
  rest();
  const board = p.board;
  p.board = (r) => { board(r); rest(); };
  return p;
};
