// Simulation + Gameplay: corpo rígido da lancha e SpeedboatController.
// Tudo é feito com FORÇAS e TORQUES aplicados num corpo rígido 6DOF integrado
// em passo fixo (nada de Translate/teleporte). Independente da Babylon:
// roda no navegador e em Node (tests/sim.test.ts).

import {
  type Vec3, type Quat, v3, add, sub, scale, dot, cross, len, rotate, rotateInv, qMul, qNormalize,
  qFromAxisAngle, clamp, lerp, approach, addScaled,
} from "./math.ts";
import type { IWaterSurface } from "./water.ts";
import { G } from "./water.ts";
import type { PhysicsWorld } from "./world.ts";
import type { SpeedboatParams } from "./params.ts";
import type { VehicleInput } from "../gameplay/vehicleInput.ts";

const RHO = 1000;     // água doce, kg/m³
const RHO_AIR = 1.2;

export type Gear = "F" | "N" | "R";

export interface BoatTelemetry {
  speedKmh: number;      // velocidade real sobre o fundo (plano horizontal)
  waterSpeed: number;    // m/s relativo à água, eixo longitudinal
  rpm: number;
  throttle: number;      // acelerador efetivo 0..1 (após resposta do motor)
  throttleCmd: number;   // comando recebido
  trim: number;          // -1..1
  trimDeg: number;
  steerDeg: number;
  gear: Gear;
  pitchDeg: number;      // + proa para cima
  rollDeg: number;       // + boreste para baixo
  wetFraction: number;   // 0..1 (média de imersão dos pontos)
  planing: boolean;
  thrustN: number;
  ventilation: number;   // 1 = hélice bem imersa
  cavitation: number;    // 0..1 — hélice sobrecarregada (alto escorregamento sob carga)
  propSlip: number;      // escorregamento da hélice 0..1
  propRpm: number;       // rotação da hélice (motor / redução)
  fuelLph: number;       // consumo estimado (L/h)
  distanceM: number;
  collisions: number;
  lastImpact: number;    // N (intensidade do último impacto)
  depth: number;         // profundidade sob o casco
  submergedPoints: boolean[];
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
  private lastContact = false;
  private cavitation = 0;

  telemetry: BoatTelemetry;
  debugForces: ForceDebug[] = [];
  debugEnabled = false;

  // acumuladores
  private F: Vec3 = v3();
  private T: Vec3 = v3();

