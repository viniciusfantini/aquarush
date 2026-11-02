// Carretinha de reboque (uma para cada barco), estacionada de ré na rampa com a traseira dentro d'água.
// Física no REFERENCIAL DA CARRETINHA (TrailerCollider em world.ts): berço em V sobre os bunks (só apoia
// por cima, atrito de carpete molhado), postes-guia e batente/guincho. Como os colisores andam com a
// pose da carretinha, o barco pode ser carregado/descarregado onde ela estiver (puxada pelo veículo).

import { RAMP, rampY, toFrameLocal, fromFrame, type TrailerCollider, type FramePose } from "./world.ts";
import type { SpeedboatParams, VesselKind } from "./params.ts";
import type { Speedboat } from "./boat.ts";
import type { Vec3 } from "./math.ts";

export interface TrailerLayout {
  kind: VesselKind;
  cx: number;            // eixo da carretinha estacionada (X do mundo) — alinhada com a rampa
  sFront: number;        // s (ao longo da rampa) do batente de proa / guincho, estacionada
  sRear: number;         // s da traseira (dentro d'água), estacionada
  zFront: number; zRear: number;
  clear: number;         // altura do apoio da quilha acima do chão (no referencial da carretinha)
  vSlope: number;        // inclinação do V do berço (≈ "deadrise" do casco)
  halfW: number;         // meia-largura útil do berço
  postX: number;         // afastamento dos postes-guia
  frameW: number;        // largura do chassi (visual)
  coupler: number;       // s do engate (frente do cabeçalho), estacionada
  length: number;
  winchLocal: Vec3;      // guincho (onde a cinta prende a proa), no referencial da carretinha
  parked: FramePose;     // pose estacionada (origem = guincho no chão; +Z local = traseira)
  collider: TrailerCollider; // pose atual + geometria (a pose acompanha o veículo)
}

/** Monta a carretinha de cada barco (dimensões de carretinhas reais para cascos de 3 e 6 m). */
export const buildTrailer = (P: SpeedboatParams): TrailerLayout => {
  const lancha = P.kind !== "bote"; // lancha e rápida: carretinha grande (rodado duplo), puxada pela caminhonete
  const rapida = P.kind === "rapida" || P.kind === "turbina"; // 8,6 m / 10 m: carretinha mais longa e berço mais alto (V profundo)
  const sFront = lancha ? -1.0 : -0.2;
  const length = rapida ? P.length : lancha ? 7.0 : 3.6;
  const sRear = sFront + length;
  const clear = P.kind === "turbina" ? 0.47 : rapida ? 0.44 : lancha ? 0.38 : 0.22;
  const vSlope = rapida ? 0.2 : lancha ? 0.18 : 0.14; // ≈ V do fundo do casco (bunkPoints)
  const halfW = rapida ? 1.0 : lancha ? 0.95 : 0.7;
  const postX = P.beam / 2 + 0.12;
  const cx = RAMP.x;
  const parked: FramePose = { x: cx, y: rampY(sFront), z: RAMP.z0 + sFront, yaw: 0, pitch: Math.atan(RAMP.slope) };
  const post = (x: number, z: number, h: number) => ({ minX: x - 0.05, maxX: x + 0.05, minY: -0.5, maxY: h, minZ: z - 0.05, maxZ: z + 0.05 });
  // postes-guia altos (ficam acima d'água mesmo com a carretinha mais funda que a posição ideal)
  const hRear = lancha ? 1.8 : 1.3, hMid = lancha ? 1.6 : 1.15;
  const collider: TrailerCollider = {
    pose: { ...parked }, length, clear, vSlope, halfW, mu: 0.2, // carpete molhado
    boxes: [
      // postes-guia (2 pares: traseira e meio) — o barco entra entre eles
      post(-postX, length - 0.15, hRear), post(postX, length - 0.15, hRear),
      post(-postX, length * 0.55, hMid), post(postX, length * 0.55, hMid),
      // batente de proa (rolete do guincho)
      // (alto como a coluna do guincho real: segura a proa mesmo com o barco flutuando sobre uma carretinha funda)
      // batente de proa em V (rolete + guias laterais da proa): boca de ±0,6 m recebe a proa desalinhada e centraliza
      { minX: -0.6, maxX: 0.6, minY: clear - 0.4, maxY: clear + (lancha ? 1.35 : 0.9), minZ: -1.5, maxZ: 0, onlyPlusZ: true }, // V: sempre empurra a proa para trás
    ],
  };
  return {
    kind: P.kind, cx, sFront, sRear, zFront: RAMP.z0 + sFront, zRear: RAMP.z0 + sRear, clear, vSlope, halfW, postX,
    frameW: lancha ? 2.1 : 1.5, coupler: sFront - (lancha ? 1.5 : 1.1), length,
    winchLocal: { x: 0, y: clear + (lancha ? 0.55 : 0.35), z: 0.1 }, parked, collider,
  };
};

