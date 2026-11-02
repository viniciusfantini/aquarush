// Veículo de reboque + carretinha articulada (para tirar o barco da água pela rampa).
// Modelo simples e documentado (não é o foco do GDD, que é a física do barco):
//  • veículo = modelo de bicicleta (eixo traseiro, entre-eixos, esterço), velocidade longitudinal
//    integrada a partir de tração (cai com a velocidade), freio, rolamento e arrasto do ar + componente do
//    peso na rampa ("auto hold" parado). Até ~50 km/h para a frente;
//  • pneus: aderência lateral limitada (μ ≈ 0,8): em velocidade o esterço útil diminui (sai de frente se
//    passar do limite); cada roda segue o relevo (pitch/roll da carroceria) e a carroceria inclina com a
//    transferência de carga (afunda a frente ao frear, levanta ao acelerar, deita nas curvas);
//  • carretinha = reboque de 1 eixo articulado no engate (curva de perseguição/tractrix): segue o carro,
//    de ré ela "dobra" como no mundo real (pode chegar a fazer "L" — canivete);
//  • alturas e inclinações vêm do mesmo relevo da física (groundHeight).

import type { TrailerLayout } from "./trailer.ts";
import { obbOverlap, type Obb } from "./station.ts";
import { RAMP } from "./world.ts";
import { clamp, approach, v3, qMul, qFromAxisAngle, rotateInv, type Vec3 } from "./math.ts";

/** profundidade máxima de água nas rodas traseiras ao dar ré na rampa (m) */
export const MAX_WHEEL_DEPTH = 0.15;

/** ângulo máximo entre veículo e carretinha (cabeçalho encosta no para-choque) */
export const MAX_ARTICULATION = 80 * Math.PI / 180;

export interface DriveCommand { up: number; down: number; steer: number }

export interface TowSpec {
  length: number; width: number; height: number; // caixa do veículo (colisão com o barco → avaria)
  wheelbase: number;     // m
  track: number;         // m (bitola)
  wheelR: number;        // m (raio do pneu)
  rearToHitch: number;   // m do eixo traseiro até a bola do engate
  maxSteer: number;      // rad
  accel: number;         // m/s² (tração, plano)
  brake: number;         // m/s²
  maxSpeed: number;      // m/s (frente)
  maxReverse: number;    // m/s (ré)
}

export const TOW_SPECS: Record<"car" | "pickup", TowSpec> = {
  car: { length: 4.3, width: 1.78, height: 1.5, wheelbase: 2.56, track: 1.58, wheelR: 0.31, rearToHitch: 1.12, maxSteer: 0.6, accel: 2.6, brake: 6.5, maxSpeed: 13.9, maxReverse: 2.5 },
  pickup: { length: 5.4, width: 1.9, height: 1.95, wheelbase: 3.17, track: 1.68, wheelR: 0.4, rearToHitch: 1.4, maxSteer: 0.55, accel: 2.8, brake: 7, maxSpeed: 13.9, maxReverse: 2.5 },
};

export interface Pose { x: number; y: number; z: number; yaw: number; pitch: number; roll?: number }

export class TowRig {
  readonly spec: TowSpec;
  readonly t: TrailerLayout;
  private readonly ground: (x: number, z: number) => number;
  /** eixo traseiro do veículo (XZ) e rumo (direção = (sen yaw, cos yaw)) */
  rx = 0; rz = 0; yaw = Math.PI;
  /** velocidade longitudinal (m/s, + = frente) e esterço atual (rad) */
  v = 0; steer = 0;
  /** ângulo de giro das rodas (visual) — veículo e carretinha */
  wheelSpin = 0; trailerWheelSpin = 0;
  /** aceleração longitudinal e lateral atuais (m/s²) — para a inclinação da carroceria */
  accLong = 0; accLat = 0;
  /** pneus da frente no limite de aderência (saindo de frente) */
  sliding = false;
  /** rodas traseiras na água (a ré trava) */
  wheelsInWater = false;
  /** carretinha acoplada no engate do veículo? (I desacopla/acopla) */
  coupled = true;
  /** acoplador da carretinha parado no chão quando desacoplada (apoiado no macaquinho) */
  private loose = { x: 0, z: 0 };
  /** obstáculos (prédios, bombas, outro veículo estacionado): o veículo/carretinha param ao encostar */
  obstacles: Obb[] = [];
  /** encostou num obstáculo neste passo */
  blocked = false;
  /** eixo da carretinha (XZ) */
  ax = 0; az = 0;
  private readonly hitchToAxle: number;
  private readonly hitchToRoot: number; // engate → ponto de origem da carretinha (guincho), ao longo do eixo

