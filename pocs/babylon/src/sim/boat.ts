// Simulation + Gameplay: corpo rígido da lancha e SpeedboatController.
// Tudo é feito com FORÇAS e TORQUES aplicados num corpo rígido 6DOF integrado
// em passo fixo (nada de Translate/teleporte). Independente da Babylon:
// roda no navegador e em Node (tests/sim.test.ts).

import {
  type Vec3, type Quat, v3, add, sub, scale, dot, cross, len, rotate, rotateInv, qMul, qNormalize,
  qFromAxisAngle, clamp, lerp, approach, addScaled, smoothstep,
} from "./math.ts";
import type { IWaterSurface } from "./water.ts";
import { G } from "./water.ts";
import { type PhysicsWorld, frameQuat } from "./world.ts";
import type { SpeedboatParams, Occupant, SeatId } from "./params.ts";
import { PERSON_KG } from "./params.ts";
import { ENGINE_SYSTEMS } from "./engineSystems.ts";
import { Turbine, type TurbinePhase } from "./turbine.ts";
import { type VehicleInput, emptyInput } from "../gameplay/vehicleInput.ts";

const NO_PILOT: VehicleInput = emptyInput();
import { EngineSystems } from "./engineSystems.ts";
import { AnchorGear, type AnchorState } from "./anchor.ts";

const RHO = 1000;     // água doce, kg/m³
/** Rotação máxima em neutro (a central do motor limita o giro sem carga na hélice). */
export const NEUTRAL_REV_LIMIT = 3000;
const RHO_AIR = 1.2;

export type Gear = "F" | "N" | "R";
export type EngineState = "off" | "cranking" | "running";

export interface BoatTelemetry {
  speedKmh: number;      // velocidade real sobre o fundo (plano horizontal)
  waterSpeed: number;    // m/s relativo à água, eixo longitudinal
  rpm: number;
  throttle: number;      // acelerador efetivo 0..1 (após resposta do motor)
  throttleCmd: number;   // comando recebido
  trim: number;          // -1..1
  trimDeg: number;
  tiltDeg: number;       // recolhimento além do trim (0 = motor na água)
  tiltBlocked: boolean;  // tentou recolher em velocidade/rotação alta
  intakeSubmerged: boolean; // entrada d'água de refrigeração dentro d'água
  steerDeg: number;
  gear: Gear;
  pitchDeg: number;      // + proa para cima
  rollDeg: number;       // + boreste para baixo
  wetFraction: number;   // 0..1 (média de imersão dos pontos)
  planing: boolean;
  thrustN: number;
  ventilation: number;   // 1 = hélice bem imersa
  cavitation: number;    // 0..1 — hélice sobrecarregada (alto escorregamento sob carga)
  propImmersion: number; // fração do disco da hélice dentro d'água (0 = no ar, 1 = submersa)
  revLimiter: boolean;   // limitador de giro cortando (hélice no ar acelerando)
  propSlip: number;      // escorregamento da hélice 0..1
  propRpm: number;       // rotação da hélice (motor / redução)
  fuelLph: number;       // consumo estimado (L/h)
  distanceM: number;
  collisions: number;
  capsized: boolean;     // barco virou (kill switch desliga o motor; ocupantes caem na água)
  hullDamage: number;    // avaria do casco 0..1 (impactos fortes)
  engineDamage: number;  // avaria do motor 0..1 (pé/hélice batendo no fundo, pedra ou carro)
  damageEvent: string;   // última avaria (texto para o aviso) — muda a cada nova avaria
  damageCount: number;   // contador de avarias (o HUD avisa quando muda)
  swimmers: number;      // pessoas na água
  lastImpact: number;    // N (intensidade do último impacto)
  engine: EngineState;   // motor desligado / dando partida / funcionando
  // instrumentos (sistemas do motor)
  fuelL: number;
  fuelFrac: number;
  coolantC: number;
  batteryV: number;
  engineHours: number;
  overheatWarn: boolean;
  protectMode: boolean;  // superaquecido: rotação limitada
  lowFuel: boolean;
  chargeWarn: boolean;
  stall: "" | "fuel" | "overheat" | "capsize" | "broken" | "sunk" | "flooded"; // último motivo de o motor ter morrido sozinho (flooded = afogado pelo afogador)
  buzzer: boolean;       // alarme do motor apitando (autoteste da chave)
  starterRpm: number;    // rotação do motor de arranque (0 = só o "clique" do solenoide)
  startFail: "" | "weak" | "dead" | "pull" | "fuel"; // última partida que não pegou (bateria fraca / sem força / corda / sem combustível)
  batterySoc: number;    // estado de carga 0..1
  trimPin: number;       // trim manual: furo do pino 1..N, N+1 = tilt total; 0 = power trim
  pullStart: boolean;    // partida na corda (sem arranque elétrico)
  trimMotorA: number;    // corrente da bomba do power trim (A)
  trimRelay: boolean;    // botão do trim apertado mas a bomba sem força (bateria zerada): só o relé estala
  jumper: boolean;       // booster de partida (jump start) ligado na bateria
  jumpCharge: number;    // carga do booster 0..1 (cheio ≈ 3 partidas)
  gpu: boolean;          // GPU da doca (fonte de solo de 28 V) conectada — só a lancha de turbina
  gpuState: "off" | "starting" | "online" | "stopping"; // diesel da GPU partindo/estabilizando ou energia chaveada
  gpuT: number;          // s desde que a GPU foi pedida (curva do som do diesel)
  gpuKw: number;         // potência que a GPU está fornecendo (kW)
  busBattery: boolean;   // relé da bateria fechado (chave BAT)
  busGen: boolean;       // o gerador está alimentando o barramento
  extPwr: boolean;       // GPU no barramento (cabo + diesel estável + relé EXT PWR fechado)
  extPwrClosed: boolean; // relé EXT PWR fechado (mesmo com a GPU ainda partindo)
  gpuA: number;          // corrente que a GPU entrega ao barramento (A reais) — o amperímetro do HUD é só o da bateria
  coolingLps: number;    // água de resfriamento do óleo saindo pelo espelho (turbina; bomba mecânica ∝ N1) — L/s
  /** painel de sistemas: registro do combustível, linha (0..1), bomba de porão, chave de baterias, afogador */
  fuelValveOpen: boolean; fuelLineFrac: number; bilgeMode: "auto" | "on" | "off"; batterySel: "off" | "ind" | "bb" | "be" | "both"; choke: boolean;
  batteryA: number;      // amperímetro: + carregando, − descarregando (A)
  bilgeL: number;        // água no porão (L)
  bilgeInflowLps: number; // entrada de água (L/s): furo no casco + água por cima da borda
  bilgePump: boolean;    // bomba de porão ligada
  bilgeFlowLps: number;  // vazão da bomba (L/s) — o jato pelo costado
  bilgeAlarm: boolean;   // alarme de porão (bomba acionada com água, ou água alta sem bomba)
  bilgeJetPos: Vec3;     // saída da bomba no costado (mundo)
  bilgeJetVel: Vec3;     // velocidade do jato ao sair (mundo, m/s)
  freeboard: number;     // borda livre: menor altura da borda/espelho acima da água (m)
  swamped: boolean;      // alagado: borda na linha d'água (inavegável)
  sunk: boolean;         // afundou (peso acima do empuxo máximo do casco)
  airPocketL: number;    // virado: bolsa de ar presa no casco (L)
  anchorOut: number;     // cabo da âncora lançado (m)
  anchorState: AnchorState;
  anchorDepth: number;   // profundidade da roldana ao fundo (m)
  anchorScope: number;   // filame (cabo ÷ profundidade)
  anchorTension: number; // tração no cabo (N)
  anchorRelay: boolean;  // molinete sem força: só o relé estala
  windlassA: number;     // corrente do molinete (A)
  apparentWind: number;  // vento aparente sobre o barco (m/s)
  neutralRev: boolean;   // acelerando em neutro (botão de aceleração em neutro segurado)
  depth: number;         // profundidade sob o casco
  draftHull: number;     // calado do casco (m abaixo da superfície no ponto mais fundo do fundo)
  draftMotor: number;    // calado com o motor (ponta do pé — o que bate primeiro no raso)
  submergedPoints: boolean[];
  // por motor (lancha rápida: [bombordo, boreste]; os demais têm um só)
  rpms: number[];
  gears: Gear[];
  throttles: number[];
  thrusts: number[];
  engines: EngineState[];
  propRpms: number[];
  /** turbina (lancha de turbina): N1/N2 %, EGT °C, torque %, óleo psi, fase da partida */
  turbine: { n1: number; n2: number; egt: number; torque: number; oilPsi: number; fuelLph: number; phase: TurbinePhase; starter: boolean; ignition: boolean; lit: boolean; egtWarn: boolean; hotStarts: number;
    /** modo e chaves do painel de partida; combustível acumulado sem queimar (L); desgaste por sobretemperatura */
    fadec: boolean; master: boolean; boostPump: boolean; fuelValve: boolean; pooledL: number; wear: number;
    generator: boolean; starterLock: number; seized: boolean;
    /** temperatura do óleo (°C) e os alarmes: quente (luz + som) e acima do limite (mancais se desgastando) */
    oilC: number; oilHot: boolean; oilRed: boolean;
    /** barramento energizado: sem ele os instrumentos, luzes e velas ficam apagados */
    powered: boolean;
    /** posição das chaves (o starter/ignição acima são "funcionando": chave E energia) */
    starterSw: boolean; ignitionSw: boolean } | null;
  /** por motor/banco (AR-9: cada V8 tem arrefecimento e banco de bateria próprios) */
  coolants: number[];
  batteryVs: number[];
  batterySocs: number[];
  batteryAs: number[];
  /** tensão nominal do sistema elétrico (12 V; turbina: 24 V). batteryV/batteryA já vêm em volts/ampères reais */
  nominalV: number;
}

/**
 * Pessoa na água (caiu quando o barco virou). Boia com o colete salva-vidas: o colete segura o
 * peito na linha d'água (postura "HELP", pernas encolhidas), o arrasto da água freia o corpo e a
 * correnteza/ondas o carregam. Modelo de 1 ponto (posição = centro do colete).
 */
export interface Swimmer {
  seat: SeatId; mass: number; pos: Vec3; vel: Vec3; yaw: number;
  /** posição em volta do barco para onde a pessoa nada (ângulo no plano do barco, 0 = proa) */
  slot: number;
  /** esforço de nado 0..1 (animação das braçadas) */
  swim: number;
  /** tempo na água (s): primeiro se recupera do tombo, depois nada */
  t: number;
}

export interface ForceDebug { p: Vec3; f: Vec3; kind: "buoy" | "lift" | "thrust" | "contact" }

/**
 * Estado de UM motor + rabeta/pé (lancha, bote e lancha de turbina têm um — na turbina, `turb`; a lancha rápida, dois). Rotação, marcha, acelerador,
 * partida e hélice são por motor; o empuxo de cada um age na posição da sua rabeta (deslocada em X) — daí o
 * empuxo diferencial (um em frente e o outro em ré giram o barco no lugar).
 */
export class EngineUnit {
  readonly index: number;
  readonly offsetX: number;
  throttleActual = 0; neutralRev = false; gear: Gear = "N"; shiftTimer = 0; wantGear: Gear = "N"; rpm = 750;
  engine: EngineState = "running"; crankTimer = 0; crankRevs = 0; crankNeed = 4; crankWait = 0;
  cavitation = 0; propRpmState = 0; immersion = 1; revLimiting = false; limiterPhase = 0; lastThrust = 0; pullCatch = false;
  // última passada da física (telemetria / efeitos)
  axial = 0; ventilation = 1; slip = 0; propW: Vec3 = v3(); intakeSubmerged = true; fuelLph = 0;
  /** turbina a gás (lancha de turbina); null = motor a pistão */
  turb: Turbine | null = null;
  /** carga da hélice para a turbina livre (1 = absorve o torque nominal a 100 % N2) */
  propLoad = 0.12;
  constructor(index: number, offsetX: number) { this.index = index; this.offsetX = offsetX; }
}

export class Speedboat {
  readonly params: SpeedboatParams;
  /** motores (1 ou 2). O código de motor/hélice opera no motor corrente `u`; fora dos laços por motor as
   *  leituras de `engine` agregam (ligado = algum ligado) e as escritas de `engine`/`gear` valem para todos. */
  readonly units: EngineUnit[];
  private u!: EngineUnit;
  private inUnit = false;
  private eachUnit(f: (un: EngineUnit) => void): void {
    const prev = this.inUnit, prevU = this.u;
    this.inUnit = true;
    for (const un of this.units) { this.u = un; f(un); }
    this.u = prevU ?? this.units[0]; this.inUnit = prev;
  }
  get engine(): EngineState {
    if (this.inUnit || this.units.length === 1) return this.u.engine;
    return this.units.some((x) => x.engine === "running") ? "running" : this.units.some((x) => x.engine === "cranking") ? "cranking" : "off";
  }
  set engine(v: EngineState) {
    const apply = (x: EngineUnit) => {
      x.engine = v;
      // turbina: "desligar" = corta o combustível (spool-down); "ligar" (testes) = marcha lenta
      if (x.turb) { if (v === "off" && x.turb.phase !== "off") x.turb.cutFuel(); else if (v === "running") x.turb.idle(); }
    };
    if (this.inUnit) apply(this.u); else for (const x of this.units) apply(x);
  }
  /** Corrente dos periféricos da turbina (bomba, velas, solenoide, FADEC) no barramento — entra no amperímetro. */
  private turbinePeripheralA(): number { return this.units.reduce((a, x) => a + (x.turb?.peripheralA ?? 0), 0); }
  /** Turbinas paradas e frias (reposicionar no píer); os motores a pistão só desligam. */
  coldEngines(): void { for (const x of this.units) { x.engine = "off"; x.rpm = 0; x.turb?.cold(); } }
  get gear(): Gear { return this.u.gear; }
  set gear(v: Gear) { if (this.inUnit) this.u.gear = v; else for (const x of this.units) x.gear = v; }
  private get wantGear(): Gear { return this.u.wantGear; }
  private set wantGear(v: Gear) { if (this.inUnit) this.u.wantGear = v; else for (const x of this.units) x.wantGear = v; }
  private get throttleActual() { return this.u.throttleActual; } private set throttleActual(v: number) { this.u.throttleActual = v; }
  private get neutralRev() { return this.u.neutralRev; } private set neutralRev(v: boolean) { this.u.neutralRev = v; }
  private get shiftTimer() { return this.u.shiftTimer; } private set shiftTimer(v: number) { if (this.inUnit) this.u.shiftTimer = v; else for (const x of this.units) x.shiftTimer = v; }
  private get rpm() { return this.u.rpm; } private set rpm(v: number) { if (this.inUnit) this.u.rpm = v; else for (const x of this.units) x.rpm = v; }
  private get crankTimer() { return this.u.crankTimer; } private set crankTimer(v: number) { if (this.inUnit) this.u.crankTimer = v; else for (const x of this.units) x.crankTimer = v; }
  private get crankRevs() { return this.u.crankRevs; } private set crankRevs(v: number) { this.u.crankRevs = v; }
  private get crankNeed() { return this.u.crankNeed; } private set crankNeed(v: number) { this.u.crankNeed = v; }
  private get cavitation() { return this.u.cavitation; } private set cavitation(v: number) { this.u.cavitation = v; }
  private get propRpmState() { return this.u.propRpmState; } private set propRpmState(v: number) { this.u.propRpmState = v; }
  private get immersion() { return this.u.immersion; } private set immersion(v: number) { this.u.immersion = v; }
  private get revLimiting() { return this.u.revLimiting; } private set revLimiting(v: boolean) { this.u.revLimiting = v; }
  private get limiterPhase() { return this.u.limiterPhase; } private set limiterPhase(v: number) { this.u.limiterPhase = v; }
  private get lastThrust() { return this.u.lastThrust; } private set lastThrust(v: number) { this.u.lastThrust = v; }
  private get pullCatch() { return this.u.pullCatch; } private set pullCatch(v: boolean) { this.u.pullCatch = v; }
  // estado do corpo rígido (mundo)
  pos: Vec3;
  vel: Vec3 = v3();
  rot: Quat;
  angVel: Vec3 = v3();

