// Parâmetros físicos documentados da lancha provisória da POC.
// Estes valores são o "contrato" entre as POCs (Babylon, Unity, Unreal):
// a mesma massa, dimensões, potência e coeficientes devem ser usados nas três.

import { type Vec3, v3, DEG } from "./math.ts";

export type SeatId = "helm" | "passenger" | "rearLeft" | "rearRight";
export interface Occupant { seat: SeatId; mass: number }
export const PERSON_KG = 80;

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

export type VesselKind = "lancha" | "bote";

export interface SpeedboatParams {
  kind: VesselKind;
  name: string;
  /** "remote" = volante + manete no console; "tiller" = cana do leme no próprio motor (bote) */
  steering: "remote" | "tiller";
  /** "power" = power trim elétrico (bomba); "manual" = pino de trim em furos + tilt à mão */
  trimMode: "power" | "manual";
  /** ângulos do pino de trim manual (rad), do mais baixo ao mais alto */
  trimPins: number[];
  /** velocidade máxima na água (m/s) para mexer no pino/tilt manual (só com o barco parado) */
  manualTrimMaxSpeed: number;
  /** partida elétrica (chave + arranque + bateria) ou manual (corda) */
  electricStart: boolean;
  tankLiters: number;
  fuelIdleLph: number;     // consumo em marcha lenta (L/h)
  fuelMaxLph: number;      // consumo a toda (L/h)
  cylinders: 2 | 4;        // som do motor
  maxPeople: number;
  length: number;          // m
  beam: number;            // m (boca)
  mass: number;            // kg — massa SECA (casco + motor + equipamentos); combustível e ocupantes somam à parte
  fuelTankPos: Vec3;       // centro do tanque (local) — o peso da gasolina age aqui
  fuelDensity: number;     // kg/L
  seats: Record<SeatId, Vec3>; // centro de massa de uma pessoa sentada em cada banco (local)
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
  propRadius: number;      // m
  revLimitRpm: number;     // corte de giro (limitador)
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
  tiltMaxThrust: number;   // N — empuxo acima do qual o cilindro de tilt não vence a força da hélice
  tiltMaxSpeed: number;    // m/s — carga da água no pé em velocidade alta também impede
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
  kind: "lancha",
  name: "Lancha provisória AR-6",
  steering: "remote",
  trimMode: "power",
  trimPins: [],
  manualTrimMaxSpeed: 0,
  electricStart: true,
  tankLiters: 120,
  fuelIdleLph: 3,
  fuelMaxLph: 55,
  cylinders: 4,
  maxPeople: 4,
  length: 6.0,
  beam: 2.3,
  mass: 1030,
  fuelTankPos: v3(0, -0.22, -0.9),
  fuelDensity: 0.74,
  seats: {
    helm: v3(0.5, 0.42, -0.08),        // piloto (boreste)
    passenger: v3(-0.5, 0.42, -0.22),  // carona (bombordo)
    rearLeft: v3(-0.45, 0.4, -2.15),   // banco de popa
    rearRight: v3(0.45, 0.4, -2.15),
  },
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
  propRadius: 0.19,
  revLimitRpm: 6100,
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
  tiltMaxThrust: 1800,
  tiltMaxSpeed: 4.2, // ~15 km/h: acima, a água no pé também impede
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
  bankCoef: 1800,
  rollDamping: 15000,
  airDragCdA: 1.6,
};

// ---------------------------------------------------------------------------------------------
// Bote de apoio (inflável com fundo rígido, 3,1 m) — até 3 pessoas, motor de popa de 15 hp com
// cana do leme (direção e acelerador na mão), partida na corda, tanque portátil, SEM power trim:
// pino de trim com 3 furos + tilt manual, só com o bote parado.
// Valores de referência de botes reais de 3,0–3,2 m (casco ~70 kg, motor 15 hp 4T ~45 kg).
// Origem = CG do bote seco (casco + motor). X boreste, Y cima, Z proa.
// ---------------------------------------------------------------------------------------------
const dl = 0.5; // meia-distância transversal dos pontos (fundo rígido + flutuadores)

