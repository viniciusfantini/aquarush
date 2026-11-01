// Parâmetros físicos documentados da lancha provisória da POC.
// Estes valores são o "contrato" entre as POCs (Babylon, Unity, Unreal):
// a mesma massa, dimensões, potência e coeficientes devem ser usados nas três.

import { type Vec3, v3, DEG } from "./math.ts";

export interface BuoyancyPoint {
  /** Posição local relativa ao centro de massa (m). X direita, Y cima, Z proa. */
  p: Vec3;
  /** Peso relativo da área de linha d'água representada pelo ponto. */
  areaWeight: number;
  /** Peso relativo da sustentação hidrodinâmica (superfície de planeio é mais à popa). */
  liftWeight: number;
  /** Incidência local do fundo (rad): a proa tem o "forefoot" curvado para cima. */
  incidence: number;
}

export interface SpeedboatParams {
  name: string;
  length: number;          // m
  beam: number;            // m (boca)
  mass: number;            // kg (casco + motor + piloto + combustível)
  inertia: Vec3;           // kg·m² (pitch X, yaw Y, roll Z) — eixos locais
  waterplaneArea: number;  // m² (área de flutuação total)
  pointMaxDepth: number;   // m (imersão máxima considerada por ponto)
  wetDepth: number;        // m (imersão para considerar o ponto "totalmente molhado")
  buoyancyPoints: BuoyancyPoint[];
  contactPoints: Vec3[];   // pontos de colisão (fundo, rochas, píer)

  // Motor / propulsão
  enginePowerHp: number;   // referência documental
  maxThrust: number;       // N (empuxo estático máximo, marcha à frente)
  reverseThrustFactor: number; // fração do empuxo em ré
  propPitchSpeed: number;  // m/s (velocidade em que o empuxo da hélice zera)
  propPos: Vec3;           // posição da hélice (local)
  engineResponse: number;  // s (constante de tempo do acelerador real)
  idleRpm: number;
  maxRpm: number;
  shiftTime: number;       // s (tempo em neutro ao trocar de marcha)
  idleThrustFraction: number; // fração do empuxo máx. em marcha lenta ENGRENADA (lancha anda devagar)

  // Direção
  maxSteerLow: number;     // rad (baixa velocidade)
  maxSteerHigh: number;    // rad (alta velocidade)
  steerRate: number;       // rad/s
  gearcaseRudder: number;  // m² * CL efetivo da rabeta como leme

  // Trim
  trimUp: number;          // rad (trim positivo máximo — eleva a proa)
  tiltMax: number;         // rad acima do fim do trim (recolher o motor: hélice sai da água)
  tiltRate: number;        // rad/s
  tiltMaxSpeed: number;    // m/s — acima disso o tilt é bloqueado (como nos motores reais)
  tiltMaxRpm: number;      // rpm — idem
  drivePivot: Vec3;        // pivô do trim/tilt no espelho de popa (local)
  intakePos: Vec3;         // entrada d'água de refrigeração (no pé do motor, local, motor sem trim)
  trimDown: number;        // rad (trim negativo máximo — baixa a proa)
  trimRate: number;        // unidades/s do comando [-1..1]
  driveLiftArea: number;   // m² * CL efetivo da rabeta como "flap" de trim

  // Hidrodinâmica
  planingLiftCoef: number; // CL por rad de ângulo de ataque do casco
  maxAoa: number;          // rad
  dragFrictionQuad: number;// N/(m/s)² — atrito longitudinal total com casco 100% molhado
  dragLinear: number;      // N/(m/s) — termo linear (baixa velocidade)
  lateralQuad: number;     // N/(m/s)² — resistência lateral total (quilha/costado)
  lateralLinear: number;   // N/(m/s)
  keelLift: number;        // N/(m/s)² — "agarre" lateral do casco (quilha/strakes) ∝ u·v_lateral
  yawDamping: number;      // N·m/(rad/s) — amortecimento hidrodinâmico de guinada
  heaveDamping: number;    // N/(m/s) por ponto (amortecimento vertical)
  waveDragPeakRatio: number;// resistência de ondas no "hump" como fração do peso
  sternTrough: number;     // m — cavado do sistema de ondas do próprio casco na popa (no hump)
  bowWave: number;         // m — onda de proa do próprio casco (no hump)
  bankCoef: number;        // N·m por m/s² de aceleração lateral — inclinação para dentro da curva (casco em V)
  rollDamping: number;     // N·m/(rad/s) — amortecimento hidrodinâmico de rolagem (casco molhado)
  airDragCdA: number;      // m²
}

