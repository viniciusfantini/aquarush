// Aerodinâmica de asa com EFEITO SOLO (ekranoplano / WIG — "wing in ground effect").
// Sem Babylon: roda no Node para os testes.
//
// Cada superfície (meia-asa, estabilizador, deriva, costado da fuselagem) é uma "placa" com área, corda, envergadura,
// CLα, incidência e estol. A força vem do vento RELATIVO no ponto da placa (velocidade do ponto do corpo, ω×r incluído,
// menos o vento): sustentação perpendicular ao escoamento, arrasto ao longo dele. Assim o amortecimento de arfagem,
// rolagem e guinada SURGE da física (a cauda longe do CG "freia" a rotação), sem coeficientes de amortecimento à parte.
//
// Efeito solo (só nas placas marcadas `ground`): perto da água o ar fica preso entre a asa e a superfície ("colchão
// dinâmico") e os vórtices de ponta são achatados →
//   • sustentação × kL(h) = 1 + gL·exp(−h / (hs·corda))      (h = altura do bordo de fuga sobre a água)
//   • arrasto induzido × φ(h) = (16h/b)² / (1 + (16h/b)²)     (McCormick; b = envergadura total)
// Longe da água (h ≳ 1 corda) kL → 1 e φ → 1: a asa é uma asa comum, pequena e de alongamento baixo — o barco não
// tem sustentação nem potência para voar alto e volta a descer. É isso que limita a altura, não um teto artificial.
// Efeito solo dinâmico: aproximando-se da água (ḣ < 0) o ar preso é comprimido e a sustentação sobe; afastando-se,
// cai — é o que amortece a "golfinhada" (oscilação de altura) dos WIG reais.
// Cada meia-asa usa a SUA altura: a que desce ganha sustentação e levanta (estabilidade de rolagem perto da água).

import { type Vec3, v3, dot, scale, add, sub, len, cross } from "./math.ts";

export const RHO_AIR = 1.225;

export interface WingPanel {
  /** nome (telemetria/depuração) */
  name: string;
  /** centro aerodinâmico (¼ da corda), local do barco */
  pos: Vec3;
  /** normal da placa (local): (0,1,0) asa/estabilizador; (1,0,0) deriva */
  normal: Vec3;
  /** área (m²), corda média (m) e envergadura desta placa (m) */
  area: number;
  chord: number;
  span: number;
  /** inclinação da curva de sustentação (por rad) e incidência (rad) */
  cla: number;
  incidence: number;
  /** ângulo de estol (rad) — acima dele a sustentação cai para a de uma placa plana */
  stall: number;
  /** arrasto parasita */
  cd0: number;
  /** alongamento efetivo para o arrasto induzido (e de Oswald já incluído) */
  arEff: number;
  /** sofre efeito solo (asa baixa) */
  ground?: boolean;
  /** superfície de comando: quanto do comando (rad de deflexão) vira ângulo de ataque efetivo */
  control?: { kind: "elevator" | "rudder" | "aileron"; maxRad: number; tau: number; sign?: number };
}

export interface WingParams {
  panels: WingPanel[];
  /** efeito solo: ganho de sustentação na água e escala de altura (em cordas) */
  groundGain: number;
  groundScale: number;
  /** envergadura total (para o arrasto induzido em efeito solo) */
  span: number;
  /** flutuadores das pontas das asas (local): esfera com volume (m³) e raio (m) */
  floats: { pos: Vec3; volume: number; radius: number }[];
  /** efeito solo DINÂMICO: descendo em direção à água o ar preso é comprimido e sustenta mais (subindo, menos) —
   *  ΔCL = −dynGain·(ḣ/V)·(kL − 1). É o amortecimento vertical do colchão de ar (sem ele a altura "golfinha") */
  dynGain: number;
  /** nivelador de asas (LVL): ganho na inclinação (por rad) e na taxa de rolagem (por rad/s), autoridade máxima do
   *  aileron (0..1). Ausente = o avião não tem */
  leveler?: { kBank: number; kRate: number; max: number };
  /** comando do profundor: velocidade da roda de compensação (fração do curso por s) */
  elevatorRate: number;
  /** aviso de estol: ângulo de ataque da asa acima deste (rad) */
  stallWarn: number;
}

export interface PanelResult { force: Vec3; at: Vec3; alpha: number; cl: number; kGround: number; q: number }