export interface LoadState {
  near: boolean;          // perto da carretinha e de proa para o guincho
  lateral: number;        // m (desvio do eixo; + = lado +X da carretinha = bombordo do barco que entra)
  angleDeg: number;       // desvio de rumo (0 = proa apontando para o guincho)
  bowGap: number;         // m até o batente (≤ 0,35 = encostado)
  onBunks: boolean;       // casco apoiado no berço
  overBunks: boolean;     // sobre o berço (apoiado ou flutuando acima dele — carretinha funda)
  bunkDepth: number;      // m de água sobre a traseira do berço (quanto a carretinha está afundada)
  loaded: boolean;        // barco na carretinha, alinhado e parado
}

const bowPoint = (P: SpeedboatParams): Vec3 => P.contactPoints.reduce((a, b) => (b.z > a.z ? b : a));

/** Estado da manobra de colocar o barco na carretinha (onde ela estiver). */
export const trailerLoadState = (boat: Speedboat, t: TrailerLayout): LoadState => {
  const P = boat.params, pose = t.collider.pose;
  const bl = bowPoint(P);
  const bow = toFrameLocal(pose, boat.toWorld({ x: 0, y: bl.y, z: bl.z }));
  const stern = toFrameLocal(pose, boat.toWorld({ x: 0, y: 0, z: -P.length / 2 }));
  const c = toFrameLocal(pose, boat.pos);
  const keel = toFrameLocal(pose, boat.toWorld({ x: 0, y: Math.min(...P.contactPoints.map((p) => p.y)), z: 0 }));
  // o barco entra de proa para o guincho: rumo −Z local
  const dx = bow.x - stern.x, dz = bow.z - stern.z;
  const angleDeg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const lateral = (bow.x + stern.x) / 2;
  const bowGap = bow.z;
  const near = Math.abs(lateral) < 6 && bow.z > -1 && bow.z < t.length + 15 && Math.abs(angleDeg) < 60 && dz < 0;
  const inside = c.z > 0 && c.z < t.length && Math.abs(lateral) < t.halfW;
  const onBunks = inside && keel.y - t.clear < 0.08;
  const overBunks = inside && keel.y - t.clear < 0.9;
  const speed = Math.hypot(boat.vel.x, boat.vel.z);
  // encaixado: proa no batente, alinhado e parado — apoiado OU flutuando sobre o berço (o guincho puxa)
  // flutuando (carretinha funda) o guincho ainda endireita o barco ao puxar: aceita um pouco mais de desalinho
  const latOk = onBunks ? 0.25 : 0.4, angOk = onBunks ? 6 : 10;
  const loaded = overBunks && bowGap < 0.35 && Math.abs(lateral) < latOk && Math.abs(angleDeg) < angOk && speed < 0.4 && !boat.capsized;
  const rear = fromFrame(pose, { x: 0, y: t.clear, z: t.length });
  return { near, lateral, angleDeg, bowGap, onBunks, overBunks, bunkDepth: -rear.y, loaded };
};

/**
 * Cinta do guincho: o piloto prende a cinta no olhal de proa. Ela só puxa (não empurra): mola rígida e
 * amortecida entre o olhal e o guincho. Solta com "desengatar" (U) ou no reset (R/T).
 */
export const attachWinch = (boat: Speedboat, t: TrailerLayout): void => {
  const eyeL = bowPoint(boat.params);
  const eye = boat.toWorld(eyeL);
  const anchor = fromFrame(t.collider.pose, t.winchLocal);
  const len = Math.hypot(eye.x - anchor.x, eye.y - anchor.y, eye.z - anchor.z);
  boat.winchStrap = { anchor, local: { ...eyeL }, length: Math.max(0.05, len) };
};

/**
 * Pose do barco assentado no berço, no referencial da carretinha (proa no guincho, centralizado,
 * quilha sobre os bunks). É onde a cinta do guincho deixa o barco para rebocar — mesmo que ele tenha
 * entrado flutuando numa carretinha funda.
 */
export const seatedBoatLocal = (P: SpeedboatParams, t: TrailerLayout, boatLocalZ: number): { y: number; z: number } => {
  const keelY = Math.min(...P.contactPoints.map((p) => p.y), ...P.bunkPoints.map((p) => p.y));
  const bowZ = bowPoint(P).z;
  // proa encostada no batente (z local ≈ 0,25 m atrás dele); o barco entra de proa → origem em z = bowZ + folga
  void boatLocalZ; // o guincho puxa até a proa encostar
  return { y: t.clear - keelY + 0.02, z: bowZ + 0.25 };
};