  // estado dos atuadores
  private steer = 0;           // rad
  trim = 0;                    // -1..1
  /** autoteste ao ligar a chave: o alarme apita (~1 s) antes do arranque girar */
  private selfTestT = 0;
  private lastContact = false;
  /** apoiado no berço da carretinha neste passo */
  onSupport = false;
  /** força normal máxima de contato neste passo (N) — usada para avarias */
  impactN = 0;
  /** avarias (0..1). Casco: impactos acima de ~4× o peso. Motor: pé batendo no fundo/pedra/carro em movimento. */
  hullDamage = 0;
  engineDamage = 0;
  private hullEpisode = 0;      // avaria já aplicada no impacto atual (um impacto = um episódio de contato)
  private engineHitting = false;
  private obstacleInside = false;
  /** cinta do guincho presa ao olhal de proa (carretinha) — só traciona */
  winchStrap: { anchor: Vec3; local: Vec3; length: number } | null = null;
  /** cabos de amarração (vaga do píer: proa e popa; poita: proa) */
  mooringLines: { anchor: Vec3; local: Vec3; length: number }[] = [];
  /** forças externas (mundo) para o próximo passo — ex.: reação da boia da poita empurrada pelo casco */
  externalForces: { p: Vec3; f: Vec3 }[] = [];
  /** âncora de proa + guincho */
  readonly anchor: AnchorGear;
  /** água no porão (L) — pesa no barco (carga em params.bilge.pos) */
  bilgeL = 0;
  private bilgeAuto = false;
  /** chave da bomba de porão: AUTO (boia), ON (manual, mesmo seca) ou OFF */
  bilgeMode: "auto" | "on" | "off" = "auto";
  /**
   * Chave geral de baterias. Um banco: "off" ou "ind" (ligada). Dois bancos (AR-9): "ind" (cada motor no seu banco,
   * a casa no de bombordo — o normal), "bb" ou "be" (um banco alimenta os dois motores e a casa; o outro fica
   * isolado), "both" (os dois em paralelo) e "off".
   */
  batterySel: "off" | "ind" | "bb" | "be" | "both" = "ind";
  /** afogador (motor carburado) puxado */
  choke = false;
  private chokeRichT = 0;
  private bilgePumpA = 0;
  /** entrada pelo furo (L/s, negativo = escoando) e por cima da borda (L/s) no último passo */
  bilgeHole = 0; bilgeOver = 0; bilgeScoop = 0;
  /** água que sobe contra o espelho andando de ré (m) */
  private transomPile = 0;
  /** bolsa de ar presa no casco virado (L); −1 = não virado */
  airL = -1;
  /** onde o barco afundou: as pessoas se juntam ali */
  private sinkSpot: Vec3 | null = null;
  /** afundou: o peso (com a água de dentro) passou do empuxo máximo do casco */
  sunk = false;
  /** corrente da bomba elétrica do power trim (A) */
  trimMotorA = 0;
  /** combustível, arrefecimento, bateria e horímetro */
  readonly systems: EngineSystems;
  /**
   * 2º motor (AR-9): banco de bateria, alternador, arrefecimento e horímetro PRÓPRIOS. O tanque é o mesmo
   * (o combustível é sincronizado com `systems`). O banco 1 (`systems`) também alimenta a casa: luzes, trim,
   * molinete e bomba de porão; o jump start liga nele.
   */
  readonly systems2: EngineSystems | null;
  /** Bancos/sistemas por motor ([0] = bombordo + casa, [1] = boreste). */
  get banks(): EngineSystems[] { return this.systems2 ? [this.systems, this.systems2] : [this.systems]; }
  /** sistemas do motor da unidade corrente (dentro de `eachUnit`) */
  private get usys(): EngineSystems { return this.u.index > 0 && this.systems2 ? this.systems2 : this.systems; }
  /** banco que ALIMENTA eletricamente o motor corrente (a chave de baterias pode pôr os dois num banco só) */
  private get uelec(): EngineSystems { return this.bankFor(this.u.index); }
  private bankFor(i: number): EngineSystems {
    if (!this.systems2) return this.systems;
    return this.batterySel === "bb" ? this.systems : this.batterySel === "be" ? this.systems2 : i > 0 ? this.systems2 : this.systems;
  }
  /** trim manual (bote): furo atual do pino, ângulo atual (anima até o furo) e tilt pedido */
  trimPin = 1;
  private manualAngle = 0;
  private tiltWanted = false;
  private prevTrimIn = 0;
  /** tempo restante do aviso "pare o bote para mexer no motor" */
  private manualBlockT = 0;
  /** Pessoas que caíram na água (barco virado). */
  swimmers: Swimmer[] = [];
  /** barco virado: ocupantes ejetados, motor desligado pelo corta-circuito (kill switch) */
  capsized = false;
  private capsizeT = 0;
  /** Ocupantes (posição = banco). Padrão: só o piloto. */
  occupants: Occupant[] = [{ seat: "helm", mass: PERSON_KG }];
  totalMass = 0;
  private inertia: Vec3 = v3();
  private loads: { mass: number; pos: Vec3 }[] = [];

  /** Recalcula cargas, massa total e inércia (eixos do casco, teorema dos eixos paralelos). */
  private updateMassProperties(): void {
    const P = this.params;
    this.loads = [{ mass: this.systems.fuelL * P.fuelDensity, pos: P.fuelTankPos }];
    if (this.bilgeL > 0) this.loads.push({ mass: this.bilgeL, pos: this.bilgeLoadPos() }); // água doce: 1 kg/L
    for (const o of this.occupants) this.loads.push({ mass: o.mass, pos: P.seats[o.seat] });
    let m = P.mass, ix = P.inertia.x, iy = P.inertia.y, iz = P.inertia.z;
    for (const L of this.loads) {
      m += L.mass;
      ix += L.mass * (L.pos.y * L.pos.y + L.pos.z * L.pos.z);
      iy += L.mass * (L.pos.x * L.pos.x + L.pos.z * L.pos.z);
      iz += L.mass * (L.pos.x * L.pos.x + L.pos.y * L.pos.y);
    }
    this.totalMass = m;
    this.inertia = v3(ix, iy, iz);
  }

  /** Centro de massa combinado (local) — para telemetria/HUD. */
  get cgLocal(): Vec3 {
    let m = this.params.mass, x = 0, y = 0, z = 0;
    for (const L of this.loads) { m += L.mass; x += L.mass * L.pos.x; y += L.mass * L.pos.y; z += L.mass * L.pos.z; }
    return v3(x / m, y / m, z / m);
  }
  /** posição atual da hélice no mundo (gira com trim/tilt) */
  propWorld: Vec3 = v3();
  /** recolhimento (rad) além do fim do trim */
  tilt = 0;
  private tiltBlocked = false;

  telemetry: BoatTelemetry;
  debugForces: ForceDebug[] = [];
  debugEnabled = false;

  // acumuladores
  private F: Vec3 = v3();
  private T: Vec3 = v3();

  constructor(params: SpeedboatParams, pos: Vec3, headingRad = 0) {
    this.params = params;
    this.units = (params.engines ?? [{ x: 0 }]).map((e, i) => new EngineUnit(i, e.x));
    if (params.turbine) for (const x of this.units) { x.turb = new Turbine(params.turbine); x.rpm = params.idleRpm; }
    this.u = this.units[0];
    this.anchor = new AnchorGear(params.anchor);
    this.systems = new EngineSystems({ ...ENGINE_SYSTEMS, ...params.systems, tankLiters: params.tankLiters, hasBattery: params.electricStart });
    this.systems2 = this.units.length > 1 ? new EngineSystems(this.systems.p) : null;
    this.trimPin = Math.max(0, Math.min(1, params.trimPins.length - 1));
    this.manualAngle = params.trimPins[this.trimPin] ?? 0;
    this.pos = { ...pos };
    this.rot = qFromAxisAngle(v3(0, 1, 0), headingRad);
    this.rpm = params.idleRpm;
    this.telemetry = {
      speedKmh: 0, waterSpeed: 0, rpm: params.idleRpm, throttle: 0, throttleCmd: 0, trim: 0, trimDeg: 0, tiltDeg: 0, tiltBlocked: false, intakeSubmerged: true, steerDeg: 0,
      gear: "N", pitchDeg: 0, rollDeg: 0, wetFraction: 0, planing: false, thrustN: 0, ventilation: 1, cavitation: 0, propImmersion: 1, revLimiter: false, propSlip: 0, propRpm: 0, engine: "running", fuelL: 0, fuelFrac: 1, coolantC: 45, batteryV: 12.6, engineHours: 0, overheatWarn: false, protectMode: false, lowFuel: false, chargeWarn: false, stall: "", trimMotorA: 0, trimRelay: false, jumper: false, jumpCharge: 1, batteryA: 0, bilgeL: 0, bilgeInflowLps: 0, bilgePump: false, bilgeFlowLps: 0, bilgeAlarm: false, bilgeJetPos: v3(), bilgeJetVel: v3(), freeboard: 1, swamped: false, sunk: false, airPocketL: 0,
      anchorOut: 0, anchorState: "recolhida", anchorDepth: 0, anchorScope: 0, anchorTension: 0, anchorRelay: false, windlassA: 0, apparentWind: 0, neutralRev: false, fuelLph: 0, buzzer: false, starterRpm: 0, startFail: "", batterySoc: 0.92, trimPin: 0, pullStart: !params.electricStart,
      distanceM: 0, collisions: 0, draftHull: 0, draftMotor: 0, capsized: false, swimmers: 0, hullDamage: 0, engineDamage: 0, damageEvent: "", damageCount: 0, lastImpact: 0, depth: 0, submergedPoints: params.buoyancyPoints.map(() => false),
      rpms: [params.idleRpm], gears: ["N"], throttles: [0], thrusts: [0], engines: ["running"], propRpms: [0], coolants: [45], batteryVs: [12.6], batterySocs: [0.92], batteryAs: [0], turbine: null, nominalV: 12, gpu: false, gpuState: "off", gpuT: 0, gpuKw: 0, busBattery: true, busGen: false, extPwr: false, extPwrClosed: false, gpuA: 0, coolingLps: 0, fuelValveOpen: true, fuelLineFrac: 1, bilgeMode: "auto", batterySel: "ind", choke: false,
    };
  }

  /** Reposiciona (usado só no reset/spawn — fora da simulação normal). */
  reset(pos: Vec3, headingRad: number): void {
    this.pos = { ...pos };
    this.vel = v3();
    this.angVel = v3();
    this.rot = qFromAxisAngle(v3(0, 1, 0), headingRad);
    for (const un of this.units) { un.throttleActual = 0; un.cavitation = 0; un.propRpmState = 0; un.crankWait = 0; }
    this.steer = 0;
    this.trim = 0;
    this.tilt = 0;
    this.tiltWanted = false;
    this.capsized = false; this.capsizeT = 0; this.swimmers = []; this.winchStrap = null; this.mooringLines = [];
    this.anchor.reset(); this.bilgeL = 0; this.bilgeAuto = false; this.bilgePumpA = 0; this.sunk = false; this.airL = -1; this.sinkSpot = null; this.sloshDeck = v3(); this.sloshUnder = v3();
    this.trimPin = Math.max(0, Math.min(1, this.params.trimPins.length - 1));
    this.manualAngle = this.params.trimPins[this.trimPin] ?? 0;
    this.gear = this.wantGear = "N";
    this.shiftTimer = 0;
  }

  get forward(): Vec3 { return rotate(this.rot, v3(0, 0, 1)); }
  get up(): Vec3 { return rotate(this.rot, v3(0, 1, 0)); }
  get right(): Vec3 { return rotate(this.rot, v3(1, 0, 0)); }

  toWorld(local: Vec3): Vec3 { return add(this.pos, rotate(this.rot, local)); }

  /** Velocidade de um ponto do corpo (mundo). */
  pointVelocity(worldP: Vec3): Vec3 { return add(this.vel, cross(this.angVel, sub(worldP, this.pos))); }

  private addForceAt(f: Vec3, worldP: Vec3, kind: ForceDebug["kind"]): void {
    this.F = add(this.F, f);
    this.T = add(this.T, cross(sub(worldP, this.pos), f));
    if (this.debugEnabled) this.debugForces.push({ p: worldP, f, kind });
  }

