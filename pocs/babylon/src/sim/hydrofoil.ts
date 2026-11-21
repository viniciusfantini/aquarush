// HYDROFOIL totalmente submerso (barco elétrico AR-E): asas sob a água ("foils") presas por struts verticais. Com
// velocidade, os foils sustentam o casco inteiro fora d'água — sem o atrito e as ondas do casco, gasta-se uma fração da
// energia. Sem Babylon: roda no Node para os testes.
//
// Configuração (como os barcos de passageiros elétricos com foils): DOIS foils dianteiros (bombordo e boreste, cada um
// no seu strut) com FLAPS, e um foil traseiro no strut do pod do motor (que também gira para dar a direção). O foil
// da frente leva ~70 % do peso e trabalha com CL maior que o de trás: assim o ponto neutro fica atrás do CG e o
// conjunto é estável em arfagem (como avião com canard).
//
// Foil totalmente submerso não tem estabilidade própria em altura nem em rolagem (a sustentação quase não muda com a
// profundidade): quem voa é o COMPUTADOR DE VOO (`fcsStep`). Um sensor de altura na proa mede a distância do casco à
// água; o computador mexe nos flaps da frente juntos (altura) e em sentidos opostos (rolagem: inclina para dentro
// da curva, curva coordenada φ = atan(V·r/g)), e no flap de trás (arfagem). Perto da superfície a sustentação cai
// (efeito de superfície livre) e, se o foil rompe a superfície, ele VENTILA (o ar desce pelo dorso e a sustentação
// some) — é o que limita a altura de voo.
//
// Recolher: struts e foils deslizam para cima nos poços do casco (os foils encaixam no fundo, sem sustentação) e o pod
// sobe para logo abaixo do fundo (ainda empurra: modo casco, para água rasa, atracar e a carretinha).

import { type Vec3, v3, add, scale, sub, dot, len } from "./math.ts";
import { liftCoef } from "./wing.ts";

const RHO = 1000;

export interface FoilSpec {
  name: string;
  /** centro (¼ da corda) com os foils BAIXADOS, local */
  pos: Vec3;
  span: number;
  chord: number;
  /** inclinação da curva de sustentação (por rad, 3D), incidência e estol (rad), arrasto parasita, alongamento efetivo */
  cla: number;
  incidence: number;
  stall: number;
  cd0: number;
  arEff: number;
  /** flap: deflexão máxima (rad) e eficácia (fração do CLα) */
  flapMax: number;
  flapTau: number;
  /** "front" = flaps de altura/rolagem; "rear" = flap de arfagem (no strut do pod) */
  role: "front" | "rear";
  /** −1 bombordo, +1 boreste, 0 centro */
  side: -1 | 0 | 1;
  /** strut: topo (y local, no casco), corda e espessura (m) */
  strutTopY: number;
  strutChord: number;
}

export interface HydrofoilParams {
  foils: FoilSpec[];
  /** quanto foils e struts sobem ao recolher (m) e quanto o pod sobe (m) */
  rise: number;
  podRise: number;
  /** tempo do curso completo (s) e velocidade máxima para mexer (m/s) */
  retractS: number;
  retractMaxSpeed: number;
  /** corrente na rede de 12 V: atuadores mexendo e o computador de voo + sensores ligados (A) */
  actuatorA: number;
  fcsA: number;
  /** altura de voo (quilha sobre a água, m): mínimo, máximo, padrão e passo do ajuste */
  ride: { min: number; max: number; def: number; step: number };
  /** sensor de altura (local) */
  sensor: Vec3;
  /** velocidade dos flaps (rad/s) */
  flapRate: number;
  /** ganhos do computador de voo */
  fcs: { kH: number; kHd: number; kHi: number; kP: number; kPr: number; kPi: number; kR: number; kRi: number; kRr: number; pitchDeg: number; maxBankDeg: number };
  /** arrasto do pod (Cd·A, m²) */
  podCdA: number;
}

export interface FoilResult { force: Vec3; at: Vec3; cl: number; alpha: number; vent: number; lift: number }

/**
 * Força de um foil (LOCAL do barco).
 * @param lr velocidade do ponto em relação à água (local)
 * @param depth profundidade do foil sob a superfície (m; < 0 = fora d'água)
 * @param flap deflexão do flap (rad; + = mais sustentação)
 */
export const foilForce = (f: FoilSpec, at: Vec3, lr: Vec3, depth: number, flap: number): FoilResult => {
  const zero: FoilResult = { force: v3(), at, cl: 0, alpha: 0, vent: 1, lift: 0 };
  if (depth < -0.05) return zero;
  // escoamento no plano do perfil (a componente ao longo da envergadura não sustenta)
  const va = v3(0, -lr.y, -lr.z);
  const V = Math.hypot(va.y, va.z);
  if (V < 0.3) return zero;
  const vh = scale(va, 1 / V);
  const alpha = Math.atan2(va.y, -va.z) + f.incidence;
  const a = Math.abs(alpha);
  const stalled = a > f.stall ? Math.min(1, (a - f.stall) / 0.25) : 0;
  // superfície livre: a sustentação cai perto da superfície; rompendo, ventila
  const kS = 1 - 0.5 * Math.exp((-2 * Math.max(0, depth)) / f.chord);
  const vent = 1 - smooth(-0.02, 0.06, depth);
  const kV = 1 - vent;
  const dCl = f.cla * f.flapTau * flap * (1 - 0.4 * stalled);
  const cl = (liftCoef(alpha, f.cla, f.stall) + dCl) * kS * kV;
  const cd = (f.cd0 + (cl * cl) / (Math.PI * f.arEff) + 1.2 * stalled * Math.sin(a) ** 2) * (0.15 + 0.85 * kV);
  const q = 0.5 * RHO * V * V, A = f.span * f.chord;
  const n = v3(0, 1, 0);
  const lRaw = sub(n, scale(vh, dot(vh, n)));
  const ll = len(lRaw);
  const liftDir = ll > 1e-6 ? scale(lRaw, 1 / ll) : n;
  const force = add(scale(liftDir, q * A * cl), scale(vh, q * A * cd));
  return { force, at, cl, alpha, vent, lift: q * A * cl };
};