export const DINGHY: SpeedboatParams = {
  kind: "bote",
  name: "Bote de apoio AR-3",
  steering: "tiller",
  trimMode: "manual",
  trimPins: [-4 * DEG, 0, 4 * DEG],
  manualTrimMaxSpeed: 0.7, // ~2,5 km/h: na prática, parado
  electricStart: false,
  tankLiters: 10,  // tanque portátil (máx. 10 L)
  fuelIdleLph: 0.6,
  fuelMaxLph: 5.5,
  cylinders: 2,
  maxPeople: 3,
  length: 3.1,
  beam: 1.6,
  mass: 118,
  fuelTankPos: v3(-0.3, -0.02, -0.85),
  fuelDensity: 0.74,
  seats: {
    helm: v3(0.3, 0.32, -0.62),       // piloto: banco de popa, boreste (mão esquerda na cana do leme)
    passenger: v3(0, 0.32, 0.3),      // banco do meio
    rearLeft: v3(-0.3, 0.32, -0.62),  // banco de popa, bombordo
    rearRight: v3(0, 0.25, 0.95),     // (não usado: lotação máxima 3)
  },
  inertia: v3(95, 115, 30),
  waterplaneArea: 3.6,
  pointMaxDepth: 0.5,
  wetDepth: 0.06,
  buoyancyPoints: [
    { p: v3(-dl * 0.7, -0.17, 1.05), areaWeight: 0.7, liftWeight: 0.8, incidence: 7 * DEG },
    { p: v3(dl * 0.7, -0.17, 1.05), areaWeight: 0.7, liftWeight: 0.8, incidence: 7 * DEG },
    { p: v3(-dl, -0.17, 0.05), areaWeight: 1.1, liftWeight: 1.0, incidence: 3 * DEG },
    { p: v3(dl, -0.17, 0.05), areaWeight: 1.1, liftWeight: 1.0, incidence: 3 * DEG },
    { p: v3(-dl, -0.17, -0.95), areaWeight: 1.3, liftWeight: 0.25, incidence: 1.5 * DEG },
    { p: v3(dl, -0.17, -0.95), areaWeight: 1.3, liftWeight: 0.25, incidence: 1.5 * DEG },
  ],
  contactPoints: [
    v3(0, 0.2, 1.6), v3(0, -0.2, 0.9), v3(0, -0.22, 0), v3(0, -0.2, -1.1),
    v3(-0.8, 0.12, 0.6), v3(0.8, 0.12, 0.6), v3(-0.82, 0.12, -0.6), v3(0.82, 0.12, -0.6),
    v3(-0.7, 0.12, -1.5), v3(0.7, 0.12, -1.5),
  ],

  enginePowerHp: 15,
  maxThrust: 1200,
  reverseThrustFactor: 0.4,
  propPitchSpeed: 18,
  propPos: v3(0, -0.5, -1.55),
  propRadius: 0.12,
  revLimitRpm: 6100,
  engineResponse: 0.18,
  idleRpm: 1000,
  maxRpm: 5600,
  shiftTime: 0.3,
  idleThrustFraction: 0.06,

  maxSteerLow: 35 * DEG,  // cana do leme: o motor inteiro gira
  maxSteerHigh: 22 * DEG,
  steerRate: 3.0,
  gearcaseRudder: 0.03,

  trimUp: 4 * DEG,
  tiltMax: 70 * DEG,
  tiltRate: 50 * DEG,     // levantar à mão: ~1,5 s
  tiltMaxThrust: 0,
  tiltMaxSpeed: 0.7,
  tiltMaxRpm: 99999,
  drivePivot: v3(0, 0.33, -1.2),
  intakePos: v3(0, -0.4, -1.42),
  trimDown: -4 * DEG,
  trimRate: 5 * DEG,      // rad/s: o motor acomoda no furo novo em ~0,8 s (movido à mão)
  driveLiftArea: 0.025,

  planingLiftCoef: 0.6,
  maxAoa: 14 * DEG,
  dragFrictionQuad: 3.2,
  dragLinear: 14,
  lateralQuad: 260,
  lateralLinear: 220,
  keelLift: 330,
  yawDamping: 520,
  heaveDamping: 320,
  waveDragPeakRatio: 0.14,
  sternTrough: 0.15,
  bowWave: 0.06,
  bankCoef: 160,
  rollDamping: 450,
  airDragCdA: 0.9,
};

export const VESSELS: Record<VesselKind, SpeedboatParams> = { lancha: SPEEDBOAT, bote: DINGHY };