  step(dt: number, input: VehicleInput, water: IWaterSurface, world: PhysicsWorld): void {
    const P = this.params;
    this.F = v3();
    this.T = v3();
    if (this.debugEnabled) this.debugForces = [];
    for (const ef of this.externalForces) this.addForceAt(ef.f, ef.p, "contact");
    this.externalForces = [];

    const fwd = this.forward, up = this.up, right = this.right;
    const pitch = Math.asin(clamp(fwd.y, -1, 1));
    const roll = -Math.asin(clamp(right.y, -1, 1));

    // Velocidade relativa à água (no centro), em eixos locais
    const curC = water.getCurrent(this.pos.x, this.pos.z);
    const relC = rotateInv(this.rot, sub(this.vel, curC));
    const u = relC.z; // velocidade longitudinal na água

    // ---------------- atuadores ----------------
    // sem ninguém no posto de pilotagem (caiu na água), os comandos não fazem nada: volante/cana soltos,
    // acelerador na lenta, trim parado (a marcha fica onde estava)
    if (!this.occupants.some((o) => o.seat === "helm")) input = { ...NO_PILOT, gear: this.wantGear };
    const driveBefore = this.driveSnapshot();
    this.updateControls(dt, input, u);
    this.limitDriveOnGround(dt, world, driveBefore, input.trim);

    // ---------------- gravidade ----------------
    // massa variável: casco seco no CG de referência + gasolina no tanque + ocupantes nos bancos.
    // Cada peso age NA SUA POSIÇÃO (gera torque → trim/banda); massa total e inércia (Steiner) atualizadas.
    this.updateMassProperties();
    this.F = add(this.F, v3(0, -P.mass * G, 0));
    for (const L of this.loads) this.addForceAt(v3(0, -L.mass * G, 0), this.toWorld(L.pos), "buoy");

    // Sistema de ondas do próprio casco (Kelvin): no "hump" (Froude ~0.5) a proa sobe numa
    // onda e a popa fica num cavado -> a proa empina antes do planeio. Some ao planar.
    const W = this.totalMass * G;
    const fn = Math.abs(u) / Math.sqrt(G * P.length); // número de Froude
    const hump = fn < 0.5 ? (fn / 0.5) ** 2 : Math.exp(-(fn - 0.5) * 0.5);
    const selfWave = hump * clamp(1 - (fn - 0.5) * 0.6, 0, 1);

    // ---------------- flutuação + hidrodinâmica por ponto ----------------
    const areaSum = P.buoyancyPoints.reduce((s, b) => s + b.areaWeight, 0);
    let wetSum = 0;
    let keelWet = 0;
    const subm = this.telemetry.submergedPoints;
    for (let i = 0; i < P.buoyancyPoints.length; i++) {
      const bp = P.buoyancyPoints[i];
      const wp = this.toWorld(bp.p);
      const zN = bp.p.z / (P.length * 0.35);
      const own = selfWave * (zN > 0 ? P.bowWave * zN : P.sternTrough * zN);
      const h = water.getHeight(wp.x, wp.z) + own;
      const depth = h - wp.y;
      subm[i] = depth > 0;
      if (depth <= 0) continue;
      const A = (P.waterplaneArea * bp.areaWeight) / areaSum;
      const share = bp.areaWeight / areaSum;
      const d = Math.min(depth, P.pointMaxDepth);
      const wet = clamp(depth / P.wetDepth, 0, 1);
      wetSum += wet * share;

      const vp = this.pointVelocity(wp);
      const cur = water.getCurrent(wp.x, wp.z);
      const rel = sub(vp, cur);
      const lr = rotateInv(this.rot, rel);

      // empuxo hidrostático (Arquimedes) + amortecimento vertical
      let fy = RHO * G * A * d - P.heaveDamping * wet * rel.y;
      const fBuoy = v3(0, fy, 0);

      // arrasto longitudinal (atrito do casco molhado) e lateral (quilha/costado) — em eixos locais
      const fLon = -(P.dragLinear * lr.z + P.dragFrictionQuad * (1 + 1.5 * this.hullDamage) * Math.abs(lr.z) * lr.z) * wet * share; // casco avariado arrasta mais
      // lateral: arrasto do costado + sustentação da quilha/strakes (∝ u·v_lat, como um perfil):
      // em velocidade o casco "agarra" e quase não derrapa nas curvas
      const fLat = -(P.lateralLinear * lr.x + P.lateralQuad * Math.abs(lr.x) * lr.x) * wet * share;
      keelWet += wet * share;

      // sustentação de planeio: placa com ângulo de ataque local (normal do fundo do casco)
      let fLift = 0;
      if (lr.z > 0.5) {
        const aoa = clamp(Math.atan2(-lr.y, lr.z) + bp.incidence, 0, P.maxAoa);
        // a área de planeio cresce com a imersão (casco em V): o lado mais afundado sustenta mais -> estabilidade em rolagem
        const liftWet = clamp(depth / P.wetDepth, 0, 3);
        fLift = 0.5 * RHO * lr.z * lr.z * A * P.planingLiftCoef * aoa * liftWet * bp.liftWeight;
      }
      // a pressão age na normal do fundo local (inclinada para trás pela incidência) -> arrasto induzido
      const fLocal = rotate(this.rot, v3(fLat, fLift * Math.cos(bp.incidence), fLon - fLift * Math.sin(bp.incidence)));
      this.addForceAt(fBuoy, wp, "buoy");
      this.addForceAt(fLocal, wp, "lift");
      fy = 0;
    }
    const wetFraction = clamp(wetSum, 0, 1);

    // Sustentação lateral da quilha/strakes (∝ u·v_lateral, como um perfil): aplicada no centro de
    // resistência lateral (≈ sob o CG em planeio) → o casco "agarra" e quase não derrapa, sem o
    // efeito cata-vento que fazia a lancha voltar para o lado oposto ao soltar o volante.
    if (keelWet > 0 && u > 0) {
      const fk = -P.keelLift * u * relC.x * clamp(keelWet, 0, 1);
      this.addForceAt(scale(right, fk), this.toWorld(v3(0, -0.15, 0.1)), "lift");
    }

    // ---------------- resistência de ondas (hump) ----------------
    if (wetFraction > 0) {
      const waveDrag = -Math.sign(u) * W * P.waveDragPeakRatio * hump * wetFraction * wetFraction;
      this.addForceAt(scale(fwd, waveDrag), this.toWorld(v3(0, -0.35, 0)), "lift");
    }

    // ---------------- propulsão (motor de popa / rabeta) ----------------
    const trimAngle = P.trimMode === "manual" ? this.manualAngle : this.trim >= 0 ? this.trim * P.trimUp : -this.trim * P.trimDown;
    // ângulo total da rabeta = trim + tilt; a hélice gira em torno do pivô no espelho de popa
    const driveAngle = trimAngle + this.tilt;
    // Ordem real do suporte do motor: o TILT gira em torno do tubo horizontal no espelho (externo) e a
    // DIREÇÃO gira em torno do eixo do próprio motor (interno), que inclina junto. Com o motor recolhido,
    // esterçar gira o motor em torno do próprio eixo, sem varrer o pé para os lados.
    const tiltRot = qFromAxisAngle(v3(1, 0, 0), driveAngle);
    const driveRot = qMul(tiltRot, qFromAxisAngle(v3(0, 1, 0), -this.steer));
    // posição da hélice/entrada: só o tilt (o deslocamento lateral de ~0,1 m ao esterçar é desprezado:
    // o eixo de direção real fica logo à frente do pé)
    this.eachUnit(() => {
      const off = v3(this.u.offsetX, 0, 0); // rabeta deste motor (deslocada em X)
      const propW = this.toWorld(add(add(P.drivePivot, off), rotate(tiltRot, sub(P.propPos, P.drivePivot))));
      const intakeW = this.toWorld(add(add(P.drivePivot, off), rotate(tiltRot, sub(P.intakePos, P.drivePivot))));
      const intakeSubmerged = water.getHeight(intakeW.x, intakeW.z) - intakeW.y > 0.02;
      if (this.u.index === 0) this.propWorld = propW;
      this.u.propW = propW;
      const propDepth = water.getHeight(propW.x, propW.z) - propW.y;
      // Hélice x superfície:
      //  • imersão = fração do disco dentro d'água (R = raio): o empuxo cai com a área molhada;
      //  • aeração (ventilação) = ar puxado da superfície quando o disco está raso → perde mais empuxo;
      //  • fora d'água: sem carga — o motor dispara até o limitador de giro.
      const R = P.propRadius;
      const immersion = clamp((propDepth + R) / (2 * R), 0, 1);
      const aeration = immersion * (1 - smoothstep(R, R + 0.3, propDepth));
      const ventilation = 1 - aeration; // 1 = hélice limpa (telemetria/efeitos)
      this.immersion = immersion;
      // Direção do empuxo: esterçar à direita gira a rabeta e empurra a popa para a esquerda.
      // Trim positivo inclina o empuxo para baixo (eleva a proa); negativo, para cima.
      const tDirLocal = rotate(driveRot, v3(0, 0, 1)); // = (−sen δ, −cos δ·sen θ, cos δ·cos θ)
      const tDir = rotate(this.rot, tDirLocal);
      const vProp = rotateInv(this.rot, sub(this.pointVelocity(propW), water.getCurrent(propW.x, propW.z)));
      const axial = dot(vProp, tDirLocal);
      let thrust = 0;
      if (this.engine !== "running") {
        thrust = 0; // motor desligado/dando partida: hélice não empurra
      } else if (this.gear === "F") {
        thrust = P.maxThrust * this.engineLoad() * Math.max(0, 1 - axial / P.propPitchSpeed);
      } else if (this.gear === "R") {
        thrust = -P.maxThrust * P.reverseThrustFactor * this.engineLoad() * clamp(1 + axial / (P.propPitchSpeed * 0.6), 0, 1.3);
      }
      // Cavitação (aproximação documentada): carga alta com escorregamento alto (arrancada,
      // ré a toda, hélice "patinando") forma bolhas de vapor -> perde empuxo e a rotação sobe.
      const slip = this.gear === "N" ? 0 : clamp(1 - Math.abs(axial) / P.propPitchSpeed, 0, 1);
      const load = Math.abs(thrust) / P.maxThrust;
      if (P.surfacePiercing) {
        // HÉLICE DE SUPERFÍCIE: projetada para trabalhar ventilada, com ~metade do disco fora d'água (imersão ~0,45).
        // Menos imersão = menos carga e menos empuxo; mais imersão (parado, popa baixa) = mais carga (a turbina
        // "segura" o N2) e rendimento ruim em baixa velocidade. Não cavita (o ar chega antes do vapor).
        const imm = immersion;
        const immLoad = imm < 0.45 ? Math.pow(imm / 0.45, 0.8) : 1 + 0.5 * (imm - 0.45) / 0.55;
        this.u.propLoad = immLoad * (1 - 0.12 * clamp(axial / P.propPitchSpeed, 0, 1)); // passo grande: descarrega pouco com a velocidade
        this.cavitation = 0;
        // (o torque absorvido já inclui a imersão; aqui só o rendimento: baixo com o disco todo molhado e devagar)
        thrust *= lerp(0.62, 1, smoothstep(6, 22, u)) * (1 - 0.7 * this.engineDamage);
        // "prop walk": a hélice de superfície empurra a popa para o lado da rotação (o piloto corrige no volante)
        if (thrust !== 0 && P.propWalk) this.addForceAt(scale(right, P.propWalk * Math.abs(thrust) * immersion), propW, "thrust");
      } else {
        this.u.propLoad = Math.pow(immersion, 1.5) * (1 - 0.35 * clamp(axial / P.propPitchSpeed, 0, 1));
        const cavTarget = immersion > 0.9 && this.engine === "running" ? clamp((load * slip - 0.55) / 0.25, 0, 1) : 0;
        this.cavitation += (cavTarget - this.cavitation) * (1 - Math.exp(-dt / 0.15));
        thrust *= Math.pow(immersion, 1.5) * (1 - 0.5 * aeration) * (1 - 0.3 * this.cavitation) * (1 - 0.7 * this.engineDamage); // pé/hélice avariados
      }
      if (thrust !== 0) this.addForceAt(scale(tDir, thrust), propW, "thrust");
      this.lastThrust = thrust;
      // (hélice de superfície: trabalhar ventilada é o normal dela — não conta como "ventilação" na telemetria)
      this.u.axial = axial; this.u.ventilation = P.surfacePiercing ? 1 : ventilation; this.u.slip = slip; this.u.intakeSubmerged = intakeSubmerged;

      // rabeta como "flap": trim gera sustentação/afundamento de popa proporcional a u²
      if (propDepth > 0 && u > 0) {
        const q = 0.5 * RHO * u * u;
        this.addForceAt(scale(up, -q * P.driveLiftArea * trimAngle * immersion), propW, "lift");
        // rabeta como leme: força lateral na popa
        const side = -q * P.gearcaseRudder * Math.sin(this.steer) * ventilation;
        this.addForceAt(scale(right, side), propW, "lift");
      }
    });
    // agregados dos motores (telemetria/sistemas): empuxo total; entrada d'água = todas submersas
    const un0 = this.units[0];
    const thrust = this.units.reduce((a, x) => a + x.lastThrust, 0);
    const intakeSubmerged = this.units.every((x) => x.intakeSubmerged);
    const ventilation = Math.min(...this.units.map((x) => x.ventilation));
    const slip = un0.slip;
    const immersion = Math.min(...this.units.map((x) => x.immersion));

    // ---------------- inclinação para dentro da curva (casco em V) ----------------
    const angLocal = rotateInv(this.rot, this.angVel);
    if (wetFraction > 0) {
      // aceleração centrípeta (u·ω) -> o casco em V inclina para dentro; só com velocidade e saturado
      const aLat = clamp(u * angLocal.y, -8, 8);
      const bankTorque = -P.bankCoef * aLat * wetFraction * clamp((u - 4) / 8, 0, 1);
      const rollDamp = -P.rollDamping * angLocal.z * wetFraction;
      // amortecimento de guinada: em baixa velocidade o casco gira mais solto (manobra com dois motores)
      const yawLow = P.yawDampingLowSpeed ?? 1;
      const yawDamp = -P.yawDamping * (yawLow + (1 - yawLow) * clamp(Math.abs(u) / 8, 0, 1)) * angLocal.y * Math.min(1, wetFraction * 2);
      this.T = add(this.T, rotate(this.rot, v3(0, yawDamp, bankTorque + rollDamp)));
    }

    // ---------------- espelho de popa andando de ré ----------------
    // De ré o espelho (placa reta) vai na frente: arrasto de corpo rombudo ½·ρ·Cd·A·u² na área molhada dele
    // (segura a ré em ~10 km/h, como numa lancha real) — e a água "empilha" contra ele (ver updateBilge).
    {
      this.transomPile = 0;
      if (u < -0.05) {
        const P2 = this.params;
        const tb = this.toWorld(v3(0, this.keelLocalY, -P2.length / 2 + 0.05));
        const depth = clamp(water.getHeight(tb.x, tb.z) - tb.y, 0, 0.8);
        const area = P2.beam * 0.85 * depth * 0.7;             // fundo em V: ~70 % do retângulo
        const f = 0.5 * RHO * 1.0 * area * u * u;
        if (f > 0) this.addForceAt(rotate(this.rot, v3(0, 0, f)), this.toWorld(v3(0, this.keelLocalY + depth * 0.5, -P2.length / 2)), "contact");
        this.transomPile = (u * u) / (2 * G) * 0.6;             // água que sobe contra o espelho (estagnação)
      }
    }

    // ---------------- ar: arrasto + vento (vento aparente = vento − velocidade do barco) ----------------
    // longitudinal (área frontal, `airDragCdA`) no CG, como antes; lateral (costado + para-brisa) no centro
    // vélico `windage.center` — à frente e acima do CG: o barco deriva, adorna e a proa cai a sotavento
    {
      const wv = world.wind ?? v3();
      const rl = rotateInv(this.rot, v3(wv.x - this.vel.x, -this.vel.y, wv.z - this.vel.z));
      const sp = len(rl);
      if (sp > 0.01) {
        const q = 0.5 * RHO_AIR * sp;
        this.F = add(this.F, rotate(this.rot, v3(0, 0, q * P.airDragCdA * rl.z)));
        this.addForceAt(rotate(this.rot, v3(q * P.windage.sideCdA * rl.x, 0, 0)), this.toWorld(P.windage.center), "contact");
      }
      this.telemetry.apparentWind = sp;
    }

    // ---------------- âncora (o cabo entra como mola em collide) ----------------
    {
      const A = P.anchor;
      const voltsOk = !this.systems.p.hasBattery || A.motorA === 0 || this.systems.supplyV(A.motorA) >= 9;
      this.anchor.step(dt, input.anchor, this.toWorld(A.roller), (x, z) => world.groundHeight(x, z), voltsOk, !!this.winchStrap || this.capsized);
    }
    // ---------------- colisões (fundo, rochas, píer) ----------------
    const impact = this.collide(world);
    this.impactN = impact;
    this.evaluateDamage(dt, world, impact);

    // ---------------- integração (Euler semi-implícito) ----------------
    this.vel = addScaled(this.vel, this.F, dt / this.totalMass);
    const I = this.inertia;
    const tl = rotateInv(this.rot, this.T);
    const Iw = v3(I.x * angLocal.x, I.y * angLocal.y, I.z * angLocal.z);
    const gyro = cross(angLocal, Iw);
    const newAngLocal = v3(
      angLocal.x + ((tl.x - gyro.x) / I.x) * dt,
      angLocal.y + ((tl.y - gyro.y) / I.y) * dt,
      angLocal.z + ((tl.z - gyro.z) / I.z) * dt,
    );
    this.angVel = rotate(this.rot, newAngLocal);
    const oldPos = this.pos;
    this.pos = addScaled(this.pos, this.vel, dt);
    const w = this.angVel;
    const dq = qMul({ x: w.x, y: w.y, z: w.z, w: 0 }, this.rot);
    this.rot = qNormalize({ x: this.rot.x + 0.5 * dq.x * dt, y: this.rot.y + 0.5 * dq.y * dt, z: this.rot.z + 0.5 * dq.z * dt, w: this.rot.w + 0.5 * dq.w * dt });

    // ---------------- telemetria (lida pelo HUD — valores reais da simulação) ----------------
    const t = this.telemetry;
    const hv = Math.hypot(this.vel.x, this.vel.z);
    t.speedKmh = hv * 3.6;
    t.waterSpeed = u;
    t.throttle = this.throttleActual;
    t.throttleCmd = input.throttle;
    t.trim = this.trim;
    t.trimDeg = trimAngle * 57.2958;
    t.tiltDeg = this.tilt * 57.2958;
    t.tiltBlocked = this.tiltBlocked || this.manualBlockT > 0;
    t.trimPin = P.trimMode === "manual" ? (this.tiltWanted ? P.trimPins.length + 1 : this.trimPin + 1) : 0;
    t.intakeSubmerged = intakeSubmerged;
    t.steerDeg = this.steer * 57.2958;
    t.gear = this.gear;
    t.pitchDeg = pitch * 57.2958;
    t.rollDeg = roll * 57.2958;
    t.wetFraction = wetFraction;
    t.planing = u > 7 && wetFraction < 0.6;
    t.thrustN = thrust;
    t.ventilation = ventilation;
    t.cavitation = Math.max(...this.units.map((x) => x.cavitation));
    t.propSlip = slip;
    this.eachUnit((un) => { un.rpm = this.updateRpm(dt, un.axial, un.ventilation); });
    t.rpm = un0.rpm;
    t.propImmersion = immersion;
    t.revLimiter = this.units.some((x) => x.revLimiting);
    // hélice: engrenada gira com o motor (redução 2:1). Em N fica desacoplada e gira SOLTA,
    // arrastada pela água (como um cata-vento), desacelerando junto com a lancha.
    const PROP_PITCH_M = 0.48;
    this.eachUnit((un) => {
      const engaged = un.gear !== "N";
      const target = engaged ? (un.gear === "R" ? -1 : 1) * un.rpm / (P.propGear ?? 2) : (un.axial / PROP_PITCH_M) * 60 * 0.55 * un.immersion;
      // solta no ar não há água freando: demora bem mais para parar
      un.propRpmState += (target - un.propRpmState) * (1 - Math.exp(-dt / (engaged ? 0.08 : un.immersion > 0.2 ? 0.6 : 3.5)));
      un.fuelLph = un.turb ? un.turb.fuelLph : un.engine === "running" ? P.fuelIdleLph + (P.fuelMaxLph - P.fuelIdleLph) * Math.pow(un.throttleActual, 1.6) * (un.gear === "N" ? 0.3 : 1) : 0;
    });
    t.propRpm = un0.propRpmState;
    t.fuelLph = this.units.reduce((a, x) => a + x.fuelLph, 0);
    t.engine = this.engine;
    t.rpms = this.units.map((x) => x.rpm); t.gears = this.units.map((x) => x.gear); t.throttles = this.units.map((x) => x.throttleActual);
    t.thrusts = this.units.map((x) => x.lastThrust); t.engines = this.units.map((x) => x.engine); t.propRpms = this.units.map((x) => x.propRpmState);
    // sistemas do motor: combustível, temperatura, bateria, horímetro
    const sys = this.systems;
    this.runSystems(dt, { lightsOn: input.navigationLights, trimMotorA: this.trimMotorA, auxA: this.anchor.motorA + this.bilgePumpA + this.turbinePeripheralA(), intakeSubmerged });
    this.updateBilge(dt, water, input);
    this.updateSlosh(dt);
    t.anchorOut = this.anchor.out; t.anchorState = this.anchor.state; t.anchorDepth = this.anchor.depth; t.anchorScope = this.anchor.scope;
    t.anchorTension = this.anchor.tension; t.anchorRelay = this.anchor.relay; t.windlassA = this.anchor.motorA;
    t.trimMotorA = this.trimMotorA; t.jumper = sys.jumper; t.jumpCharge = sys.jumpCharge; t.neutralRev = this.neutralRev;
    this.banksTelemetry();
    t.buzzer = this.selfTestT > 0;
    t.starterRpm = this.engine === "cranking" ? this.rpm : 0;
    t.batterySoc = sys.batterySoc;
    t.distanceM += Math.hypot(this.pos.x - oldPos.x, this.pos.z - oldPos.z);
    t.depth = water.getDepth(this.pos.x, this.pos.z);
    // calado: quanto o casco e a ponta do pé do motor estão abaixo da superfície (varia com carga, trim e tilt)
    {
      const hw = water.getHeight(this.pos.x, this.pos.z);
      let minY = Infinity;
      for (const p of P.bunkPoints) minY = Math.min(minY, this.toWorld(p).y);
      t.draftHull = Math.max(0, hw - minY);
      t.draftMotor = Math.max(t.draftHull, hw - this.lowerUnitTip().y);
    }
    this.updateCapsize(dt, water, world);
    t.capsized = this.capsized;
    t.hullDamage = this.hullDamage; t.engineDamage = this.engineDamage;
    t.swimmers = this.swimmers.length;
    if (impact > 0) t.lastImpact = impact;
  }

