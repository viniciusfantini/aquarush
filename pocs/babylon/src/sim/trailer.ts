// Carretinha de reboque estacionada na rampa (de ré, com a traseira dentro d'água), uma para cada barco.
// Física: berço em V sobre os bunks (SupportSurface: só apoia por cima, atrito baixo de carpete),
// postes-guia na traseira e batente/guincho na frente (BoxCollider). O desafio é o do mundo real:
// alinhar e "subir" o barco na carretinha com o motor para tirá-lo da água.

import { RAMP, rampY, type BoxCollider, type SupportSurface } from "./world.ts";
import type { SpeedboatParams, VesselKind } from "./params.ts";
import type { Speedboat } from "./boat.ts";
import { clamp } from "./math.ts";

export interface TrailerLayout {
  kind: VesselKind;
  cx: number;            // eixo da carretinha (X do mundo) — alinhada com a rampa (+Z = para dentro d'água)
  sFront: number;        // s (ao longo da rampa) do batente de proa / guincho
  sRear: number;         // s da traseira (dentro d'água)
  zFront: number; zRear: number;
  clear: number;         // altura do apoio da quilha acima do concreto
  vSlope: number;        // inclinação do V do berço (≈ "deadrise" do casco)
  halfW: number;         // meia-largura útil do berço
  postX: number;         // afastamento dos postes-guia
  frameW: number;        // largura do chassi (visual)
  coupler: number;       // s do engate (frente do cabeçalho)
  winch: { x: number; y: number; z: number }; // ponto do guincho (onde a cinta prende a proa)
  surfaces: SupportSurface[];
  boxes: BoxCollider[];
}

/** Monta a carretinha de cada barco (dimensões de carretinhas reais para cascos de 3 e 6 m). */
export const buildTrailer = (P: SpeedboatParams): TrailerLayout => {
  const lancha = P.kind === "lancha";
  const sFront = lancha ? -1.0 : -0.2;
  const length = lancha ? 7.0 : 3.6;
  const sRear = sFront + length;
  const clear = lancha ? 0.38 : 0.22;
  const vSlope = lancha ? 0.18 : 0.14; // ≈ V do fundo do casco (bunkPoints)
  const halfW = lancha ? 0.95 : 0.7;
  const postX = P.beam / 2 + 0.12;
  const cx = RAMP.x;
  const zFront = RAMP.z0 + sFront, zRear = RAMP.z0 + sRear;
  const yFront = rampY(sFront) + clear;
  const surfaces: SupportSurface[] = [{ cx, halfW, z0: zFront, z1: zRear, y0: yFront, slope: -RAMP.slope, vSlope, mu: 0.2 }] // carpete molhado;
  const post = (x: number, z: number, h: number): BoxCollider => {
    const y = rampY(z - RAMP.z0);
    return { minX: x - 0.05, maxX: x + 0.05, minY: y - 0.5, maxY: y + h, minZ: z - 0.05, maxZ: z + 0.05 };
  };
  const boxes: BoxCollider[] = [
    // postes-guia (2 pares: traseira e meio) — o barco entra entre eles
    post(cx - postX, zRear - 0.15, lancha ? 1.25 : 0.95), post(cx + postX, zRear - 0.15, lancha ? 1.25 : 0.95),
    post(cx - postX, zRear - length * 0.45, lancha ? 1.1 : 0.85), post(cx + postX, zRear - length * 0.45, lancha ? 1.1 : 0.85),
    // batente de proa (rolete do guincho)
    { minX: cx - 0.12, maxX: cx + 0.12, minY: yFront - 0.4, maxY: yFront + (lancha ? 0.95 : 0.6), minZ: zFront - 0.35, maxZ: zFront },
  ];
  return { kind: P.kind, cx, sFront, sRear, zFront, zRear, clear, vSlope, halfW, postX, frameW: lancha ? 2.1 : 1.5, coupler: sFront - (lancha ? 1.5 : 1.1),
    winch: { x: cx, y: yFront + (lancha ? 0.55 : 0.35), z: zFront + 0.1 }, surfaces, boxes };
};

export interface LoadState {
  near: boolean;          // perto da carretinha e virado para a rampa
  lateral: number;        // m (desvio do eixo, + = boreste da carretinha)
  angleDeg: number;       // desvio de rumo (0 = proa apontando para a rampa)
  bowGap: number;         // m até o batente (≤ 0,35 = encostado)
  onBunks: boolean;       // casco apoiado no berço
  loaded: boolean;        // barco na carretinha, alinhado e parado
}

/** Estado da manobra de colocar o barco na carretinha. */
export const trailerLoadState = (boat: Speedboat, t: TrailerLayout): LoadState => {
  const P = boat.params;
  const f = boat.forward;
  // o barco entra de proa para a terra: rumo −Z
  const angleDeg = (Math.atan2(f.x, -f.z) * 180) / Math.PI;
  const bowLocal = P.contactPoints.reduce((a, b) => (b.z > a.z ? b : a));
  const bow = boat.toWorld({ x: 0, y: bowLocal.y, z: bowLocal.z });
  const stern = boat.toWorld({ x: 0, y: 0, z: -P.length / 2 });
  const lateral = ((bow.x + stern.x) / 2) - t.cx;
  const bowGap = bow.z - t.zFront;
  const near = Math.abs(lateral) < 6 && bow.z > t.zFront - 1 && bow.z < t.zRear + 15 && Math.abs(angleDeg) < 60 && f.z < 0;
  // apoiado: a quilha está a poucos cm do berço
  const sKeel = boat.pos.z - RAMP.z0;
  const ySupport = rampY(clamp(sKeel, t.sFront, t.sRear)) + t.clear;
  const keelY = boat.toWorld({ x: 0, y: Math.min(...P.contactPoints.map((p) => p.y)), z: 0 }).y;
  const onBunks = boat.pos.z > t.zFront && boat.pos.z < t.zRear && keelY - ySupport < 0.08 && Math.abs(lateral) < t.halfW;
  const speed = Math.hypot(boat.vel.x, boat.vel.z);
  const loaded = onBunks && bowGap < 0.35 && Math.abs(lateral) < 0.25 && Math.abs(angleDeg) < 6 && speed < 0.4 && !boat.capsized;
  return { near, lateral, angleDeg, bowGap, onBunks, loaded };
};

/**
 * Cinta do guincho: quando o barco encaixa, o piloto prende a cinta no olhal de proa. Ela só puxa
 * (não empurra): mola rígida e amortecida entre o olhal e o guincho, comprimento mínimo atual.
 * Solta no reset (R/T).
 */
export const attachWinch = (boat: Speedboat, t: TrailerLayout): void => {
  const P = boat.params;
  const bowLocal = P.contactPoints.reduce((a, b) => (b.z > a.z ? b : a));
  const eye = boat.toWorld(bowLocal);
  const len = Math.hypot(eye.x - t.winch.x, eye.y - t.winch.y, eye.z - t.winch.z);
  boat.winchStrap = { anchor: { ...t.winch }, local: { ...bowLocal }, length: Math.max(0.05, len) };
};
