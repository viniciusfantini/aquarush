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
import { type VehicleInput, emptyInput } from "../gameplay/vehicleInput.ts";

const NO_PILOT: VehicleInput = emptyInput();
import { EngineSystems } from "./engineSystems.ts";

const RHO = 1000;     // água doce, kg/m³
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
  stall: "" | "fuel" | "overheat" | "capsize" | "broken"; // último motivo de o motor ter morrido sozinho
  buzzer: boolean;       // alarme do motor apitando (autoteste da chave)
  starterRpm: number;    // rotação do motor de arranque (0 = só o "clique" do solenoide)
  startFail: "" | "weak" | "dead" | "pull"; // última partida que não pegou (bateria fraca / sem força / corda)
  batterySoc: number;    // estado de carga 0..1
  trimPin: number;       // trim manual: furo do pino 1..N, N+1 = tilt total; 0 = power trim
  pullStart: boolean;    // partida na corda (sem arranque elétrico)
  trimMotorA: number;    // corrente da bomba do power trim (A)
  depth: number;         // profundidade sob o casco
  draftHull: number;     // calado do casco (m abaixo da superfície no ponto mais fundo do fundo)
  draftMotor: number;    // calado com o motor (ponta do pé — o que bate primeiro no raso)
  submergedPoints: boolean[];
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

export class Speedboat {
  readonly params: SpeedboatParams;
  // estado do corpo rígido (mundo)
  pos: Vec3;
  vel: Vec3 = v3();
  rot: Quat;
  angVel: Vec3 = v3();