  constructor(t: TrailerLayout, spec: TowSpec, ground: (x: number, z: number) => number) {
    this.t = t; this.spec = spec; this.ground = ground;
    const L = t.sRear - t.sFront;
    this.hitchToRoot = t.sFront - t.coupler;
    this.hitchToAxle = this.hitchToRoot + L * 0.58;
    this.reset();
  }

  /** Volta à posição estacionada (de ré na rampa, de frente para a terra). */
  reset(): void {
    const hz = RAMP.z0 + this.t.coupler;
    this.yaw = Math.PI; this.v = 0; this.steer = 0;
    this.rx = this.t.cx; this.rz = hz - this.spec.rearToHitch;
    this.ax = this.t.cx; this.az = hz + this.hitchToAxle;
    this.coupled = true;
  }

  /** bola do engate do veículo */
  get ball(): { x: number; z: number } {
    return { x: this.rx - Math.sin(this.yaw) * this.spec.rearToHitch, z: this.rz - Math.cos(this.yaw) * this.spec.rearToHitch };
  }
  /** acoplador da carretinha (na bola quando acoplada; parado no chão quando solta) */
  get hitch(): { x: number; z: number } { return this.coupled ? this.ball : this.loose; }

  /**
   * I: desacopla a carretinha (fica parada, apoiada no macaquinho) ou acopla de novo — para acoplar, a bola do
   * engate tem de estar a ≤ 0,6 m do acoplador, com o veículo alinhado (±35°) e parado.
   */
  toggleCoupling(): "uncoupled" | "coupled" | { far: number } | "align" | "moving" {
    if (this.coupled) { this.loose = { ...this.ball }; this.coupled = false; return "uncoupled"; }
    const b = this.ball, d = Math.hypot(b.x - this.loose.x, b.z - this.loose.z);
    if (Math.abs(this.v) > 0.3) return "moving";
    if (d > 0.6) return { far: d };
    const yt = Math.atan2(this.loose.x - this.ax, this.loose.z - this.az); // rumo eixo→acoplador
    let e = yt - this.yaw; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
    if (Math.abs(e) > 35 * Math.PI / 180) return "align";
    this.coupled = true;
    return "coupled";
  }
  /** distância da bola do engate ao acoplador solto (m) — para guiar a ré */
  get couplerGap(): number { const b = this.ball; return this.coupled ? 0 : Math.hypot(b.x - this.loose.x, b.z - this.loose.z); }
  /** ângulo entre veículo e carretinha (rad; 0 = alinhados) */
  get articulation(): number {
    const h = this.hitch;
    const yt = Math.atan2(h.x - this.ax, h.z - this.az); // rumo da carretinha (do eixo para o engate)
    let d = yt - this.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  update(dt: number, cmd: DriveCommand): void {
    const S = this.spec;
    const prev = { rx: this.rx, rz: this.rz, yaw: this.yaw, ax: this.ax, az: this.az };
    // esterço: o volante gira no máximo até o batente; em velocidade a curva fica limitada pela aderência
    this.steer = approach(this.steer, clamp(cmd.steer, -1, 1) * S.maxSteer, 1.6 * dt);
    const v0 = this.v;
    // inclinação sob o veículo (rampa): componente do peso ao longo do rumo
    const fx = this.rx + Math.sin(this.yaw) * S.wheelbase, fz = this.rz + Math.cos(this.yaw) * S.wheelbase;
    const grade = (this.ground(fx, fz) - this.ground(this.rx, this.rz)) / S.wheelbase;
    let a = -9.81 * grade * 0.9; // (o peso do barco na carretinha soma ao do carro; motor compensa)
    const up = cmd.up > 0.1, down = cmd.down > 0.1;
    // tração cai com a velocidade (curva de potência simplificada): forte saindo, ~40 % perto dos 50 km/h
    const traction = S.accel * (1 - 0.6 * clamp(this.v / S.maxSpeed, 0, 1));
    if (up) a += this.v < -0.1 ? S.brake : traction * cmd.up;          // W: acelera para a frente (ou freia a ré)
    else if (down) a += this.v > 0.1 ? -S.brake : -S.accel * 0.6 * cmd.down; // S: freia; parado engata a ré
    // rolamento (0,15 m/s²) + arrasto do ar (∝ v²) — com isso o carro chega perto dos 50 km/h
    a -= Math.sign(this.v) * Math.min(Math.abs(this.v) * 2, 0.15) + 0.0028 * this.v * Math.abs(this.v);
    this.v += a * dt;
    // "auto hold": sem comando e quase parado, fica freado (não desce a rampa sozinho)
    if (!up && !down && Math.abs(this.v) < 0.4) this.v = approach(this.v, 0, S.brake * dt);
    this.v = clamp(this.v, -S.maxReverse, S.maxSpeed);
    // de ré na rampa o motorista para quando as rodas traseiras chegam na água (~15 cm): mais que isso a
    // carretinha fica funda demais (o barco passa por cima dos postes-guia e do berço)
    const wetRear = -this.ground(this.rx - Math.sin(this.yaw) * 0.3, this.rz - Math.cos(this.yaw) * 0.3);
    this.wheelsInWater = wetRear > MAX_WHEEL_DEPTH;
    if (this.wheelsInWater && this.v < 0) this.v = 0;
    // bicicleta com limite de aderência: curvatura máxima = μ·g / v² (μ ≈ 0,8) — passou disso, sai de frente
    let kappa = Math.tan(this.steer) / S.wheelbase;
    const kMax = 0.8 * 9.81 / Math.max(this.v * this.v, 0.01);
    this.sliding = Math.abs(kappa) > kMax;
    if (this.sliding) kappa = Math.sign(kappa) * kMax;
    this.yaw += this.v * kappa * dt;
    this.accLong = (this.v - v0) / dt;
    this.accLat = this.v * this.v * kappa;
    // rodas girando (visual): veículo e carretinha
    this.wheelSpin += (this.v * dt) / S.wheelR;
    this.rx += Math.sin(this.yaw) * this.v * dt;
    this.rz += Math.cos(this.yaw) * this.v * dt;
    // carretinha: o eixo fica a distância fixa do engate, puxado/empurrado por ele (tractrix); solta, fica parada
    const h = this.hitch;
    if (!this.coupled) {
      // o veículo não atravessa a carretinha parada (nem os obstáculos)
      this.blocked = false;
      const car = this.carObb();
      if ([...this.obstacles, this.trailerObb()].some((o) => obbOverlap(car, o))) { Object.assign(this, prev); this.v = 0; this.blocked = true; }
      return;
    }
    const dx = this.ax - h.x, dz = this.az - h.z, d = Math.hypot(dx, dz) || 1;
    const oax = this.ax, oaz = this.az;
    this.ax = h.x + (dx / d) * this.hitchToAxle;
    this.az = h.z + (dz / d) * this.hitchToAxle;
    // a roda da carretinha gira com o deslocamento do eixo dela (sinal: para onde a carretinha anda)
    const tdir = (this.ax - oax) * -(dx / d) + (this.az - oaz) * -(dz / d);
    this.trailerWheelSpin += tdir / (this.t.kind !== "bote" ? 0.33 : 0.23);
    // canivete: o cabeçalho encosta no para-choque a ~80° — daí em diante a carretinha é arrastada junto
    const art = this.articulation, lim = MAX_ARTICULATION; // (só acoplada)
    if (Math.abs(art) > lim) {
      const yt = this.yaw + Math.sign(art) * lim; // rumo eixo→engate permitido
      this.ax = h.x - Math.sin(yt) * this.hitchToAxle;
      this.az = h.z - Math.cos(yt) * this.hitchToAxle;
    }
    // obstáculos: se o veículo ou a carretinha encostam, volta à posição anterior e para (batida leve)
    this.blocked = false;
    if (this.obstacles.length) {
      const mine = [this.carObb(), this.trailerObb()];
      if (this.obstacles.some((o) => mine.some((m) => obbOverlap(m, o)))) {
        Object.assign(this, prev);
        this.v = 0;
        this.blocked = true;
      }
    }
  }

  /** Retângulo do veículo no chão (para colisões). */
  carObb(): Obb {
    const c = this.carPose(), S = this.spec;
    // o centro da carroceria fica ~entre os eixos; comprimento total um pouco maior que o entre-eixos
    return { x: c.x, z: c.z, hw: S.width / 2, hl: S.length / 2, yaw: this.yaw };
  }
  /** Retângulo da carretinha + barco (do guincho à traseira). */
  trailerObb(): Obb {
    const t = this.trailerPose(), L = this.t.length;
    return { x: t.x + Math.sin(t.yaw) * L / 2, z: t.z + Math.cos(t.yaw) * L / 2, hw: Math.max(this.t.frameW, this.t.postX * 2) / 2, hl: L / 2 + 0.3, yaw: t.yaw };
  }

  /** Estaciona numa vaga: veículo de frente para `yaw`, centro em (x, z), carretinha alinhada atrás. */
  placeAt(x: number, z: number, yaw: number): void {
    const S = this.spec;
    this.yaw = yaw; this.v = 0; this.steer = 0; this.coupled = true;
    this.rx = x - Math.sin(yaw) * S.wheelbase / 2; this.rz = z - Math.cos(yaw) * S.wheelbase / 2;
    const h = this.hitch;
    this.ax = h.x - Math.sin(yaw) * this.hitchToAxle; this.az = h.z - Math.cos(yaw) * this.hitchToAxle;
  }

  /** Pose do veículo: centro entre os eixos no chão; pitch > 0 = nariz para baixo (convenção Babylon). */
  carPose(): Pose {
    const S = this.spec;
    const fx = this.rx + Math.sin(this.yaw) * S.wheelbase, fz = this.rz + Math.cos(this.yaw) * S.wheelbase;
    // cada roda no relevo: pitch pela diferença frente/trás, roll pela diferença esquerda/direita
    const rxv = Math.cos(this.yaw) * S.track / 2, rzv = -Math.sin(this.yaw) * S.track / 2; // vetor "direita"
    const gRL = this.ground(this.rx - rxv, this.rz - rzv), gRR = this.ground(this.rx + rxv, this.rz + rzv);
    const gFL = this.ground(fx - rxv, fz - rzv), gFR = this.ground(fx + rxv, fz + rzv);
    const gR = (gRL + gRR) / 2, gF = (gFL + gFR) / 2;
    const roll = Math.atan2(((gRR + gFR) - (gRL + gFL)) / 2, S.track); // > 0 = lado direito mais alto
    return { x: (this.rx + fx) / 2, y: (gR + gF) / 2, z: (this.rz + fz) / 2, yaw: this.yaw, pitch: -Math.atan2(gF - gR, S.wheelbase), roll };
  }

  /** O ponto (mundo) está dentro da carroceria do veículo? (para avarias do barco batendo no carro) */
  insideCar(p: Vec3): boolean {
    const c = this.carPose(), S = this.spec;
    const q = qMul(qFromAxisAngle(v3(0, 1, 0), c.yaw), qFromAxisAngle(v3(1, 0, 0), c.pitch));
    const l = rotateInv(q, v3(p.x - c.x, p.y - c.y, p.z - c.z));
    return Math.abs(l.x) < S.width / 2 && l.y > 0.2 && l.y < S.height && Math.abs(l.z) < S.length / 2;
  }

  /** Pose da carretinha: origem no guincho (sFront), +Z local = para a traseira. */
  trailerPose(): Pose {
    const h = this.hitch;
    const ux = (this.ax - h.x) / this.hitchToAxle, uz = (this.az - h.z) / this.hitchToAxle;
    const x = h.x + ux * this.hitchToRoot, z = h.z + uz * this.hitchToRoot;
    const gH = this.ground(h.x, h.z), gA = this.ground(this.ax, this.az);
    return { x, y: this.ground(x, z), z, yaw: Math.atan2(ux, uz), pitch: Math.atan2(gH - gA, this.hitchToAxle) };
  }
}