  /**
   * Porão: entra água pelo furo do casco (avaria) e por cima da borda (onda/banda); a boia liga a bomba
   * sozinha (> 6 L, desliga < 0,5 L) ou o interruptor manual (`input.bilgePump`). A vazão cai com a
   * tensão da bateria; a água pesa no barco (carga em params.bilge.pos).
   */
  /** Nível da água de dentro (y local): primeiro enche o poço do porão (até o piso), depois cobre o piso. */
  bilgeLevelY(L = this.bilgeL): number {
    const B = this.params.bilge, keel = this.keelLocalY;
    if (L > B.sumpL) return B.floorY + (L - B.sumpL) / 1000 / B.areaM2;
    const T = B.underFloor;
    if (!T) return keel + (B.floorY - keel) * (L / B.sumpL);
    // tabela da forma do casco: interpola litros → nível
    for (let i = 1; i < T.liters.length; i++) if (T.liters[i] >= L) {
      const u = (L - T.liters[i - 1]) / Math.max(1e-6, T.liters[i] - T.liters[i - 1]);
      return T.levels[i - 1] + (T.levels[i] - T.levels[i - 1]) * u;
    }
    return B.floorY;
  }
  private get keelLocalY(): number { return this.params.contactPoints.reduce((m, c) => Math.min(m, c.y), 0); }
  /** Centro de massa da água de dentro (local): no poço (popa) com pouca água; espalhada pelo piso com muita. */
  private bilgeLoadPos(): Vec3 {
    const B = this.params.bilge, L = this.bilgeL;
    if (L <= B.sumpL) {
      // sob o piso: pouca água fica no poço (à ré); enchendo, o centro vai para o meio e sobe com o nível
      const f = clamp(L / B.sumpL, 0, 1);
      const lvl = this.bilgeLevelY(L);
      return v3(0, B.pos.y + (lvl - B.pos.y) * 0.5 * f, B.pos.z + (B.floodCenter.z - B.pos.z) * f * 0.8);
    }
    const sump = B.sumpL, deck = L - sump, h = this.bilgeLevelY(L) - B.floorY;
    const ySump = (B.pos.y + B.floorY) / 2, zSump = B.pos.z + (B.floodCenter.z - B.pos.z) * 0.8;
    // superfície livre: a água do piso corre para o lado mais baixo (deslocamento com atraso em `sloshDeck`)
    const y = (sump * ySump + deck * (B.floorY + h / 2)) / L;
    const x = (sump * this.sloshUnder.x + deck * (B.floodCenter.x + this.sloshDeck.x)) / L;
    const z = (sump * (zSump + this.sloshUnder.z) + deck * (B.floodCenter.z + this.sloshDeck.z)) / L;
    return v3(x, y, z);
  }
  /** deslocamento atual da água solta por superfície livre (local, m): no piso e sob o piso */
  private sloshDeck: Vec3 = v3();
  private sloshUnder: Vec3 = v3();
  /**
   * Efeito de superfície livre: com o barco inclinado a água solta corre para o lado mais baixo. O centro dela
   * anda ≈ (I_superfície ÷ volume)·tg(inclinação), com I = b·l³/12 (proa-popa) ou l·b³/12 (bordo), limitado às
   * paredes, com ~0,8 s de atraso (o chacoalhar). Popa baixa → água para trás → popa mais baixa: é assim que
   * barco alagado afunda de popa. Sob o piso as longarinas dividem o porão (efeito reduzido a 25 %).
   */
  private updateSlosh(dt: number): void {
    const B = this.params.bilge, L = this.bilgeL;
    if (this.capsized) { this.sloshDeck = v3(); this.sloshUnder = v3(); return; }
    const fwd = this.forward, right = this.right;
    const tanP = fwd.y / Math.max(0.2, Math.sqrt(1 - fwd.y * fwd.y));    // > 0 proa para cima
    const tanR = right.y / Math.max(0.2, Math.sqrt(1 - right.y * right.y)); // > 0 boreste para cima
    const shift = (vol: number, len: number, wid: number, f: number) => {
      const V = Math.max(vol, 0.02);
      const kz = (f * wid * len ** 3) / 12 / V, kx = (f * len * wid ** 3) / 12 / V;
      return v3(clamp(-kx * tanR, -wid * 0.42, wid * 0.42), 0, clamp(-kz * tanP, -len * 0.42, len * 0.42));
    };
    const deckV = Math.max(0, L - B.sumpL) / 1000, underV = Math.min(L, B.sumpL) / 1000;
    const tD = shift(deckV, B.floodLen, 2 * B.floodHalfW, 1), tU = shift(underV, this.params.length * 0.7, this.params.beam * 0.7, 0.25);
    const a = 1 - Math.exp(-dt / 0.8);
    this.sloshDeck = v3(this.sloshDeck.x + (tD.x - this.sloshDeck.x) * a, 0, this.sloshDeck.z + (tD.z - this.sloshDeck.z) * a);
    this.sloshUnder = v3(this.sloshUnder.x + (tU.x - this.sloshUnder.x) * a, 0, this.sloshUnder.z + (tU.z - this.sloshUnder.z) * a);
  }