/** Strut (placa vertical) com `imm` m dentro d'água: arrasto e força lateral (agarra como uma quilha). Local. */
export const strutForce = (chord: number, imm: number, lr: Vec3): Vec3 => {
  if (imm <= 0) return v3();
  const area = chord * imm;
  const V2 = lr.x * lr.x + lr.z * lr.z;
  if (V2 < 0.01) return v3();
  const q = 0.5 * RHO * V2;
  const beta = Math.atan2(lr.x, Math.abs(lr.z));
  const cs = 2.8 * clampN(beta, -0.2, 0.2) + 0.9 * Math.sin(beta) * Math.abs(Math.sin(beta)); // placa de alongamento baixo + arrasto cruzado
  return v3(-q * area * cs, 0, -0.5 * RHO * Math.abs(lr.z) * lr.z * area * 0.012);
};

const clampN = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (e0: number, e1: number, x: number) => { const t = clampN((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** estado do computador de voo (integrador e flaps atuais) */
export interface FcsState { integ: number; integP: number; integR: number; flapL: number; flapR: number; flapRear: number }

export interface FcsInput {
  /** altura medida (quilha sobre a água, m), velocidade vertical (m/s) e a altura pedida */
  h: number; hDot: number; target: number;
  /** arfagem (rad, + nariz para cima) e taxa (rad/s) */
  pitch: number; pitchRate: number;
  /** rolagem (rad, + boreste para baixo) e taxa (rad/s) */
  roll: number; rollRate: number;
  /** velocidade na água (m/s) e taxa de guinada (rad/s, + para boreste) */
  u: number; yawRate: number;
  /** foils baixados e computador ligado (READY) */
  active: boolean;
}

/** Um passo do computador de voo: flaps da frente (altura + rolagem) e de trás (arfagem). */
export const fcsStep = (s: FcsState, x: FcsInput, H: HydrofoilParams, flapMaxF: number, flapMaxR: number, dt: number): FcsState => {
  const G = H.fcs, rate = H.flapRate * dt;
  let cF = 0, dR = 0, rear = 0, integ = s.integ, integP = s.integP, integR = s.integR;
  if (x.active && x.u > 2) {
    const err = x.target - x.h;
    // altura: PID (o integrador só corre com o flap fora do batente — anti-windup — e já voando perto da altura)
    const pd = G.kH * err - G.kHd * x.hDot;
    const sat = Math.abs(pd + integ) >= flapMaxF * 0.98;
    if (!sat && Math.abs(err) < 0.35) integ = clampN(integ + G.kHi * err * dt, -flapMaxF * 0.6, flapMaxF * 0.6);
    cF = clampN(pd + integ, -flapMaxF, flapMaxF);
    // rolagem: curva coordenada (inclina para dentro), limitada; diferencial nos flaps da frente
    const maxB = (G.maxBankDeg * Math.PI) / 180;
    const bank = clampN(Math.atan2(x.u * x.yawRate, 9.81), -maxB, maxB);
    // (integrador: gente sentada de um lado só — sem ele o barco voava adernado ~2°)
    const rErr = bank - x.roll, rPd = G.kR * rErr - G.kRr * x.rollRate;
    if (Math.abs(rPd + integR) < flapMaxF * 0.9 && x.h > 0) integR = clampN(integR + G.kRi * rErr * dt, -flapMaxF * 0.4, flapMaxF * 0.4);
    dR = clampN(rPd + integR, -flapMaxF, flapMaxF);
    // arfagem: o flap de trás (mais sustentação atrás = nariz para baixo)
    // (com integrador: o CG muda com quem está a bordo e a velocidade — sem ele a arfagem ficava ~2° acima do alvo)
    const pErr = x.pitch - (G.pitchDeg * Math.PI) / 180;
    const pPd = G.kP * pErr + G.kPr * x.pitchRate;
    if (Math.abs(pPd + integP) < flapMaxR * 0.98 && x.h > 0) integP = clampN(integP + G.kPi * pErr * dt, -flapMaxR * 0.7, flapMaxR * 0.7);
    rear = clampN(pPd + integP, -flapMaxR, flapMaxR);
  } else { integ = 0; integP = 0; integR = 0; }
  const step = (cur: number, want: number) => cur + clampN(want - cur, -rate, rate);
  // dR > 0 = inclinar mais para boreste: mais sustentação a bombordo, menos a boreste
  return {
    integ, integP, integR,
    flapL: step(s.flapL, clampN(cF + dR, -flapMaxF, flapMaxF)),
    flapR: step(s.flapR, clampN(cF - dR, -flapMaxF, flapMaxF)),
    flapRear: step(s.flapRear, rear),
  };
};