/** sustentação 2D pela curva linear + estol suave para a placa plana (vale também com o vento por trás) */
export const liftCoef = (alpha: number, cla: number, stall: number): number => {
  const a = Math.abs(alpha);
  const s = Math.sign(alpha) || 1;
  if (a <= stall) return cla * alpha;
  const clMax = cla * stall;
  const flat = 1.05 * Math.sin(2 * a); // placa plana (máximo a 45°)
  const t = Math.min(1, (a - stall) / 0.2);
  return s * (clMax + (Math.max(flat, 0) * 0.85 - clMax) * t);
};

/** multiplicador da sustentação pelo efeito solo */
export const groundLift = (h: number, chord: number, gain: number, scaleC: number): number =>
  1 + gain * Math.exp(-Math.max(0.02, h) / (scaleC * chord));

/** fator do arrasto induzido pelo efeito solo (McCormick) */
export const groundInduced = (h: number, span: number): number => {
  const r = (16 * Math.max(0.02, h)) / span;
  return (r * r) / (1 + r * r);
};

/**
 * Força de uma placa (no referencial LOCAL do barco).
 * @param vAirLocal velocidade do AR em relação à placa, local (= −velocidade do ponto + vento)
 * @param h altura da placa sobre a água (m) — só usada se `ground`
 * @param cmd comando da superfície (−1..1), se ela tiver `control`
 * @param hDot velocidade vertical da placa em relação à água (m/s; > 0 = subindo)
 */
export const panelForce = (pn: WingPanel, W: WingParams, vAirLocal: Vec3, h: number, cmd: number, hDot = 0): PanelResult => {
  const n = pn.normal;
  // tira a componente ao longo da envergadura (não sustenta)
  const spanAxis = cross(n, v3(0, 0, 1));
  const sl = len(spanAxis);
  const sAx = sl > 1e-6 ? scale(spanAxis, 1 / sl) : v3(1, 0, 0);
  const va = sub(vAirLocal, scale(sAx, dot(vAirLocal, sAx)));
  const V = len(va);
  const zero: PanelResult = { force: v3(), at: pn.pos, alpha: 0, cl: 0, kGround: 1, q: 0 };
  if (V < 0.5) return zero;
  const vh = scale(va, 1 / V);
  // ângulo de ataque: ar vindo de baixo (va·n > 0) com o barco andando para a frente (ar indo para −Z)
  const alpha = Math.atan2(dot(va, n), -va.z) + pn.incidence;
  const a = Math.abs(alpha);
  const stalled = a > pn.stall ? Math.min(1, (a - pn.stall) / 0.25) : 0;
  // superfície de comando = mudança de CURVATURA (como um flap): soma ΔCL = CLα·τ·δ à curva da placa, em vez de mexer
  // no ângulo de ataque. Assim, com a asa perto/além do estol, o aileron continua comandando (perde ~40 % da eficácia)
  // em vez de inverter — mexendo no ângulo, o aileron que desce estolava a sua meia-asa e o barco inclinava ao contrário
  const dCl = pn.control ? pn.cla * pn.control.tau * (pn.control.sign ?? 1) * cmd * pn.control.maxRad * (1 - 0.4 * stalled) : 0;
  const kG = pn.ground ? groundLift(h, pn.chord, W.groundGain, W.groundScale) : 1;
  const phi = pn.ground ? groundInduced(h, W.span) : 1;
  const cl = (liftCoef(alpha, pn.cla, pn.stall) + dCl) * kG - (pn.ground ? W.dynGain * (hDot / V) * (kG - 1) : 0);
  const cd = pn.cd0 + (phi * cl * cl) / (Math.PI * pn.arEff) + 1.2 * stalled * Math.sin(a) ** 2;
  const q = 0.5 * RHO_AIR * V * V;
  // direção da sustentação: ⟂ ao escoamento, no plano (normal, escoamento)
  const lRaw = sub(n, scale(vh, dot(vh, n)));
  const ll = len(lRaw);
  const liftDir = ll > 1e-6 ? scale(lRaw, 1 / ll) : n;
  const force = add(scale(liftDir, q * pn.area * cl), scale(vh, q * pn.area * cd));
  return { force, at: pn.pos, alpha, cl, kGround: kG, q };
};