  /**
   * Porão:
   *  - ENTRADA: furo no fundo (orifício Q = Cd*A*raiz(2g*dh), dh = água de fora - nível de dentro, nos dois
   *    sentidos) e água por cima da borda/espelho (vertedouro ~ h^1,5; respingos; menos com o barco andando);
   *  - NÍVEL: a água enche o poço (sumpL) e depois se espalha pelo piso (areaM2): o peso vai para o meio e
   *    sobe com o nível; capacidade = volume alagável (maxL);
   *  - BOMBA: boia (> 6 L liga, < 0,5 L desliga) ou interruptor manual; curva vazão x altura manométrica
   *    Q = Qmax*(1 - H/H0)*f(tensão), H = da água de dentro até a saída (+ coluna d'água se a saída afundar);
   *    o jato sai pela mangueira com v = Q/A, perpendicular ao costado, somado à velocidade do barco;
   *  - BORDA LIVRE: menor altura da borda/espelho acima da água; < 3 cm com água dentro = INAVEGÁVEL (alagado);
   *    peso total acima do empuxo máximo do casco (água até a borda) = AFUNDA.
   */
  private updateBilge(dt: number, water: IWaterSurface, input: VehicleInput): void {
    const P = this.params, B = P.bilge, t = this.telemetry;
    let inflow = 0;
    this.bilgeHole = 0; this.bilgeOver = 0;
    let freeboard = 9;
    if (this.capsized && !this.sunk) {
      // VIRADO: a água ocupa o casco, menos a bolsa de ar presa sob o convés/console. O ar escapa pelo furo do
      // casco (e pelas frestas) empurrado pela coluna d'água: v ≈ √(2·ρágua·g·h / ρar) ≈ 60 m/s. Sem ar e com o
      // peso acima do empuxo do casco, ele AFUNDA; casco inteiro = a bolsa segura por muito tempo.
      if (this.airL < 0) this.airL = B.maxL * B.capsizeAirFrac;
      const holeA = B.holeMaxM2 * Math.pow(this.hullDamage, 1.3) + B.ventM2;
      const vAir = Math.sqrt((2 * 1000 * G * 0.6) / 1.2);
      this.airL = Math.max(0, this.airL - 0.6 * holeA * vAir * 1000 * dt);
      this.bilgeL = B.maxL - this.airL;
    } else {
      this.airL = -1;
      const holeA = B.holeMaxM2 * Math.pow(this.hullDamage, 1.3);
      const keel = this.keelLocalY;
      if (holeA > 0) {
        const hp = this.toWorld(v3(B.pos.x, keel + 0.03, B.pos.z));
        const insideAboveHole = this.bilgeLevelY() - (keel + 0.03);
        const dh = water.getHeight(hp.x, hp.z) - hp.y - insideAboveHole;
        this.bilgeHole = Math.sign(dh) * 0.62 * holeA * Math.sqrt(2 * G * Math.abs(dh)) * 1000;
        if (this.bilgeHole < 0) this.bilgeHole = Math.max(this.bilgeHole, -this.bilgeL / dt);
      }
      const weir = (h: number, L: number) => (h > 0 ? 1.8 * L * Math.min(h, 0.3) ** 1.5 + 0.25 * L * 0.06 ** 1.5 : h > -0.06 ? 0.25 * L * (h + 0.06) ** 1.5 : 0) * 1000;
      const uw = Math.hypot(this.vel.x, this.vel.z);
      const moving = 1 / (1 + (uw / 3) ** 2);
      const NS = 6, z0 = -P.length * 0.46, seg = (P.length * 0.86) / NS;
      for (let i = 0; i < NS; i++) {
        const z = z0 + (i + 0.5) * seg;
        const gy = P.gunwaleY + B.bowRise * smoothstep(-0.1 * P.length, 0.5 * P.length, z) ** 2;
        for (const sx of [-1, 1]) {
          const w = this.toWorld(v3(sx * (P.beam / 2 - 0.04), gy, z));
          const h = water.getHeight(w.x, w.z) - w.y;
          freeboard = Math.min(freeboard, -h);
          this.bilgeOver += moving * weir(h, seg);
        }
      }
      // drenos do cockpit no piso da popa (sem válvula): com a popa baixa o lado de fora fica mais alto que o
      // piso e a água ENTRA por eles — é assim que barco pesado de popa afunda (até parado no píer)
      if (B.scupperM2 > 0) {
        const sp = this.toWorld(v3(0, B.floorY + 0.01, -P.length / 2 + B.scupperFromStern));
        const insideAbove = Math.max(0, this.bilgeLevelY() - (B.floorY + 0.01));
        const dh = water.getHeight(sp.x, sp.z) - sp.y - insideAbove;
        if (dh > 0) { const q = 0.6 * B.scupperM2 * Math.sqrt(2 * G * dh) * 1000; this.bilgeOver += q; }
      }
      // espelho de popa em 6 trechos: no meio o rebaixo do motor (transomY, poço do motor), nos lados o convés de
      // popa até os cantos (borda). Respingo pequeno no rebaixo fica no poço; lâmina maior passa da antepara.
      // Dando ré o espelho é uma pá (Q = Cd·largura·lâmina·v) e a água empilha contra ele (u²/2g).
      this.bilgeScoop = 0;
      const NT = 6, tHalf = P.beam / 2 - 0.05, tSeg = (2 * tHalf) / NT;
      for (let i = 0; i < NT; i++) {
        const x = -tHalf + (i + 0.5) * tSeg;
        const notch = Math.abs(x) < B.transomW / 2;
        const tw = this.toWorld(v3(x, notch ? B.transomY : P.gunwaleY, -P.length / 2 + 0.05));
        const ht = water.getHeight(tw.x, tw.z) - tw.y + this.transomPile;
        freeboard = Math.min(freeboard, -ht);
        const well = notch ? 0.35 + 0.65 * smoothstep(0.03, 0.12, ht) : 1;
        this.bilgeOver += well * weir(ht, tSeg);
        if (ht > 0) {
          const vl = rotateInv(this.rot, this.pointVelocity(tw));
          const q = 0.8 * tSeg * Math.min(ht, 0.3) * Math.max(0, -vl.z) * 1000;
          this.bilgeScoop += q; this.bilgeOver += q;
        }
      }
      inflow = this.bilgeHole + this.bilgeOver;
    }
    // ---- bomba: boia/interruptor, curva vazão x altura, tensão ----
    if (B.pumpLph > 0) {
      if (this.bilgeL > 6) this.bilgeAuto = true;
      else if (this.bilgeL < 0.5) this.bilgeAuto = false;
    }
    const wantPump = B.pumpLph > 0 && (this.bilgeMode === "on" || (this.bilgeMode === "auto" && (this.bilgeAuto || input.bilgePump))) && !this.capsized && !this.sunk;
    const powered = wantPump && this.systems.supplyV(B.pumpA) >= 9;
    let flowLps = 0;
    const ow = this.toWorld(B.outlet);
    if (powered) {
      const outsideOver = Math.max(0, water.getHeight(ow.x, ow.z) - ow.y);        // saída afogada: coluna d'água contra
      const head = Math.max(0, B.outlet.y - this.bilgeLevelY()) + outsideOver + 0.25; // + perdas na mangueira/válvula
      const curve = clamp(1 - head / B.shutoffHeadM, 0, 1);
      flowLps = (B.pumpLph / 3600) * curve * clamp((this.systems.batteryV - 9) / 3.4, 0.2, 1.05);
      if (this.bilgeL < 0.3) flowLps *= this.bilgeL / 0.3; // poço quase seco: suga ar
    }
    const out = Math.min(flowLps * dt, Math.max(0, this.bilgeL + inflow * dt));
    this.bilgeL = clamp(this.bilgeL + inflow * dt - out, 0, B.maxL);
    this.bilgePumpA = powered ? B.pumpA * (0.7 + 0.3 * clamp(this.bilgeL, 0, 1)) : 0; // seca: a corrente cai
    t.bilgeL = this.bilgeL; t.bilgeInflowLps = inflow; t.bilgePump = powered;
    t.bilgeFlowLps = out > 0 ? out / dt : 0;
    // jato: sai da mangueira (v = Q/A) para fora do costado e um pouco para baixo, somado à velocidade do barco
    {
      const vOut = t.bilgeFlowLps / 1000 / B.outletAreaM2;
      const sx = Math.sign(B.outlet.x) || 1;
      const dirW = rotate(this.rot, v3(sx * 0.98, -0.17, 0));
      const pv = this.pointVelocity(ow);
      t.bilgeJetPos = ow;
      t.bilgeJetVel = v3(pv.x + dirW.x * vOut, pv.y + dirW.y * vOut, pv.z + dirW.z * vOut);
    }
    // borda livre, alagado e afundando
    t.freeboard = freeboard;
    t.swamped = !this.capsized && freeboard < 0.03 && this.bilgeL > 50;
    const goneUnder = this.capsized ? this.pos.y < water.getHeight(this.pos.x, this.pos.z) - 1.2 : freeboard < -0.3;
    if (!this.sunk && this.totalMass > this.maxBuoyancyKg && goneUnder) {
      this.sunk = true;
      if (this.engine !== "off") { this.engine = "off"; t.stall = "sunk"; }
      this.ejectOccupants(1);
      this.sinkSpot = { ...this.pos };
    }
    t.airPocketL = Math.max(0, this.airL);
    t.sunk = this.sunk;
    // alarme: bomba acionada e jogando água fora, ou água alta (sem bomba / bomba sem força)
    t.bilgeAlarm = (powered && t.bilgeFlowLps > 0.05) || this.bilgeL > 40;
  }

  /** Empuxo máximo do casco (kg): casco imerso até a borda (modelo de pontos saturado). */
  get maxBuoyancyKg(): number { return 1000 * this.params.waterplaneArea * this.params.pointMaxDepth; }

  private updateControls(dt: number, input: VehicleInput, u: number): void {
    const P = this.params;
    if (this.selfTestT > 0) {
      this.selfTestT -= dt;
      if (this.selfTestT <= 0) {
        // cada motor desligado entra no arranque; com dois, o segundo espera o primeiro (~1,2 s)
        let k = 0;
        for (const un of this.units) if (un.engine === "off") {
          un.engine = "cranking"; un.crankTimer = 0; un.crankRevs = 0; un.crankNeed = 3 + Math.random() * 2; un.crankWait = 1.2 * k++;
        }
      }
    }
    // direção com limite dependente da velocidade
    const maxSteer = lerp(P.maxSteerLow, P.maxSteerHigh, clamp(u / 22, 0, 1));
    this.steer = approach(this.steer, clamp(input.steering, -1, 1) * maxSteer, P.steerRate * dt);

    // trim (comando é taxa)
    // Trim/tilt (um só comando, como o botão do power trim real):
    //  • faixa de TRIM (−6°..+10°): usada navegando, a hélice continua na água;
    //  • segurando "trim +" no fim do curso → TILT até +60° (recolher para guardar/água rasa):
    //    a hélice sai da água. Bloqueado em velocidade ou rotação alta (como nos motores reais).
    const trimIn = clamp(input.trim, -1, 1);
    this.tiltBlocked = false;
    this.telemetry.trimRelay = false;
    if (P.trimMode === "manual") { this.updateManualTrim(dt, trimIn, input.throttle); this.trimMotorA = 0; }
    else {
    // bomba elétrica do power trim: velocidade cai com a tensão da bateria (motor DC); com a bateria
    // zerada (abaixo de ~9 V sob a carga da bomba) o relé fecha mas a bomba não gira — só o estalo
    const pumpOk = this.systems.trimPumpOk;
    const vFactor = pumpOk ? clamp((this.systems.batteryV - 9.5) / 3, 0.25, 1.05) : 0;
    this.telemetry.trimRelay = !pumpOk && Math.abs(trimIn) > 0.05;
    const trimBefore = this.trim, tiltBefore = this.tilt;
    if (trimIn > 0 && this.trim >= 1) {
      // O que impede o tilt é a CARGA no pé: o empuxo da hélice (e a água em velocidade alta) segura o
      // motor para baixo e o cilindro hidráulico não vence. Engatado em baixa rotação funciona
      // (navegação em água rasa), mais devagar quanto maior o empuxo.
      const thrustLoad = Math.abs(this.lastThrust) / P.tiltMaxThrust;
      if (thrustLoad < 1 && this.rpm < P.tiltMaxRpm && Math.abs(u) < P.tiltMaxSpeed) {
        const rate = P.tiltRate * (1 - 0.7 * thrustLoad) * trimIn * vFactor;
        this.tilt = Math.min(P.tiltMax, this.tilt + rate * dt);
      } else this.tiltBlocked = true;
    } else if (trimIn < 0 && this.tilt > 0) {
      this.tilt = Math.max(0, this.tilt + trimIn * P.tiltRate * dt * vFactor);
    } else {
      this.trim = clamp(this.trim + trimIn * P.trimRate * dt * vFactor, -1, 1);
    }
    // corrente da bomba: ~30 A movendo o trim, ~40 A no tilt, ~45 A contra o batente/bloqueado
    // (válvula de alívio) — o botão pressionado sempre puxa corrente
    if (Math.abs(trimIn) > 0.05) {
      const moved = this.trim !== trimBefore || this.tilt !== tiltBefore;
      this.trimMotorA = !pumpOk ? 1.5 : !moved ? 45 : this.tilt !== tiltBefore ? 40 : 30; // sem força: só a bobina do relé
    } else this.trimMotorA = 0;
    }

    // Manete com detentes F / N / R (GDD: frente, neutro e ré). A troca SEMPRE passa por N:
    // corta o acelerador, espera `shiftTime` em neutro (embreagem da rabeta) e só então engrena.
    // Engrenado com acelerador 0 = marcha lenta engrenada (a lancha anda devagar).
    this.eachUnit(() => {
      const ec = input.engineCmd?.[this.u.index];
      const desired: Gear = ec ? ec.gear : input.gear;
      const cmd = clamp(ec ? ec.throttle : input.throttle, 0, 1);
      if (desired !== this.wantGear) {
        this.wantGear = desired;
        if (this.gear !== desired) {
          this.gear = "N";
          this.shiftTimer = desired === "N" ? 0 : P.shiftTime;
        }
      }
      if (this.gear === "N" && this.wantGear !== "N") {
        this.shiftTimer -= dt;
        if (this.shiftTimer <= 0 && this.throttleActual < 0.12) this.gear = this.wantGear;
      }
      // aceleração em neutro (botão da manete segurado com a marcha em N): o motor sobe o giro sem
      // engatar — para aquecer ou testar. Só em N; a rotação fica limitada pela central (NEUTRAL_REV_LIMIT).
      this.neutralRev = this.gear === "N" && this.wantGear === "N" && !!input.neutralThrottle && this.engine === "running";
      let target = (this.gear === "N" && !this.neutralRev) || this.engine !== "running" ? 0 : cmd;
      if (this.usys.protect) target = Math.min(target, 0.3);   // modo de proteção (deste motor)
      if (this.usys.starving) target = Math.min(target, 0.05); // engasgando sem combustível
      this.throttleActual += (target - this.throttleActual) * (1 - Math.exp(-dt / P.engineResponse));
    });
  }

  /** Ponta da rabeta (quilha do pé, abaixo da hélice) no mundo — gira com trim/tilt. */
  lowerUnitTip(): Vec3 {
    const P = this.params;
    const trimAngle = P.trimMode === "manual" ? this.manualAngle : this.trim >= 0 ? this.trim * P.trimUp : -this.trim * P.trimDown;
    const q = qFromAxisAngle(v3(1, 0, 0), trimAngle + this.tilt);
    const tip = v3(P.propPos.x, P.propPos.y - P.propRadius - 0.06, P.propPos.z + 0.15);
    const local = add(P.drivePivot, rotate(q, sub(tip, P.drivePivot)));
    // com duas rabetas, a que estiver mais baixa (barco adernado) é a que bate primeiro
    let best = this.toWorld(add(local, v3(this.units[0].offsetX, 0, 0)));
    for (let i = 1; i < this.units.length; i++) { const w = this.toWorld(add(local, v3(this.units[i].offsetX, 0, 0))); if (w.y < best.y) best = w; }
    return best;
  }
  /** Ângulo atual do pé (trim + tilt) e estado para desfazer um movimento de trim/tilt. */
  private driveSnapshot() {
    const P = this.params;
    const trimAngle = P.trimMode === "manual" ? this.manualAngle : this.trim >= 0 ? this.trim * P.trimUp : -this.trim * P.trimDown;
    return { trim: this.trim, tilt: this.tilt, manual: this.manualAngle, angle: trimAngle + this.tilt };
  }
  private driveOnGroundT = 0;
  private pushDamageAcc = 0;
  /**
   * Baixar o motor (trim/tilt) com o pé encostando no chão — barco na carretinha, encalhado ou em água rasa:
   * o motor PARA no chão (não atravessa a terra nem a carretinha) e forçar contra o chão AVARIA o pé
   * (5 % na batida + 12 %/s segurando o botão de baixar).
   */
  private limitDriveOnGround(dt: number, world: PhysicsWorld, before: { trim: number; tilt: number; manual: number; angle: number }, trimIn: number): void {
    const now = this.driveSnapshot();
    if (now.angle >= before.angle - 1e-7) { this.driveOnGroundT = Math.max(0, this.driveOnGroundT - dt); return; }
    const tip = this.lowerUnitTip();
    if (tip.y > world.groundHeight(tip.x, tip.z) + 0.04) { this.driveOnGroundT = Math.max(0, this.driveOnGroundT - dt); return; }
    // encostou: desfaz o movimento (o motor fica apoiado no chão)
    this.trim = before.trim; this.tilt = before.tilt; this.manualAngle = before.manual;
    if (this.params.trimMode === "manual" && this.tilt > 0.02) this.tiltWanted = true; // (tilt manual: fica apoiado/travado)
    const first = this.driveOnGroundT <= 0;
    this.driveOnGroundT = 0.4;
    // segurando o botão de baixar contra o chão: avaria acumulada (aplicada a cada 1 %)
    if (trimIn < -0.05) this.pushDamageAcc += 0.12 * dt;
    let amt = first ? 0.05 : 0;
    if (this.pushDamageAcc >= 0.01) { amt += this.pushDamageAcc; this.pushDamageAcc = 0; }
    if (amt > 0) this.addDamage("engine", amt, "Avaria no motor: baixou o motor contra o chão — levante (E)");
  }

