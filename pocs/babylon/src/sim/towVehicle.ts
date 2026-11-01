// Veículo de reboque + carretinha articulada (para tirar o barco da água pela rampa).
// Modelo simples e documentado (não é o foco do GDD, que é a física do barco):
//  • veículo = modelo de bicicleta (eixo traseiro, entre-eixos, esterço), velocidade longitudinal
//    integrada a partir de tração/freio/arrasto + componente do peso na rampa (sobe devagar, desce sozinho
//    se soltar o freio — com "auto hold" parado);
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
  rearToHitch: number;   // m do eixo traseiro até a bola do engate
  maxSteer: number;      // rad
  accel: number;         // m/s² (tração, plano)
  brake: number;         // m/s²
  maxSpeed: number;      // m/s (frente)
  maxReverse: number;    // m/s (ré)
}

export const TOW_SPECS: Record<"car" | "pickup", TowSpec> = {
  car: { length: 4.3, width: 1.78, height: 1.5, wheelbase: 2.56, rearToHitch: 1.12, maxSteer: 0.6, accel: 2.4, brake: 6, maxSpeed: 11, maxReverse: 2.5 },
  pickup: { length: 5.4, width: 1.9, height: 1.95, wheelbase: 3.17, rearToHitch: 1.4, maxSteer: 0.55, accel: 2.8, brake: 6.5, maxSpeed: 11, maxReverse: 2.5 },
};

export interface Pose { x: number; y: number; z: number; yaw: number; pitch: number }

export class TowRig {
  readonly spec: TowSpec;
  readonly t: TrailerLayout;
  private readonly ground: (x: number, z: number) => number;
  /** eixo traseiro do veículo (XZ) e rumo (direção = (sen yaw, cos yaw)) */
  rx = 0; rz = 0; yaw = Math.PI;
  /** velocidade longitudinal (m/s, + = frente) e esterço atual (rad) */
  v = 0; steer = 0;
  /** rodas traseiras na água (a ré trava) */
  wheelsInWater = false;
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
  }

  get hitch(): { x: number; z: number } {
    return { x: this.rx - Math.sin(this.yaw) * this.spec.rearToHitch, z: this.rz - Math.cos(this.yaw) * this.spec.rearToHitch };
  }
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
    this.steer = approach(this.steer, clamp(cmd.steer, -1, 1) * S.maxSteer, 1.6 * dt);
    // inclinação sob o veículo (rampa): componente do peso ao longo do rumo
    const fx = this.rx + Math.sin(this.yaw) * S.wheelbase, fz = this.rz + Math.cos(this.yaw) * S.wheelbase;
    const grade = (this.ground(fx, fz) - this.ground(this.rx, this.rz)) / S.wheelbase;
    let a = -9.81 * grade * 0.9; // (o peso do barco na carretinha soma ao do carro; motor compensa)
    const up = cmd.up > 0.1, down = cmd.down > 0.1;
    if (up) a += this.v < -0.1 ? S.brake : S.accel * cmd.up;          // W: acelera para a frente (ou freia a ré)
    else if (down) a += this.v > 0.1 ? -S.brake : -S.accel * 0.6 * cmd.down; // S: freia; parado engata a ré
    a -= 0.4 * this.v + 0.02 * this.v * Math.abs(this.v);           // rolamento + ar
    this.v += a * dt;
    // "auto hold": sem comando e quase parado, fica freado (não desce a rampa sozinho)
    if (!up && !down && Math.abs(this.v) < 0.4) this.v = approach(this.v, 0, S.brake * dt);
    this.v = clamp(this.v, -S.maxReverse, S.maxSpeed);
    // de ré na rampa o motorista para quando as rodas traseiras chegam na água (~15 cm): mais que isso a
    // carretinha fica funda demais (o barco passa por cima dos postes-guia e do berço)
    const wetRear = -this.ground(this.rx - Math.sin(this.yaw) * 0.3, this.rz - Math.cos(this.yaw) * 0.3);
    this.wheelsInWater = wetRear > MAX_WHEEL_DEPTH;
    if (this.wheelsInWater && this.v < 0) this.v = 0;
    // bicicleta: o eixo traseiro anda no rumo; o rumo gira com v·tan(δ)/entre-eixos
    this.yaw += (this.v / S.wheelbase) * Math.tan(this.steer) * dt;
    this.rx += Math.sin(this.yaw) * this.v * dt;
    this.rz += Math.cos(this.yaw) * this.v * dt;
    // carretinha: o eixo fica a distância fixa do engate, puxado/empurrado por ele (tractrix)
    const h = this.hitch;
    const dx = this.ax - h.x, dz = this.az - h.z, d = Math.hypot(dx, dz) || 1;
    this.ax = h.x + (dx / d) * this.hitchToAxle;
    this.az = h.z + (dz / d) * this.hitchToAxle;
    // canivete: o cabeçalho encosta no para-choque a ~80° — daí em diante a carretinha é arrastada junto
    const art = this.articulation, lim = MAX_ARTICULATION;
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
    this.yaw = yaw; this.v = 0; this.steer = 0;
    this.rx = x - Math.sin(yaw) * S.wheelbase / 2; this.rz = z - Math.cos(yaw) * S.wheelbase / 2;
    const h = this.hitch;
    this.ax = h.x - Math.sin(yaw) * this.hitchToAxle; this.az = h.z - Math.cos(yaw) * this.hitchToAxle;
  }

  /** Pose do veículo: centro entre os eixos no chão; pitch > 0 = nariz para baixo (convenção Babylon). */
  carPose(): Pose {
    const S = this.spec;
    const fx = this.rx + Math.sin(this.yaw) * S.wheelbase, fz = this.rz + Math.cos(this.yaw) * S.wheelbase;
    const gR = this.ground(this.rx, this.rz), gF = this.ground(fx, fz);
    return { x: (this.rx + fx) / 2, y: (gR + gF) / 2, z: (this.rz + fz) / 2, yaw: this.yaw, pitch: -Math.atan2(gF - gR, S.wheelbase) };
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