const hl = 0.72; // meia-distância transversal dos pontos de flutuação

export const SPEEDBOAT: SpeedboatParams = {
  name: "Lancha provisória AR-6",
  length: 6.0,
  beam: 2.3,
  mass: 1200,
  inertia: v3(3700, 4100, 900),
  waterplaneArea: 10.0,
  pointMaxDepth: 0.85,
  wetDepth: 0.12,
  // 6 pontos: proa, centro e popa, bombordo e boreste (GDD A.3)
  buoyancyPoints: [
    { p: v3(-hl, -0.35, 2.5), areaWeight: 0.6, liftWeight: 0.8, incidence: 6 * DEG },
    { p: v3(hl, -0.35, 2.5), areaWeight: 0.6, liftWeight: 0.8, incidence: 6 * DEG },
    { p: v3(-hl, -0.35, 0.4), areaWeight: 1.1, liftWeight: 1.0, incidence: 3 * DEG },
    { p: v3(hl, -0.35, 0.4), areaWeight: 1.1, liftWeight: 1.0, incidence: 3 * DEG },
    { p: v3(-hl, -0.35, -1.7), areaWeight: 1.4, liftWeight: 0.2, incidence: 1.5 * DEG },
    { p: v3(hl, -0.35, -1.7), areaWeight: 1.4, liftWeight: 0.2, incidence: 1.5 * DEG },
  ],
  contactPoints: [
    v3(0, 0.25, 3.15),   // proa (bico)
    v3(0, -0.4, 2.2),
    v3(0, -0.45, 0),
    v3(0, -0.45, -2.6),
    v3(-1.1, 0.35, 1.2), v3(1.1, 0.35, 1.2),
    v3(-1.15, 0.35, -1.0), v3(1.15, 0.35, -1.0),
    v3(-1.1, 0.35, -2.85), v3(1.1, 0.35, -2.85),
    v3(-0.6, 0.35, 2.4), v3(0.6, 0.35, 2.4),
  ],

  enginePowerHp: 150,
  maxThrust: 8500,
  reverseThrustFactor: 0.35,
  propPitchSpeed: 32,
  propPos: v3(0, -0.75, -3.6),
  engineResponse: 0.3,
  idleRpm: 750,
  maxRpm: 5800,
  shiftTime: 0.45,
  idleThrustFraction: 0.04,

  maxSteerLow: 32 * DEG,
  maxSteerHigh: 11 * DEG,
  steerRate: 2.2,
  gearcaseRudder: 0.09,

  trimUp: 10 * DEG,
  tiltMax: 60 * DEG,
  tiltRate: 14 * DEG,
  tiltMaxSpeed: 2.5,
  tiltMaxRpm: 2200,
  drivePivot: v3(0, 0.28, -2.99),
  intakePos: v3(0, -0.62, -3.35),
  trimDown: -6 * DEG,
  trimRate: 0.6,
  driveLiftArea: 0.1,

  planingLiftCoef: 0.6,
  maxAoa: 14 * DEG,
  dragFrictionQuad: 13,
  dragLinear: 50,
  lateralQuad: 1100,
  lateralLinear: 900,
  keelLift: 1600,
  yawDamping: 18000,
  heaveDamping: 1700,
  waveDragPeakRatio: 0.15,
  sternTrough: 0.32,
  bowWave: 0.12,
  bankCoef: 2600,
  rollDamping: 9000,
  airDragCdA: 1.6,
};