  /** Topo do capô do motor no mundo (para batidas no carro com o motor levantado). */
  cowlTop(): Vec3 {
    const P = this.params;
    const trimAngle = P.trimMode === "manual" ? this.manualAngle : this.trim >= 0 ? this.trim * P.trimUp : -this.trim * P.trimDown;
    const q = qFromAxisAngle(v3(1, 0, 0), trimAngle + this.tilt);
    return this.toWorld(add(P.drivePivot, rotate(q, v3(0, P.kind === "lancha" ? 0.75 : 0.5, -0.45))));
  }

  private addDamage(part: "hull" | "engine", amount: number, why: string): void {
    if (amount <= 0.005) return;
    if (part === "hull") this.hullDamage = clamp(this.hullDamage + amount, 0, 1);
    else {
      this.engineDamage = clamp(this.engineDamage + amount, 0, 1);
      if (this.engineDamage >= 0.95 && this.engine === "running") { this.engine = "off"; this.telemetry.stall = "broken"; }
    }
    this.telemetry.damageEvent = why;
    this.telemetry.damageCount++;
  }

  /**
   * Avarias por impacto:
   *  • casco: pico de contato acima de 4× o peso → avaria ∝ excesso (pedra a 15 km/h ≈ 17 %, a 40 km/h ≈ 90 %);
   *    cada impacto conta uma vez (episódio de contato);
   *  • motor: a ponta do pé abaixo do fundo (ou dentro de uma pedra) com o barco andando > 1 m/s
   *    → avaria ∝ velocidade enquanto raspa (encalhar/rebocar com o motor baixado destrói o pé).
   */
  private evaluateDamage(dt: number, world: PhysicsWorld, impact: number): void {
    const W = this.totalMass * G;
    if (impact <= 0) this.hullEpisode = 0;
    else {
      const sev = clamp((impact / W - 4) / 30, 0, 1);
      if (sev > this.hullEpisode) { this.addDamage("hull", sev - this.hullEpisode, "Avaria no casco: batida forte"); this.hullEpisode = sev; }
    }
    this.lowerUnitScrape(dt, world, Math.hypot(this.vel.x, this.vel.z));
  }

  private lowerUnitScrape(dt: number, world: PhysicsWorld, speed: number): void {
    const tip = this.lowerUnitTip();
    let hit = tip.y < world.groundHeight(tip.x, tip.z);
    for (const s of world.spheres) if (!hit && (tip.x - s.x) ** 2 + (tip.y - s.y) ** 2 + (tip.z - s.z) ** 2 < s.r * s.r) hit = true;
    if (hit && speed > 1.0) { // raspar devagar (≤ 3,6 km/h, ex.: subindo na carretinha) não quebra
      const first = !this.engineHitting;
      this.addDamage("engine", (first ? 0.06 : 0) + 0.3 * (speed - 1.0) * dt, "Avaria no motor: o pé bateu no fundo — levante o motor (tilt) em água rasa e para rebocar");
      this.engineHitting = true;
    } else if (!hit) this.engineHitting = false;
  }

  /**
   * Barco preso na carretinha sendo rebocado (pose imposta pelo veículo): só as avarias — pé arrastando
   * no chão e batidas do casco/motor no veículo (`inside` diz se um ponto do mundo está dentro dele).
   */
  carriedDamage(dt: number, world: PhysicsWorld, inside: (p: Vec3) => boolean): void {
    this.lowerUnitScrape(dt, world, Math.hypot(this.vel.x, this.vel.z));
    this.obstacleDamage(inside);
  }

  /** Casco ou motor dentro de um obstáculo móvel (o veículo de reboque): avaria uma vez por batida. */
  obstacleDamage(inside: (p: Vec3) => boolean): void {
    const eng = inside(this.lowerUnitTip()) || inside(this.cowlTop());
    const hull = this.params.contactPoints.some((p) => inside(this.toWorld(p)));
    if ((eng || hull) && !this.obstacleInside) {
      if (eng) this.addDamage("engine", 0.3, "Avaria no motor: bateu no carro");
      if (hull) this.addDamage("hull", 0.2, "Avaria no casco: bateu no carro");
    }
    this.obstacleInside = eng || hull;
  }

  /** Oficina: zera as avarias (usado no reset do píer/rampa). */
  repair(): void { this.hullDamage = 0; this.engineDamage = 0; this.hullEpisode = 0; this.engineHitting = false; for (const x of this.units) x.turb?.repair(); }

  /**
   * Barco preso na carretinha (pose imposta pelo reboque): o MOTOR continua funcionando — partida/desliga,
   * trim/tilt, lenta, sistemas (combustível, temperatura, bateria). Acelerador e direção ficam com o
   * veículo (o motor fica em lenta, na marcha em que estava). Fora d'água a entrada de refrigeração não
   * pega água: o motor esquenta como no mundo real (alarme → proteção → desliga).
   */
  carriedStep(dt: number, trimIn: number, water: IWaterSurface, world?: PhysicsWorld): void {
    const P = this.params, t = this.telemetry;
    const driveBefore = this.driveSnapshot();
    this.updateControls(dt, { ...NO_PILOT, trim: trimIn, gear: this.wantGear }, 0);
    if (world) this.limitDriveOnGround(dt, world, driveBefore, trimIn);
    const trimAngle = P.trimMode === "manual" ? this.manualAngle : this.trim >= 0 ? this.trim * P.trimUp : -this.trim * P.trimDown;
    const q = qFromAxisAngle(v3(1, 0, 0), trimAngle + this.tilt);
    const propW = this.toWorld(add(P.drivePivot, rotate(q, sub(P.propPos, P.drivePivot))));
    const intakeW = this.toWorld(add(P.drivePivot, rotate(q, sub(P.intakePos, P.drivePivot))));
    this.propWorld = propW;
    const propDepth = water.getHeight(propW.x, propW.z) - propW.y;
    this.immersion = clamp((propDepth + P.propRadius) / (2 * P.propRadius), 0, 1);
    const intakeSubmerged = water.getHeight(intakeW.x, intakeW.z) - intakeW.y > 0.02;
    this.eachUnit((un) => {
      un.intakeSubmerged = intakeSubmerged; // na carretinha a tomada d'água fica fora da água
      un.rpm = this.updateRpm(dt, 0, 1); // lenta
      const engaged = un.gear !== "N" && un.engine === "running";
      un.propRpmState += ((engaged ? (un.gear === "R" ? -1 : 1) * un.rpm / 2 : 0) - un.propRpmState) * (1 - Math.exp(-dt / (engaged ? 0.08 : 3.5)));
    });
    t.rpm = this.units[0].rpm;
    t.rpms = this.units.map((x) => x.rpm); t.engines = this.units.map((x) => x.engine); t.propRpms = this.units.map((x) => x.propRpmState);
    t.fuelLph = this.units.filter((x) => x.engine === "running").length * P.fuelIdleLph;
    for (const x of this.units) x.fuelLph = x.turb ? x.turb.fuelLph : x.engine === "running" ? P.fuelIdleLph : 0;
    this.runSystems(dt, { lightsOn: false, trimMotorA: this.trimMotorA, auxA: this.turbinePeripheralA(), intakeSubmerged, load: 0 });
    const sys = this.systems;
    t.trim = this.trim; t.trimDeg = trimAngle * 57.2958; t.tiltDeg = this.tilt * 57.2958;
    t.tiltBlocked = this.tiltBlocked || this.manualBlockT > 0;
    t.trimPin = P.trimMode === "manual" ? (this.tiltWanted ? P.trimPins.length + 1 : this.trimPin + 1) : 0;
    t.trimMotorA = this.trimMotorA; t.jumper = sys.jumper; t.jumpCharge = sys.jumpCharge;
    this.banksTelemetry();
    t.buzzer = this.selfTestT > 0; t.starterRpm = this.engine === "cranking" ? this.rpm : 0;
    t.intakeSubmerged = intakeSubmerged; t.propImmersion = this.immersion; t.propRpm = this.propRpmState;
    t.hullDamage = this.hullDamage; t.engineDamage = this.engineDamage;
    t.speedKmh = Math.hypot(this.vel.x, this.vel.z) * 3.6;
    t.engine = this.engine; t.gear = this.gear; t.throttle = 0; t.thrustN = 0; t.cavitation = 0; t.ventilation = 1;
    t.depth = water.getDepth(this.pos.x, this.pos.z);
  }

  /**
   * Emborcamento: com o barco deitado além de ~75° (up.y < 0,25) por 0,4 s, ninguém se segura —
   * os ocupantes caem na água com a velocidade que tinham, o peso deles sai do barco e o motor
   * desliga (cordão do corta-circuito preso ao piloto). Na água, cada pessoa boia pelo colete.
   */
  private updateCapsize(dt: number, water: IWaterSurface, world: PhysicsWorld): void {
    const upY = this.up.y;
    this.capsizeT = upY < 0.25 ? this.capsizeT + dt : 0;
    if (!this.capsized && this.capsizeT > 0.4) {
      this.capsized = true;
      if (this.engine !== "off") { this.engine = "off"; this.telemetry.stall = "capsize"; }
      // caem para o lado em que o barco deitou (bordo que afundou), afastando-se do casco — menos no
      // habitáculo fechado: o piloto fica preso no cinto, dentro da célula de segurança (com ar)
      if (!this.params.enclosedCockpit) this.ejectOccupants(this.right.y < 0 ? 1 : -1);
    }
    this.updateSwimmers(dt, water, world);
  }

  /** Ocupantes vão para a água (de colete), cada um pelo bordo do seu banco. */
  private ejectOccupants(rollSide: number): void {
    const fwd = this.forward, right = this.right;
    for (const o of this.occupants) {
      const seat = this.params.seats[o.seat];
      const p = this.toWorld(seat);
      const side = Math.abs(seat.x) > 0.1 ? Math.sign(seat.x) : rollSide;
      const out = v3(right.x * side, 0, right.z * side);
      const ol = Math.hypot(out.x, out.z) || 1;
      this.swimmers.push({ seat: o.seat, mass: o.mass, pos: p, vel: addScaled(this.pointVelocity(p), v3(out.x / ol, 0.5, out.z / ol), 1.6), yaw: Math.atan2(fwd.x, fwd.z),
        slot: Math.atan2(side * 1, seat.z / (this.params.length / 2)), swim: 0, t: 0 });
    }
    this.occupants = [];
  }

  private updateSwimmers(dt: number, water: IWaterSurface, world: PhysicsWorld): void {
    for (const s of this.swimmers) {
      const h = water.getHeight(s.pos.x, s.pos.z);
      const cur = water.getCurrent(s.pos.x, s.pos.z);
      // colete: empuxo até o centro do colete ficar ~5 cm abaixo da superfície; no ar, só gravidade
      const dSub = clamp(h - 0.05 - s.pos.y, -0.5, 0.6);
      const inWater = h - s.pos.y > -0.3;
      const ay = -G + (dSub > -0.3 ? (G + 60 * dSub) : 0) - (inWater ? 4 * s.vel.y : 0);
      // nado: depois de ~1 s se recuperando, a pessoa nada (até ~0,7 m/s, crawl/peito de colete) para o
      // seu lugar em volta do barco (elipse um pouco maior que o casco) e fica ali, acompanhando o barco
      const fwdH = this.forward;
      const yawB = Math.atan2(fwdH.x, fwdH.z);
      const ex = this.params.beam / 2 + 0.38, ez = this.params.length / 2 + 0.35; // ao alcance do cabo de mão
      if (s.t <= 1 && s.t + dt > 1) {
        // escolhe o lugar do lado em que a pessoa está (nunca nada por baixo do casco)
        const dx = s.pos.x - this.pos.x, dz = s.pos.z - this.pos.z;
        const fx = dx * Math.cos(yawB) - dz * Math.sin(yawB), fz = dx * Math.sin(yawB) + dz * Math.cos(yawB);
        s.slot = Math.atan2(fx / ex, fz / ez);
      }
      s.t += dt;
      let tx: number, tz: number;
      if (this.sunk && this.sinkSpot) {
        // barco afundado: todos nadam para o mesmo ponto (onde ele afundou) e ficam juntos, em roda, de frente
        // uns para os outros (posição de grupo de quem está de colete: mais calor, mais visível, ninguém se perde)
        const k = this.swimmers.indexOf(s), n = this.swimmers.length;
        const r = n > 1 ? 0.32 + 0.06 * n : 0;
        const a = (k / Math.max(1, n)) * Math.PI * 2;
        tx = this.sinkSpot.x + Math.sin(a) * r; tz = this.sinkSpot.z + Math.cos(a) * r;
      } else {
        const lx = Math.sin(s.slot) * ex, lz = Math.cos(s.slot) * ez;
        tx = this.pos.x + lx * Math.cos(yawB) + lz * Math.sin(yawB);
        tz = this.pos.z - lx * Math.sin(yawB) + lz * Math.cos(yawB);
      }
      const dxT = tx - s.pos.x, dzT = tz - s.pos.z, dT = Math.hypot(dxT, dzT);
      // perto do lugar: acompanha o barco (segura no cabo); afundado, só a correnteza
      let swx = this.sunk ? 0 : this.vel.x, swz = this.sunk ? 0 : this.vel.z;
      let effort = 0;
      if (s.t > 1 && inWater && dT > 0.25) {
        const sp = Math.min(0.7, dT * 0.8);
        swx += (dxT / dT) * sp; swz += (dzT / dT) * sp;
        effort = clamp(sp / 0.7, 0.3, 1);
        s.yaw = Math.atan2(dxT, dzT); // de frente para onde nada
      } else if (s.t > 1) {
        // de frente para o barco — ou, afundado, para o centro do grupo
        const fx = this.sunk && this.sinkSpot ? this.sinkSpot.x : this.pos.x, fz = this.sunk && this.sinkSpot ? this.sinkSpot.z : this.pos.z;
        s.yaw = Math.atan2(fx - s.pos.x, fz - s.pos.z);
      }
      s.swim += (effort - s.swim) * Math.min(1, dt * 3);
      // arrasto do corpo na água: puxa para a correnteza + a velocidade de nado
      const kd = inWater ? 1.6 : 0.05;
      const vx = s.t > 1 ? swx : cur.x, vz = s.t > 1 ? swz : cur.z;
      s.vel = v3(s.vel.x + (vx - s.vel.x) * kd * dt, s.vel.y + ay * dt, s.vel.z + (vz - s.vel.z) * kd * dt);
      s.pos = addScaled(s.pos, s.vel, dt);
      // não atravessa o casco: dentro da projeção do barco, empurra para o bordo mais próximo
      const L = rotateInv(this.rot, sub(s.pos, this.pos));
      const hx = this.params.beam / 2 + 0.22, hz = this.params.length / 2 + 0.15;
      if (!this.sunk && Math.abs(L.x) < hx && Math.abs(L.z) < hz && Math.abs(L.y) < 1.2) {
        const px = (hx - Math.abs(L.x)) * (Math.sign(L.x) || 1);
        const push = rotate(this.rot, v3(px, 0, 0));
        s.pos = v3(s.pos.x + push.x * 6 * dt, s.pos.y, s.pos.z + push.z * 6 * dt);
      }
      // pessoas não se sobrepõem (~0,6 m entre os centros)
      for (const o of this.swimmers) {
        if (o === s) continue;
        const dx = s.pos.x - o.pos.x, dz = s.pos.z - o.pos.z, d = Math.hypot(dx, dz);
        const dMin = this.sunk ? 0.42 : 0.6;
        if (d < dMin) { const k = ((dMin - d) / (d || 1)) * 3 * dt; s.pos = v3(s.pos.x + dx * k + (d ? 0 : 0.01), s.pos.y, s.pos.z + dz * k); }
      }
      const g = world.groundHeight(s.pos.x, s.pos.z) + 0.25; // raso: fica sentado no fundo
      if (s.pos.y < g) { s.pos = v3(s.pos.x, g, s.pos.z); s.vel = v3(s.vel.x * 0.9, Math.max(0, s.vel.y), s.vel.z * 0.9); }
    }
  }