  constructor(params: SpeedboatParams, pos: Vec3, headingRad = 0) {
    this.params = params;
    this.pos = { ...pos };
    this.rot = qFromAxisAngle(v3(0, 1, 0), headingRad);
    this.rpm = params.idleRpm;
    this.telemetry = {
      speedKmh: 0, waterSpeed: 0, rpm: params.idleRpm, throttle: 0, throttleCmd: 0, trim: 0, trimDeg: 0, steerDeg: 0,
      gear: "N", pitchDeg: 0, rollDeg: 0, wetFraction: 0, planing: false, thrustN: 0, ventilation: 1, cavitation: 0, propSlip: 0, propRpm: 0, fuelLph: 0,
      distanceM: 0, collisions: 0, lastImpact: 0, depth: 0, submergedPoints: params.buoyancyPoints.map(() => false),
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

    const fwd = this.forward, up = this.up, right = this.right;
    const pitch = Math.asin(clamp(fwd.y, -1, 1));
    const roll = -Math.asin(clamp(right.y, -1, 1));

    // Velocidade relativa à água (no centro), em eixos locais
    const curC = water.getCurrent(this.pos.x, this.pos.z);
    const relC = rotateInv(this.rot, sub(this.vel, curC));
    const u = relC.z; // velocidade longitudinal na água

    // ---------------- atuadores ----------------
    this.updateControls(dt, input, u);

    // ---------------- gravidade ----------------
    this.F = add(this.F, v3(0, -P.mass * G, 0));

    // Sistema de ondas do próprio casco (Kelvin): no "hump" (Froude ~0.5) a proa sobe numa
    // onda e a popa fica num cavado -> a proa empina antes do planeio. Some ao planar.
    const W = P.mass * G;
    const fn = Math.abs(u) / Math.sqrt(G * P.length); // número de Froude
    const hump = fn < 0.5 ? (fn / 0.5) ** 2 : Math.exp(-(fn - 0.5) * 0.5);
    const selfWave = hump * clamp(1 - (fn - 0.5) * 0.6, 0, 1);

    // ---------------- flutuação + hidrodinâmica por ponto ----------------
    const areaSum = P.buoyancyPoints.reduce((s, b) => s + b.areaWeight, 0);
    let wetSum = 0;
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
      const fLon = -(P.dragLinear * lr.z + P.dragFrictionQuad * Math.abs(lr.z) * lr.z) * wet * share;
      const fLat = -(P.lateralLinear * lr.x + P.lateralQuad * Math.abs(lr.x) * lr.x) * wet * share;

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

    // ---------------- resistência de ondas (hump) ----------------
    if (wetFraction > 0) {
      const waveDrag = -Math.sign(u) * W * P.waveDragPeakRatio * hump * wetFraction * wetFraction;
      this.addForceAt(scale(fwd, waveDrag), this.toWorld(v3(0, -0.35, 0)), "lift");
    }

    // ---------------- propulsão (motor de popa / rabeta) ----------------
    const trimAngle = this.trim >= 0 ? this.trim * P.trimUp : -this.trim * P.trimDown;
    const propW = this.toWorld(P.propPos);
    const propDepth = water.getHeight(propW.x, propW.z) - propW.y;
    // ventilação: hélice perto da superfície perde empuxo (trim excessivo / saltos)
    const ventilation = clamp((propDepth + 0.05) / 0.3, 0, 1);
    // Direção do empuxo: esterçar à direita gira a rabeta e empurra a popa para a esquerda.
    // Trim positivo inclina o empuxo para baixo (eleva a proa); negativo, para cima.
    const tDirLocal = v3(-Math.sin(this.steer) * Math.cos(trimAngle), -Math.sin(trimAngle), Math.cos(this.steer) * Math.cos(trimAngle));
    const tDir = rotate(this.rot, tDirLocal);
    const vProp = rotateInv(this.rot, sub(this.pointVelocity(propW), water.getCurrent(propW.x, propW.z)));
    const axial = dot(vProp, tDirLocal);
    let thrust = 0;
    if (this.gear === "F") {
      thrust = P.maxThrust * this.engineLoad() * Math.max(0, 1 - axial / P.propPitchSpeed);
    } else if (this.gear === "R") {
      thrust = -P.maxThrust * P.reverseThrustFactor * this.engineLoad() * clamp(1 + axial / (P.propPitchSpeed * 0.6), 0, 1.3);
    }
    // Cavitação (aproximação documentada): carga alta com escorregamento alto (arrancada,
    // ré a toda, hélice "patinando") forma bolhas de vapor -> perde empuxo e a rotação sobe.
    const slip = this.gear === "N" ? 0 : clamp(1 - Math.abs(axial) / P.propPitchSpeed, 0, 1);
    const load = Math.abs(thrust) / P.maxThrust;
    const cavTarget = propDepth > 0 ? clamp((load * slip - 0.55) / 0.25, 0, 1) : 0;
    this.cavitation += (cavTarget - this.cavitation) * (1 - Math.exp(-dt / 0.15));
    thrust *= ventilation * (1 - 0.3 * this.cavitation);
    if (thrust !== 0) this.addForceAt(scale(tDir, thrust), propW, "thrust");

    // rabeta como "flap": trim gera sustentação/afundamento de popa proporcional a u²
    if (propDepth > 0 && u > 0) {
      const q = 0.5 * RHO * u * u;
      this.addForceAt(scale(up, -q * P.driveLiftArea * trimAngle * ventilation), propW, "lift");
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
      this.T = add(this.T, rotate(this.rot, v3(0, 0, bankTorque + rollDamp)));
    }

    // ---------------- arrasto aerodinâmico ----------------
    const vAir = len(this.vel);
    if (vAir > 0.01) this.F = addScaled(this.F, this.vel, -0.5 * RHO_AIR * P.airDragCdA * vAir);

    // ---------------- colisões (fundo, rochas, píer) ----------------
    const impact = this.collide(world);

    // ---------------- integração (Euler semi-implícito) ----------------
    this.vel = addScaled(this.vel, this.F, dt / P.mass);
    const I = P.inertia;
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
    t.propRpm = this.gear === "N" ? 0 : (this.gear === "R" ? -1 : 1) * t.rpm / 2.0; // redução 2:1
    t.fuelLph = 3 + 52 * Math.pow(this.throttleActual, 1.6) * (this.gear === "N" ? 0.3 : 1);
    t.distanceM += Math.hypot(this.pos.x - oldPos.x, this.pos.z - oldPos.z);
    t.depth = water.getDepth(this.pos.x, this.pos.z);
    if (impact > 0) t.lastImpact = impact;
  }

  private updateControls(dt: number, input: VehicleInput, u: number): void {
    const P = this.params;
    // direção com limite dependente da velocidade
    const maxSteer = lerp(P.maxSteerLow, P.maxSteerHigh, clamp(u / 22, 0, 1));
    this.steer = approach(this.steer, clamp(input.steering, -1, 1) * maxSteer, P.steerRate * dt);

    // trim (comando é taxa)
    this.trim = clamp(this.trim + clamp(input.trim, -1, 1) * P.trimRate * dt, -1, 1);

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
    const target = this.gear === "N" ? 0 : cmd;
    this.throttleActual += (target - this.throttleActual) * (1 - Math.exp(-dt / P.engineResponse));
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
    const load = this.gear === "N" ? 1 : lerp(0.68, 1.0, clamp(Math.abs(axial) / (P.propPitchSpeed * 0.75), 0, 1));
    const freeRev = 1 + (1 - ventilation) * 0.25 + this.cavitation * 0.12;
    const target = P.idleRpm + (P.maxRpm - P.idleRpm) * Math.pow(thr, 0.85) * load * freeRev;
    this.rpm += (Math.min(target, P.maxRpm * 1.08) - this.rpm) * (1 - Math.exp(-dt / 0.35));
    return this.rpm;
  }

  /** Contatos por penalidade (mola-amortecedor + atrito) — sempre forças, nunca teleporte. */
  private collide(world: PhysicsWorld): number {
    const P = this.params;
    const kG = 260000, cG = 26000, muG = 0.45;   // fundo
    const kC = 450000, cC = 32000, muC = 0.25;   // rochas / píer
    let maxImpact = 0;
    let contact = false;
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
        const ff = vtl > 1e-3 ? scale(vt, -Math.min(muG * fn, 4000 * vtl) / vtl) : v3();
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
    if (contact && !this.lastContact && maxImpact > 6000) this.telemetry.collisions++;
    this.lastContact = contact;
    return maxImpact;
  }

  private applyContact(wp: Vec3, vp: Vec3, n: Vec3, pen: number, k: number, c: number, mu: number): number {
    const vn = dot(vp, n);
    const fn = Math.max(0, k * pen - c * vn);
    const vt = sub(vp, scale(n, vn));
    const vtl = len(vt);
    const ff = vtl > 1e-3 ? scale(vt, -Math.min(mu * fn, 3000 * vtl) / vtl) : v3();
    this.addForceAt(add(scale(n, fn), ff), wp, "contact");
    return fn;
  }
}