  // estado dos atuadores
  private throttleActual = 0;
  private steer = 0;           // rad
  trim = 0;                    // -1..1
  gear: Gear = "N";
  private shiftTimer = 0;
  private wantGear: Gear = "N";
  private rpm = 750;
  /** Estado do motor (ignição). */
  engine: EngineState = "running";
  private crankTimer = 0;        // tempo girando o arranque (s)
  private crankRevs = 0;         // voltas "úteis" acumuladas (compressões com rotação suficiente)
  private crankNeed = 4;         // voltas úteis para pegar (sorteado a cada tentativa)
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
  private cavitation = 0;
  private propRpmState = 0;
  private immersion = 1;
  private revLimiting = false;
  private limiterPhase = 0;
  private lastThrust = 0;
  /** corrente da bomba elétrica do power trim (A) */
  trimMotorA = 0;
  /** combustível, arrefecimento, bateria e horímetro */
  readonly systems: EngineSystems;
  /** trim manual (bote): furo atual do pino, ângulo atual (anima até o furo) e tilt pedido */
  trimPin = 1;
  private manualAngle = 0;
  private tiltWanted = false;
  private prevTrimIn = 0;
  /** tempo restante do aviso "pare o bote para mexer no motor" */
  private manualBlockT = 0;
  /** partida na corda: esta puxada vai pegar? */
  private pullCatch = false;
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
    this.systems = new EngineSystems({ ...ENGINE_SYSTEMS, tankLiters: params.tankLiters, hasBattery: params.electricStart });
    this.trimPin = Math.max(0, Math.min(1, params.trimPins.length - 1));
    this.manualAngle = params.trimPins[this.trimPin] ?? 0;
    this.pos = { ...pos };
    this.rot = qFromAxisAngle(v3(0, 1, 0), headingRad);
    this.rpm = params.idleRpm;
    this.telemetry = {
      speedKmh: 0, waterSpeed: 0, rpm: params.idleRpm, throttle: 0, throttleCmd: 0, trim: 0, trimDeg: 0, tiltDeg: 0, tiltBlocked: false, intakeSubmerged: true, steerDeg: 0,
      gear: "N", pitchDeg: 0, rollDeg: 0, wetFraction: 0, planing: false, thrustN: 0, ventilation: 1, cavitation: 0, propImmersion: 1, revLimiter: false, propSlip: 0, propRpm: 0, engine: "running", fuelL: 0, fuelFrac: 1, coolantC: 45, batteryV: 12.6, engineHours: 0, overheatWarn: false, protectMode: false, lowFuel: false, chargeWarn: false, stall: "", trimMotorA: 0, fuelLph: 0, buzzer: false, starterRpm: 0, startFail: "", batterySoc: 0.92, trimPin: 0, pullStart: !params.electricStart,
      distanceM: 0, collisions: 0, draftHull: 0, draftMotor: 0, capsized: false, swimmers: 0, hullDamage: 0, engineDamage: 0, damageEvent: "", damageCount: 0, lastImpact: 0, depth: 0, submergedPoints: params.buoyancyPoints.map(() => false),
    };
  }

  /** Reposiciona (usado só no reset/spawn — fora da simulação normal). */
  reset(pos: Vec3, headingRad: number): void {
    this.pos = { ...pos };
    this.vel = v3();
    this.angVel = v3();
    this.rot = qFromAxisAngle(v3(0, 1, 0), headingRad);
    this.throttleActual = 0;
    this.steer = 0;
    this.trim = 0;
    this.tilt = 0;
    this.tiltWanted = false;
    this.capsized = false; this.capsizeT = 0; this.swimmers = []; this.winchStrap = null; this.mooringLines = [];
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
    this.updateControls(dt, input, u);

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
    const propW = this.toWorld(add(P.drivePivot, rotate(tiltRot, sub(P.propPos, P.drivePivot))));
    const intakeW = this.toWorld(add(P.drivePivot, rotate(tiltRot, sub(P.intakePos, P.drivePivot))));
    const intakeSubmerged = water.getHeight(intakeW.x, intakeW.z) - intakeW.y > 0.02;
    this.propWorld = propW;
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
    const cavTarget = immersion > 0.9 && this.engine === "running" ? clamp((load * slip - 0.55) / 0.25, 0, 1) : 0;
    this.cavitation += (cavTarget - this.cavitation) * (1 - Math.exp(-dt / 0.15));
    thrust *= Math.pow(immersion, 1.5) * (1 - 0.5 * aeration) * (1 - 0.3 * this.cavitation) * (1 - 0.7 * this.engineDamage); // pé/hélice avariados
    if (thrust !== 0) this.addForceAt(scale(tDir, thrust), propW, "thrust");
    this.lastThrust = thrust;

    // rabeta como "flap": trim gera sustentação/afundamento de popa proporcional a u²
    if (propDepth > 0 && u > 0) {
      const q = 0.5 * RHO * u * u;
      this.addForceAt(scale(up, -q * P.driveLiftArea * trimAngle * immersion), propW, "lift");
      // rabeta como leme: força lateral na popa
      const side = -q * P.gearcaseRudder * Math.sin(this.steer) * ventilation;
      this.addForceAt(scale(right, side), propW, "lift");
    }

    // ---------------- inclinação para dentro da curva (casco em V) ----------------
    const angLocal = rotateInv(this.rot, this.angVel);
    if (wetFraction > 0) {
      // aceleração centrípeta (u·ω) -> o casco em V inclina para dentro; só com velocidade e saturado
      const aLat = clamp(u * angLocal.y, -8, 8);
      const bankTorque = -P.bankCoef * aLat * wetFraction * clamp((u - 4) / 8, 0, 1);
      const rollDamp = -P.rollDamping * angLocal.z * wetFraction;
      const yawDamp = -P.yawDamping * angLocal.y * Math.min(1, wetFraction * 2);
      this.T = add(this.T, rotate(this.rot, v3(0, yawDamp, bankTorque + rollDamp)));
    }

    // ---------------- arrasto aerodinâmico ----------------
    const vAir = len(this.vel);
    if (vAir > 0.01) this.F = addScaled(this.F, this.vel, -0.5 * RHO_AIR * P.airDragCdA * vAir);

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
    t.cavitation = this.cavitation;
    t.propSlip = slip;
    t.rpm = this.updateRpm(dt, axial, ventilation);
    t.propImmersion = immersion;
    t.revLimiter = this.revLimiting;
    // hélice: engrenada gira com o motor (redução 2:1). Em N fica desacoplada e gira SOLTA,
    // arrastada pela água (como um cata-vento), desacelerando junto com a lancha.
    const PROP_PITCH_M = 0.48;
    const engaged = this.gear !== "N";
    const target = engaged ? (this.gear === "R" ? -1 : 1) * t.rpm / 2.0 : (axial / PROP_PITCH_M) * 60 * 0.55 * immersion;
    // solta no ar não há água freando: demora bem mais para parar
    this.propRpmState += (target - this.propRpmState) * (1 - Math.exp(-dt / (engaged ? 0.08 : immersion > 0.2 ? 0.6 : 3.5)));
    t.propRpm = this.propRpmState;
    t.fuelLph = this.engine === "running" ? P.fuelIdleLph + (P.fuelMaxLph - P.fuelIdleLph) * Math.pow(this.throttleActual, 1.6) * (this.gear === "N" ? 0.3 : 1) : 0;
    t.engine = this.engine;
    // sistemas do motor: combustível, temperatura, bateria, horímetro
    const sys = this.systems;
    sys.update(dt, { engine: this.engine, rpm: t.rpm, fuelLph: t.fuelLph, load: this.throttleActual, intakeSubmerged, lightsOn: input.navigationLights, trimMotorA: this.trimMotorA });
    t.trimMotorA = this.trimMotorA;
    if (sys.stallReason && this.engine === "running") { this.engine = "off"; t.stall = sys.stallReason; }
    t.fuelL = sys.fuelL; t.fuelFrac = sys.fuelFrac; t.coolantC = sys.coolantC; t.batteryV = sys.batteryV;
    t.engineHours = sys.engineHours; t.overheatWarn = sys.overheatWarn; t.protectMode = sys.protect;
    t.lowFuel = sys.lowFuel; t.chargeWarn = sys.chargeWarn;
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

  private updateControls(dt: number, input: VehicleInput, u: number): void {
    const P = this.params;
    if (this.selfTestT > 0) {
      this.selfTestT -= dt;
      if (this.selfTestT <= 0 && this.engine === "off") {
        this.engine = "cranking"; this.crankTimer = 0; this.crankRevs = 0; this.crankNeed = 3 + Math.random() * 2;
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
    if (P.trimMode === "manual") { this.updateManualTrim(dt, trimIn, input.throttle); this.trimMotorA = 0; }
    else {
    // bomba elétrica do power trim: velocidade cai com a tensão da bateria (motor DC)
    const vFactor = clamp((this.systems.batteryV - 9.5) / 3, 0.25, 1.05);
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
      this.trimMotorA = !moved ? 45 : this.tilt !== tiltBefore ? 40 : 30;
    } else this.trimMotorA = 0;
    }

    // Manete com detentes F / N / R (GDD: frente, neutro e ré). A troca SEMPRE passa por N:
    // corta o acelerador, espera `shiftTime` em neutro (embreagem da rabeta) e só então engrena.
    // Engrenado com acelerador 0 = marcha lenta engrenada (a lancha anda devagar).
    const desired: Gear = input.gear;
    const cmd = clamp(input.throttle, 0, 1);
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
    let target = this.gear === "N" || this.engine !== "running" ? 0 : cmd;
    if (this.systems.protect) target = Math.min(target, 0.3);   // modo de proteção
    if (this.systems.starving) target = Math.min(target, 0.05); // engasgando sem combustível
    this.throttleActual += (target - this.throttleActual) * (1 - Math.exp(-dt / P.engineResponse));
  }

  /** Ponta da rabeta (quilha do pé, abaixo da hélice) no mundo — gira com trim/tilt. */
  lowerUnitTip(): Vec3 {
    const P = this.params;
    const trimAngle = P.trimMode === "manual" ? this.manualAngle : this.trim >= 0 ? this.trim * P.trimUp : -this.trim * P.trimDown;
    const q = qFromAxisAngle(v3(1, 0, 0), trimAngle + this.tilt);
    const tip = v3(P.propPos.x, P.propPos.y - P.propRadius - 0.06, P.propPos.z + 0.15);
    return this.toWorld(add(P.drivePivot, rotate(q, sub(tip, P.drivePivot))));
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
  repair(): void { this.hullDamage = 0; this.engineDamage = 0; this.hullEpisode = 0; this.engineHitting = false; }

  /**
   * Barco preso na carretinha (pose imposta pelo reboque): o MOTOR continua funcionando — partida/desliga,
   * trim/tilt, lenta, sistemas (combustível, temperatura, bateria). Acelerador e direção ficam com o
   * veículo (o motor fica em lenta, na marcha em que estava). Fora d'água a entrada de refrigeração não
   * pega água: o motor esquenta como no mundo real (alarme → proteção → desliga).
   */
  carriedStep(dt: number, trimIn: number, water: IWaterSurface): void {
    const P = this.params, t = this.telemetry;
    this.updateControls(dt, { ...NO_PILOT, trim: trimIn, gear: this.wantGear }, 0);
    const trimAngle = P.trimMode === "manual" ? this.manualAngle : this.trim >= 0 ? this.trim * P.trimUp : -this.trim * P.trimDown;
    const q = qFromAxisAngle(v3(1, 0, 0), trimAngle + this.tilt);
    const propW = this.toWorld(add(P.drivePivot, rotate(q, sub(P.propPos, P.drivePivot))));
    const intakeW = this.toWorld(add(P.drivePivot, rotate(q, sub(P.intakePos, P.drivePivot))));
    this.propWorld = propW;
    const propDepth = water.getHeight(propW.x, propW.z) - propW.y;
    this.immersion = clamp((propDepth + P.propRadius) / (2 * P.propRadius), 0, 1);
    const intakeSubmerged = water.getHeight(intakeW.x, intakeW.z) - intakeW.y > 0.02;
    t.rpm = this.updateRpm(dt, 0, 1); // lenta
    const engaged = this.gear !== "N" && this.engine === "running";
    this.propRpmState += ((engaged ? (this.gear === "R" ? -1 : 1) * t.rpm / 2 : 0) - this.propRpmState) * (1 - Math.exp(-dt / (engaged ? 0.08 : 3.5)));
    t.fuelLph = this.engine === "running" ? P.fuelIdleLph : 0;
    this.systems.update(dt, { engine: this.engine, rpm: t.rpm, fuelLph: t.fuelLph, load: 0, intakeSubmerged, lightsOn: false, trimMotorA: this.trimMotorA });
    const sys = this.systems;
    if (sys.stallReason && this.engine === "running") { this.engine = "off"; t.stall = sys.stallReason; }
    t.trim = this.trim; t.trimDeg = trimAngle * 57.2958; t.tiltDeg = this.tilt * 57.2958;
    t.tiltBlocked = this.tiltBlocked || this.manualBlockT > 0;
    t.trimPin = P.trimMode === "manual" ? (this.tiltWanted ? P.trimPins.length + 1 : this.trimPin + 1) : 0;
    t.trimMotorA = this.trimMotorA; t.batteryV = sys.batteryV; t.batterySoc = sys.batterySoc;
    t.fuelL = sys.fuelL; t.fuelFrac = sys.fuelFrac; t.coolantC = sys.coolantC; t.engineHours = sys.engineHours;
    t.overheatWarn = sys.overheatWarn; t.protectMode = sys.protect; t.lowFuel = sys.lowFuel; t.chargeWarn = sys.chargeWarn;
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
      const fwd = this.forward, right = this.right;
      // caem para o lado em que o barco deitou (bordo que afundou), afastando-se do casco
      const rollSide = right.y < 0 ? 1 : -1;
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
      const lx = Math.sin(s.slot) * ex, lz = Math.cos(s.slot) * ez;
      const tx = this.pos.x + lx * Math.cos(yawB) + lz * Math.sin(yawB);
      const tz = this.pos.z - lx * Math.sin(yawB) + lz * Math.cos(yawB);
      const dxT = tx - s.pos.x, dzT = tz - s.pos.z, dT = Math.hypot(dxT, dzT);
      let swx = this.vel.x, swz = this.vel.z; // perto do lugar: só acompanha o barco (segura no cabo)
      let effort = 0;
      if (s.t > 1 && inWater && dT > 0.25) {
        const sp = Math.min(0.7, dT * 0.8);
        swx += (dxT / dT) * sp; swz += (dzT / dT) * sp;
        effort = clamp(sp / 0.7, 0.3, 1);
        s.yaw = Math.atan2(dxT, dzT); // de frente para onde nada
      } else if (s.t > 1) {
        s.yaw = Math.atan2(this.pos.x - s.pos.x, this.pos.z - s.pos.z); // de frente para o barco
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
      if (Math.abs(L.x) < hx && Math.abs(L.z) < hz && Math.abs(L.y) < 1.2) {
        const px = (hx - Math.abs(L.x)) * (Math.sign(L.x) || 1);
        const push = rotate(this.rot, v3(px, 0, 0));
        s.pos = v3(s.pos.x + push.x * 6 * dt, s.pos.y, s.pos.z + push.z * 6 * dt);
      }
      // pessoas não se sobrepõem (~0,6 m entre os centros)
      for (const o of this.swimmers) {
        if (o === s) continue;
        const dx = s.pos.x - o.pos.x, dz = s.pos.z - o.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.6) { const k = ((0.6 - d) / (d || 1)) * 3 * dt; s.pos = v3(s.pos.x + dx * k + (d ? 0 : 0.01), s.pos.y, s.pos.z + dz * k); }
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
  toggleIgnition(): "stopped" | "starting" | "pulling" | "needNeutral" | "busy" | "noFuel" | "lowBattery" | "hot" | "noPilot" | "broken" {
    if (!this.occupants.some((o) => o.seat === "helm")) return "noPilot";
    if (this.engine !== "running" && this.engineDamage >= 0.95) return "broken";
    if (this.engine === "running") { this.engine = "off"; return "stopped"; }
    if (this.engine === "cranking") return "busy";
    if (this.gear !== "N") return "needNeutral";
    const why = this.systems.canStart();
    if (why === "fuel") return "noFuel";
    if (why === "battery") return "lowBattery";
    if (why === "overheat") return "hot";
    if (this.selfTestT > 0) return "busy";
    this.telemetry.stall = "";
    this.telemetry.startFail = "";
    if (!this.params.electricStart) {
      // partida na corda: uma puxada (~0,5 s). Motor quente pega quase sempre; frio pode precisar de 2–3
      this.engine = "cranking"; this.crankTimer = 0;
      this.pullCatch = Math.random() < (this.systems.coolantC > 45 ? 0.85 : 0.5);
      return "pulling";
    }
    // chave em ON: autoteste com o apito característico; o arranque gira quando ele termina
    this.selfTestT = 1.1;
    return "starting";
  }

  /** Carga do motor 0..1 incluindo a marcha lenta engrenada. */
  private engineLoad(): number {
    const f = this.params.idleThrustFraction;
    return f + (1 - f) * this.throttleActual;
  }

  private updateRpm(dt: number, axial: number, ventilation: number): number {
    const P = this.params;
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
    if (this.systems.protect) target = Math.min(target, this.systems.p.protectRpm);
    if (this.systems.starving) target = Math.min(target, P.idleRpm * 0.8);
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
      else if (this.crankTimer > 0.9) { this.engine = "off"; this.telemetry.startFail = "pull"; }
      return this.rpm;
    }
    if (this.engine === "cranking") {
      // Motor de arranque: a rotação depende da tensão nos bornes (que cai com a carga da bateria).
      // Bateria boa ≈ 250 rpm e pega em ~1 s; fraca gira devagar ("rrr… rrr…") e pode não pegar;
      // abaixo de ~7,5 V só o solenoide estala. O motor só pega com rotação de compressão suficiente.
      const v = this.systems.batteryV;
      const starterTarget = 260 * clamp((v - 7.5) / 3.1, 0, 1.05);
      this.rpm += (starterTarget - this.rpm) * (1 - Math.exp(-dt / 0.12));
      this.crankTimer += dt;
      this.crankRevs += (this.rpm / 60) * dt * clamp((this.rpm - 60) / 100, 0, 1);
      if (this.crankRevs >= this.crankNeed) { this.engine = "running"; this.rpm = 1150; }
      else if (this.crankTimer > 4) { // o piloto solta a chave: não pegou
        this.engine = "off";
        this.telemetry.startFail = this.rpm < 40 ? "dead" : "weak";
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
      const pen = g - wp.y;
      if (pen > 0) {
        const n = v3(0, 1, 0);
        const fn = Math.max(0, kG * pen - cG * vp.y);
        const vt = v3(vp.x, 0, vp.z);
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