  /**
   * Trim MANUAL (bote, sem power trim): cada toque em trim+ / trim- passa o motor para o próximo furo
   * do pino (3 ângulos); depois do furo mais alto, trim+ levanta o motor todo (tilt, travado em cima);
   * trim- abaixa de volta. Só sem acelerar (o piloto solta o acelerador, se vira, solta a trava e
   * mexe no motor com a mão — pode estar parado ou deslizando na lenta). O motor ANDA até a posição nova (nunca salta).
   */
  private updateManualTrim(dt: number, trimIn: number, throttleCmd: number): void {
    const P = this.params;
    const pins = P.trimPins;
    const up = trimIn > 0.5 && this.prevTrimIn <= 0.5;
    const down = trimIn < -0.5 && this.prevTrimIn >= -0.5;
    this.prevTrimIn = trimIn;
    this.manualBlockT = Math.max(0, this.manualBlockT - dt);
    if (up || down) {
      if (throttleCmd > 0.02 || this.throttleActual > 0.05) this.manualBlockT = 1.2; // acelerando: a mão está no acelerador
      else if (up) { if (this.trimPin < pins.length - 1) this.trimPin++; else this.tiltWanted = true; }
      else if (this.tiltWanted) this.tiltWanted = false;
      else if (this.trimPin > 0) this.trimPin--;
    }
    this.tilt = approach(this.tilt, this.tiltWanted ? P.tiltMax : 0, P.tiltRate * dt);
    // o motor só acomoda no furo novo com o tilt embaixo
    if (this.tilt < 0.02) this.manualAngle = approach(this.manualAngle, pins[this.trimPin], P.trimRate * dt);
    const span = pins[pins.length - 1] - pins[0] || 1;
    this.trim = ((this.manualAngle - pins[0]) / span) * 2 - 1;
  }

  /**
   * Ignição (tecla P): desliga o motor ou dá partida. Por segurança (como nos motores reais),
   * a partida só funciona em NEUTRO. Retorna o que aconteceu.
   */
  toggleIgnition(): "stopped" | "starting" | "pulling" | "needNeutral" | "busy" | "noFuel" | "lowBattery" | "hot" | "noPilot" | "broken" | "manual" {
    if (!this.occupants.some((o) => o.seat === "helm")) return "noPilot";
    if (this.engine !== "running" && this.engineDamage >= 0.95) return "broken";
    if (this.engine === "running") { this.engine = "off"; return "stopped"; }
    const tb = this.units[0].turb;
    if (tb) {
      // turbina: botão de partida do FADEC (arranque → ignição + combustível → acende → marcha lenta); de novo aborta.
      // No modo manual o P não faz nada: a partida é pelas chaves do painel (Y)
      if (!tb.fadec) return tb.running ? (tb.shutdown(), "stopped") : "manual";
      if (tb.starting) { tb.abort(); return "stopped"; }
      if (tb.n1 > 8) return "busy"; // ainda girando (spool-down): espere parar
      if (this.gear !== "N") return "needNeutral";
      if (this.systems.canStart() === "battery") return "lowBattery";
      this.telemetry.stall = ""; this.telemetry.startFail = "";
      tb.start();
      return "starting";
    }
    if (this.engine === "cranking") return "busy";
    if (this.gear !== "N") return "needNeutral";
    const why = this.systems.canStart();
    // sem combustível a partida é permitida (o arranque gira / a corda é puxada), mas o motor não pega
    if (why === "battery") return "lowBattery";
    if (why === "overheat") return "hot";
    if (this.selfTestT > 0) return "busy";
    this.telemetry.stall = "";
    this.telemetry.startFail = "";
    if (!this.params.electricStart) {
      // partida na corda: uma puxada (~0,5 s). Motor quente pega quase sempre; frio pode precisar de 2–3
      this.engine = "cranking"; this.crankTimer = 0;
      // carburado: frio pega mal sem o afogador (e bem com ele); quente, o afogador puxado deixa a mistura rica
      const cold = this.systems.coolantC < 40;
      const pCatch = this.params.carbureted ? (cold ? (this.choke ? 0.8 : 0.15) : (this.choke ? 0.3 : 0.85)) : (this.systems.coolantC > 45 ? 0.85 : 0.5);
      this.pullCatch = this.systems.fuelFeed && Math.random() < pCatch;
      return "pulling";
    }
    // chave em ON: autoteste com o apito característico; o arranque gira quando ele termina
    this.selfTestT = 1.1;
    return "starting";
  }

  /** Este motor ainda espera a vez do arranque (pausa curta + nenhum motor anterior girando o arranque)? */
  private waitsToCrank(x: EngineUnit): boolean {
    if (x.engine !== "cranking") return false;
    if (x.crankWait > 0) return true;
    return this.units.some((o) => o.index < x.index && o.engine === "cranking");
  }

  /**
   * Atualiza os sistemas (combustível, arrefecimento, bateria, alternador, horímetro). Um motor: como sempre.
   * Dois motores: cada um no SEU banco (arranque, alternador e temperatura dele); a casa (luzes, trim, molinete,
   * bomba de porão) fica no banco 1; o tanque é comum (cada banco gasta o consumo do seu motor).
   */
  private runSystems(dt: number, h: { lightsOn: boolean; trimMotorA: number; auxA: number; intakeSubmerged: boolean; load?: number }): void {
    const t = this.telemetry;
    if (!this.systems2) {
      const sys = this.systems;
      if (!this.units[0].turb) sys.batteryOn = this.batterySel !== "off";
      sys.update(dt, { ...this.systemsEngineState(), ...(h.load !== undefined ? { load: h.load } : {}), fuelLph: t.fuelLph, intakeSubmerged: h.intakeSubmerged, lightsOn: h.lightsOn, trimMotorA: h.trimMotorA, auxA: h.auxA });
      if (this.units[0].turb) sys.coolantC = this.units[0].turb.oilC; // turbina: a "temperatura do motor" é a do óleo
      if (sys.stallReason && this.engine === "running") { this.engine = "off"; t.stall = sys.stallReason; }
      return;
    }
    // chave de baterias: "ind" = cada motor no seu banco (casa no 1); "bb"/"be" = um banco alimenta os dois motores e a
    // casa (o outro fica isolado, mas a temperatura e o combustível de cada motor continuam no seu banco); "both" =
    // paralelo (as cargas se igualam); "off" = nenhum banco no barramento (só os alternadores, se girando)
    const sel = this.batterySel;
    const elec = sel === "bb" ? 0 : sel === "be" ? 1 : -1; // banco que alimenta tudo (−1 = cada um o seu)
    const starterOf = (x: EngineUnit) => (x.engine === "cranking" && !this.waitsToCrank(x) ? 1 : 0);
    this.systems2!.fuelValveOpen = this.systems.fuelValveOpen; // registro do tanque comum
    this.banks.forEach((sys, i) => {
      const x = this.units[i], house = elec >= 0 ? i === elec : i === 0;
      sys.batteryOn = sel !== "off" && (elec < 0 || i === elec);
      if (i > 0) sys.fuelL = this.systems.fuelL; // tanque comum
      const all = elec >= 0 && i === elec, iso = elec >= 0 && i !== elec;
      sys.update(dt, {
        engine: x.engine, rpm: x.engine === "running" ? x.rpm : 0, load: h.load ?? x.throttleActual,
        // o banco que alimenta tudo leva os dois arranques e os dois alternadores; o isolado, nenhum
        starterLoad: all ? this.units.reduce((acc, u) => acc + starterOf(u), 0) : iso ? 0 : starterOf(x),
        alternators: all ? this.units.filter((u) => u.engine === "running").length : iso ? 0 : 1,
        fuelLph: x.fuelLph, intakeSubmerged: h.load === undefined ? x.intakeSubmerged : h.intakeSubmerged, // rebocado (load 0): a entrada comum
        lightsOn: house && h.lightsOn, trimMotorA: house ? h.trimMotorA : 0, auxA: house ? h.auxA : 0,
      });
      if (i > 0) this.systems.fuelL = sys.fuelL;
      if (x.turb) sys.coolantC = x.turb.oilC; // turbina: a "temperatura do motor" é a do óleo
      if (sys.stallReason && x.engine === "running") { x.engine = "off"; t.stall = sys.stallReason; }
    });
    if (sel === "both") {
      // em paralelo os dois bancos ficam na mesma tensão e a carga se iguala (ponderada pela capacidade)
      const [a, b] = this.banks, ca = a.p.batteryAh, cb = b.p.batteryAh;
      const soc = (a.batterySoc * ca + b.batterySoc * cb) / (ca + cb), v = (a.batteryV + b.batteryV) / 2;
      a.batterySoc = b.batterySoc = soc; a.batteryV = b.batteryV = v;
    }
  }

  /** Telemetria dos sistemas: por banco e o resumo (alarme se QUALQUER motor esquentar / banco descarregar). */
  private banksTelemetry(): void {
    const t = this.telemetry, sys = this.systems, B = this.banks;
    t.fuelL = sys.fuelL; t.fuelFrac = sys.fuelFrac; t.lowFuel = sys.lowFuel;
    // (o modelo elétrico é "equivalente 12 V"; num sistema de 24 V a tensão real é ×2 e a corrente ÷2)
    const k = (sys.p.nominalV ?? 12) / 12;
    t.nominalV = 12 * k;
    t.coolants = B.map((b) => b.coolantC); t.batteryVs = B.map((b) => (b.batteryOn || !this.systems2 ? b.batteryV : b.restV) * k); /* dois bancos: o isolado mostra a tensão da PRÓPRIA bateria (nos bornes) */ t.batterySocs = B.map((b) => b.batterySoc); t.batteryAs = B.map((b) => b.batteryA / k);
    t.coolantC = Math.max(...t.coolants); t.batteryV = sys.batteryV * k; t.batterySoc = sys.batterySoc; t.batteryA = sys.batteryA / k;
    t.fuelValveOpen = sys.fuelValveOpen; t.fuelLineFrac = Math.min(...B.map((b) => b.lineFrac)); t.bilgeMode = this.bilgeMode; t.batterySel = this.batterySel; t.choke = this.choke;
    t.engineHours = sys.engineHours; t.gpu = sys.gpu; t.gpuState = sys.gpuState; t.gpuT = sys.gpuT; t.gpuKw = sys.gpuKw;
    t.busBattery = sys.batteryOn; t.busGen = sys.genOn && sys.alternatorA > 0; t.extPwr = sys.extOnline; t.extPwrClosed = sys.extPwr;
    t.gpuA = sys.gpuA / ((sys.p.nominalV ?? 12) / 12);
    t.overheatWarn = B.some((b) => b.overheatWarn); t.protectMode = B.some((b) => b.protect); t.chargeWarn = B.some((b) => b.chargeWarn);
    const tb = this.units[0].turb;
    // bomba de água MECÂNICA: gira com o gerador de gás (até só com o starter) e só bombeia com a tomada submersa
    const C = this.params.cooling;
    t.coolingLps = tb && C && t.intakeSubmerged ? C.lpsAt100 * clamp(tb.n1 / 100, 0, 1.05) : 0;
    t.turbine = tb ? { n1: tb.n1, n2: tb.n2, egt: tb.egt, torque: tb.torque, oilPsi: tb.oilPsi, fuelLph: tb.fuelLph, phase: tb.phase,
      starter: tb.starter && tb.powered, ignition: tb.ignition && tb.powered, lit: tb.lit, egtWarn: tb.egtWarn, hotStarts: tb.hotStarts, powered: tb.powered, starterSw: tb.starter, ignitionSw: tb.ignition,
      fadec: tb.fadec, master: tb.master, boostPump: tb.boostPump, fuelValve: tb.fuelValve, pooledL: tb.pooledL, wear: tb.wear,
      generator: tb.generator, starterLock: tb.starterLockT, seized: tb.seizedOn, oilC: tb.oilC, oilHot: tb.oilC > tb.p.oilWarnC, oilRed: tb.oilC > tb.p.oilRedC } : null;
  }

  /** Estado agregado dos motores para os sistemas (bateria, alternadores, arranques, combustível, temperatura). */
  private systemsEngineState(): { engine: EngineState; rpm: number; load: number; starterLoad: number; alternators: number } {
    // turbina: o starter-gerador gira com o N1 (rotação "equivalente" para a curva do gerador: 62 % N1 ≈ 1860)
    const cranking = this.units.filter((x) => x.engine === "cranking" && !this.waitsToCrank(x)).length;
    const running = this.units.filter((x) => x.engine === "running");
    const starter = this.units.reduce((a, x) => a + (x.turb ? x.turb.starterLoad : x.engine === "cranking" && !this.waitsToCrank(x) ? 1 : 0), 0);
    return {
      engine: cranking > 0 ? "cranking" : running.length ? "running" : "off",
      rpm: Math.max(...this.units.map((x) => (x.turb ? (x.engine === "running" ? x.turb.n1 * 30 : 0) : x.engine === "running" ? x.rpm : 0)), 0),
      load: Math.max(...this.units.map((x) => x.throttleActual)),
      starterLoad: starter,           // corrente de arranque × motores girando o arranque ao mesmo tempo
      alternators: Math.max(1, running.length),
    };
  }

  /** Carga do motor 0..1 incluindo a marcha lenta engrenada. */
  private engineLoad(): number {
    if (this.u.turb) return Math.min(1.4, this.u.turb.torque / 100); // turbina: torque absorvido pela hélice
    const f = this.params.idleThrustFraction;
    return f + (1 - f) * this.throttleActual;
  }

  private updateRpm(dt: number, axial: number, ventilation: number): number {
    const P = this.params;
    const tb = this.u.turb;
    if (tb) {
      // turbina: o eixo de saída gira com a turbina livre (N2); o estado do "motor" segue a fase da turbina
      if (this.u.engine === "off" && tb.burning) tb.cutFuel(); // parada por fora (sem combustível, virou, afundou)
      // chaves do painel → relés do barramento: BAT e GEN (o starter-gerador só gera com o starter desligado)
      this.usys.batteryOn = tb.master;
      this.usys.genOn = tb.generator && !tb.starter;
      this.usys.autoExt = tb.fadec; // FADEC fecha/abre o EXT PWR sozinho; no manual é a chave do painel
      // água do trocador de calor do óleo: bomba mecânica (∝ N1), só com a tomada d'água submersa
      const coolingFrac = P.cooling ? (this.u.intakeSubmerged ? clamp(tb.n1 / 100, 0, 1.05) : 0) : 1;
      tb.update(dt, { lever: this.throttleActual, volts: this.uelec.batteryV, fuel: this.usys.fuelFeed && !this.usys.starving,
        load: this.gear === "N" || tb.n1 < 1 ? 0.12 : this.u.propLoad, damage: this.engineDamage, coolingFrac });
      this.u.engine = tb.engineState;
      this.revLimiting = false;
      if (tb.wear > this.engineDamage) this.engineDamage = tb.wear; // sobretemperatura = avaria do motor
      return (tb.n2 / 100) * tb.p.n2Rpm;
    }
    const thr = this.throttleActual;
    // estimativa documentada: rotação cresce com o acelerador; a carga da hélice
    // segura a rotação em baixa velocidade; hélice ventilando dispara a rotação.
    // carga da hélice: segura a rotação na água; no ar (ou em N) o motor gira livre
    const waterLoad = lerp(0.68, 1.0, clamp(Math.abs(axial) / (P.propPitchSpeed * 0.75), 0, 1));
    const load = this.gear === "N" ? 1 : lerp(1, waterLoad, this.immersion);
    const freeRev = 1 + (1 - ventilation) * 0.25 + this.cavitation * 0.12 + (this.gear === "N" ? 0 : (1 - this.immersion) * 0.3);
    let target = P.idleRpm + (P.maxRpm - P.idleRpm) * Math.pow(thr, 0.85) * load * freeRev;
    // limitador de giro: corta a ignição em pulsos quando passa do limite
    // modo de proteção (superaquecimento): a central limita a rotação; falta de combustível: engasga
    if (this.usys.protect) target = Math.min(target, this.usys.p.protectRpm);
    if (this.gear === "N") target = Math.min(target, NEUTRAL_REV_LIMIT); // central limita o giro em neutro
    if (this.usys.starving) target = Math.min(target, P.idleRpm * 0.8);
    // afogador: frio, acelera a lenta; quente, a mistura fica rica — gira baixo, "engasga" e afoga em ~15 s
    if (P.carbureted && this.choke && this.engine === "running") {
      if (this.systems.coolantC > 45) { target *= 0.72; this.chokeRichT += dt; } else { target += 250; this.chokeRichT = 0; }
      if (this.chokeRichT > 15) { this.engine = "off"; this.telemetry.stall = "flooded"; this.chokeRichT = 0; }
    } else this.chokeRichT = 0;
    this.revLimiting = this.engine === "running" && target > P.revLimitRpm;
    if (this.revLimiting) {
      this.limiterPhase += dt * 9;
      target = P.revLimitRpm - (Math.floor(this.limiterPhase) % 2 === 0 ? 0 : 450);
    }
    if (this.engine === "off") {
      this.rpm += (0 - this.rpm) * (1 - Math.exp(-dt / 0.45)); // motor parando
      if (this.rpm < 5) this.rpm = 0;
      return this.rpm;
    }
    if (this.engine === "cranking" && !this.params.electricStart) {
      // corda: um puxão gira o motor a ~450 rpm por meio segundo
      this.crankTimer += dt;
      this.rpm += ((this.crankTimer < 0.45 ? 450 : 0) - this.rpm) * (1 - Math.exp(-dt / 0.08));
      if (this.crankTimer > 0.4 && this.pullCatch) { this.engine = "running"; this.rpm = 1400; }
      else if (this.crankTimer > 0.9) { this.engine = "off"; this.telemetry.startFail = this.usys.fuelFeed ? "pull" : "fuel"; }
      return this.rpm;
    }
    if (this.engine === "cranking" && this.waitsToCrank(this.u)) {
      // (barco de dois motores: um arranque de cada vez — dois V8 juntos derrubam a tensão e nenhum pega)
      this.u.crankWait = Math.max(0, this.u.crankWait - dt);
      this.rpm += (0 - this.rpm) * (1 - Math.exp(-dt / 0.2));
      return this.rpm;
    }
    if (this.engine === "cranking") {
      // Motor de arranque: a rotação depende da tensão nos bornes (que cai com a carga da bateria).
      // Bateria boa ≈ 250 rpm e pega em ~1 s; fraca gira devagar ("rrr… rrr…") e pode não pegar;
      // abaixo de ~7,5 V só o solenoide estala. O motor só pega com rotação de compressão suficiente.
      const v = this.uelec.batteryV;
      const starterTarget = 260 * clamp((v - 7.5) / 3.1, 0, 1.05);
      this.rpm += (starterTarget - this.rpm) * (1 - Math.exp(-dt / 0.12));
      this.crankTimer += dt;
      this.crankRevs += (this.rpm / 60) * dt * clamp((this.rpm - 60) / 100, 0, 1);
      if (this.crankRevs >= this.crankNeed && this.usys.fuelFeed) { this.engine = "running"; this.rpm = 1150; }
      else if (this.crankTimer > 4) { // o piloto solta a chave: não pegou
        this.engine = "off";
        this.telemetry.startFail = !this.usys.fuelFeed && this.rpm >= 40 ? "fuel" : this.rpm < 40 ? "dead" : "weak";
      }
      return this.rpm;
    }
    this.rpm += (target - this.rpm) * (1 - Math.exp(-dt / (this.immersion < 0.3 && this.gear !== "N" ? 0.15 : 0.35)));
    return this.rpm;
  }

  /** Contatos por penalidade (mola-amortecedor + atrito) — sempre forças, nunca teleporte. */
  private collide(world: PhysicsWorld): number {
    const P = this.params;
    // rigidez/amortecimento dos contatos proporcionais à massa (calibrados para a lancha de ~1300 kg):
    // o bote de ~200 kg com as mesmas molas ficaria numericamente instável no passo de 1/120 s
    const mk = clamp(this.totalMass / 1300, 0.12, 1.5);
    const kG = 260000 * mk, cG = 26000 * mk, muG = 0.45;   // fundo
    const kC = 450000 * mk, cC = 32000 * mk, muC = 0.25;   // rochas / píer
    let maxImpact = 0;
    let contact = false;
    this.onSupport = false;
    for (const lp of P.contactPoints) {
      const wp = this.toWorld(lp);
      const vp = this.pointVelocity(wp);
      // fundo / margem
      const g = world.groundHeight(wp.x, wp.z);
      if (g - wp.y > 0) {
        // normal REAL do terreno (gradiente do relevo): numa parede/barranco a reação é quase horizontal — barra o
        // barco em vez de servir de rampa — e numa encosta a gravidade (componente ao longo dela) o faz escorregar.
        const e = 0.3;
        const gx = (world.groundHeight(wp.x + e, wp.z) - world.groundHeight(wp.x - e, wp.z)) / (2 * e);
        const gz = (world.groundHeight(wp.x, wp.z + e) - world.groundHeight(wp.x, wp.z - e)) / (2 * e);
        const nl = Math.hypot(gx, 1, gz);
        const n = v3(-gx / nl, 1 / nl, -gz / nl);
        const pen = (g - wp.y) * n.y;                       // penetração medida na normal
        const vn = dot(vp, n);
        const fn = Math.max(0, kG * pen - cG * vn);
        const vt = sub(vp, scale(n, vn));                   // deslizamento no plano da encosta
        const vtl = len(vt);
        const ff = vtl > 1e-3 ? scale(vt, -Math.min(muG * fn, 4000 * mk * vtl) / vtl) : v3();
        this.addForceAt(add(scale(n, fn), ff), wp, "contact");
        maxImpact = Math.max(maxImpact, fn);
        contact = true;
      }
      for (const s of world.spheres) {
        const dx = wp.x - s.x, dy = wp.y - s.y, dz = wp.z - s.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= s.r * s.r || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const n = v3(dx / d, dy / d, dz / d);
        maxImpact = Math.max(maxImpact, this.applyContact(wp, vp, n, s.r - d, kC, cC, muC));
        contact = true;
      }
      for (const b of world.boxes) {
        if (wp.x < b.minX || wp.x > b.maxX || wp.y < b.minY || wp.y > b.maxY || wp.z < b.minZ || wp.z > b.maxZ) continue;
        // menor penetração entre as faces laterais (XZ) e o topo
        const opts = [
          { pen: wp.x - b.minX, n: v3(-1, 0, 0) }, { pen: b.maxX - wp.x, n: v3(1, 0, 0) },
          { pen: wp.z - b.minZ, n: v3(0, 0, -1) }, { pen: b.maxZ - wp.z, n: v3(0, 0, 1) },
          { pen: b.maxY - wp.y, n: v3(0, 1, 0) },
        ];
        let best = opts[0];
        for (const o of opts) if (o.pen < best.pen) best = o;
        maxImpact = Math.max(maxImpact, this.applyContact(wp, vp, best.n, best.pen, kC, cC, muC));
        contact = true;
      }
    }
    // carretinha (no referencial dela, que anda com o veículo): berço em V que só apoia por cima, com atrito
    // de carpete — o casco desliza e centraliza; postes-guia e batente como caixas locais
    for (const tc of world.trailers ?? []) {
      const q = frameQuat(tc.pose);
      const kS = 140000 * mk, cS = 14000 * mk;
      for (const lp of [...P.contactPoints, ...P.bunkPoints]) {
        const wp = this.toWorld(lp);
        const L = rotateInv(q, v3(wp.x - tc.pose.x, wp.y - tc.pose.y, wp.z - tc.pose.z));
        if (L.z >= 0 && L.z <= tc.length && Math.abs(L.x) <= tc.halfW) {
          const pen = tc.clear + tc.vSlope * Math.abs(L.x) - L.y;
          if (pen > 0 && pen < 0.3) {
            const gx = tc.vSlope * Math.sign(L.x), nl = Math.hypot(gx, 1);
            const n = rotate(q, v3(-gx / nl, 1 / nl, 0));
            maxImpact = Math.max(maxImpact, this.applyContact(wp, this.pointVelocity(wp), n, pen / nl, kS, cS, tc.mu));
            contact = true;
            this.onSupport = true;
          }
        }
        for (const b of tc.boxes) {
          if (L.x < b.minX || L.x > b.maxX || L.y < b.minY || L.y > b.maxY || L.z < b.minZ || L.z > b.maxZ) continue;
          const opts = [
            { pen: L.x - b.minX, n: v3(-1, 0, 0) }, { pen: b.maxX - L.x, n: v3(1, 0, 0) },
            { pen: L.z - b.minZ, n: v3(0, 0, -1) }, { pen: b.maxZ - L.z, n: v3(0, 0, 1) },
            { pen: b.maxY - L.y, n: v3(0, 1, 0) },
          ];
          let best = opts[0];
          for (const o of opts) if (o.pen < best.pen) best = o;
          let nLocal = best.n, pen = best.pen;
          if (b.onlyPlusZ) {
            // batente em V: só age em quem encosta pela frente; empurra para trás e para o centro
            if (opts[3].pen > 0.4) continue;
            const side = clamp(L.x / b.maxX, -1, 1) * 0.7, nl = Math.hypot(side, 1);
            nLocal = v3(-side / nl, 0, 1 / nl); pen = opts[3].pen;
          }
          maxImpact = Math.max(maxImpact, this.applyContact(wp, this.pointVelocity(wp), rotate(q, nLocal), pen, kC, cC, muC));
          contact = true;
        }
      }
    }
    // cinta do guincho e cabos de amarração (píer/poita): molas só de tração entre o ponto do barco e a âncora
    const ropes: [{ anchor: Vec3; local: Vec3; length: number }, number, number][] = [];
    if (this.winchStrap) ropes.push([this.winchStrap, 60000, 6000]);
    for (const ml of this.mooringLines) ropes.push([ml, 25000, 5000]);
    // cabo da âncora (só com ela no fundo): mais elástico (nylon); a tração alimenta o poder de garra
    this.anchor.tension = 0;
    const al = this.anchor.line;
    if (al) {
      const eye = this.toWorld(al.local);
      const d = sub(al.anchor, eye), dl = len(d);
      if (dl > al.length) {
        const n = scale(d, 1 / dl);
        const f = Math.max(0, 9000 * mk * (dl - al.length) - 4000 * mk * dot(this.pointVelocity(eye), n));
        this.addForceAt(scale(n, f), eye, "contact");
        this.anchor.tension = f;
      }
    }
    for (const [ws, k, c] of ropes) {
      const eye = this.toWorld(ws.local);
      const d = sub(ws.anchor, eye), dl = len(d);
      if (dl > ws.length) {
        const n = scale(d, 1 / dl);
        const vrel = dot(this.pointVelocity(eye), n);
        const f = Math.max(0, k * mk * (dl - ws.length) - c * mk * vrel);
        this.addForceAt(scale(n, f), eye, "contact");
      }
    }
    if (contact && !this.lastContact && maxImpact > 6000) this.telemetry.collisions++;
    this.lastContact = contact;
    return maxImpact;
  }

  private applyContact(wp: Vec3, vp: Vec3, n: Vec3, pen: number, k: number, c: number, mu: number): number {
    const vn = dot(vp, n);
    const fn = Math.max(0, k * pen - c * vn);
    const vt = sub(vp, scale(n, vn));
    const vtl = len(vt);
    const ff = vtl > 1e-3 ? scale(vt, -Math.min(mu * fn, 3000 * clamp(this.totalMass / 1300, 0.12, 1.5) * vtl) / vtl) : v3();
    this.addForceAt(add(scale(n, fn), ff), wp, "contact");
    return fn;
  }
}
