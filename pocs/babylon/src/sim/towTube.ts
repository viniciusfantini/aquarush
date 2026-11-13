// BOIA REBOCADA ("tubo" de uma pessoa) — primeira atividade do jogo. Sem Babylon: roda no Node para os testes.
//
// A boia é um corpo com massa (boia + quem vai nela) que flutua, plana e é puxada por uma CORDA ELÁSTICA (mola que só
// puxa, com amortecimento) presa na popa do veículo; a reação da corda vai para o barco (`Speedboat.externalForces`), então
// rebocar pesa no barco de verdade. Tudo por forças:
//  • peso; empuxo pela parte submersa (volume da boia) e amortecimento vertical;
//  • planeio: andando rápido a água empurra a boia para cima (∝ v²) e ela "sobe" na água;
//  • arrasto da água (linear + quadrático; redonda, ela desliza de lado quase tão fácil quanto para a frente — é o que
//    faz ela "chicotear" para fora da curva) e do ar; no ar (pulando a esteira) só o peso e o ar.
// QUEDA de quem vai na boia ("a pessoa cai"), por limites de quanto ela aguenta segurar nas alças:
//  • aceleração lateral (a chicotada para fora da curva) acima de `fallLatG`·g por `fallLatT` s, ou um pico de 1,4× isso;
//  • aterrissagem forte depois de voar (velocidade vertical ao tocar a água abaixo de −`fallLandV`);
//  • tranco da corda (tensão acima de `fallJerkN`).
// Na água a pessoa boia de colete; quando a boia está devagar ela nada até ela (`SWIM_MS`) e sobe (`climbS` s) — o passeio
// continua. Desengatada perto do píer da atividade, a pessoa sobe no píer e espera a próxima volta.

import { type Vec3, v3, add, sub, scale, len, dot, clamp } from "./math.ts";
import { G, type IWaterSurface } from "./water.ts";
import type { PhysicsWorld, PierLayout } from "./world.ts";
import type { Speedboat } from "./boat.ts";

export interface TubeParams {
  mass: number;          // boia vazia (kg)
  riderMass: number;     // quem vai nela (kg)
  radius: number;        // raio (m)
  height: number;        // altura do "pneu" (m)
  volume: number;        // volume (m³) — empuxo máximo
  ropeLen: number;       // comprimento da corda (m)
  ropeK: number;         // rigidez da corda (N/m)
  ropeC: number;         // amortecimento da corda (N·s/m)
  dragLin: number;       // arrasto linear na água (N·s/m)
  dragQuad: number;      // arrasto quadrático na água (N·s²/m²)
  planeLift: number;     // sustentação de planeio (N por (m/s)²)
  airCdA: number;        // arrasto do ar (m²)
  fallLatG: number;      // aceleração lateral que derruba (em g)
  fallLatT: number;      // por quanto tempo (s)
  fallLandV: number;     // aterrissagem que derruba (m/s, para baixo)
  fallJerkN: number;     // tranco da corda que derruba (N)
  climbS: number;        // tempo para subir de volta (s)
}

export const TUBE: TubeParams = {
  mass: 12, riderMass: 80, radius: 0.8, height: 0.32, volume: 0.42,
  ropeLen: 16, ropeK: 3500, ropeC: 450,
  dragLin: 35, dragQuad: 6.5, planeLift: 14, airCdA: 0.5,
  fallLatG: 0.85, fallLatT: 0.25, fallLandV: 3.2, fallJerkN: 5200,
  climbS: 2.2,
};

export type RiderState = "pier" | "tube" | "water" | "climbing";
const RHO = 1000, RHO_AIR = 1.2, SWIM_MS = 1.1;

export class TowTube {
  readonly p: TubeParams;
  readonly pier: PierLayout;
  pos: Vec3;
  vel: Vec3 = v3();
  yaw = 0;
  /** veículo que reboca (corda engatada) — null = solta */
  hooked: Speedboat | null = null;
  /** amarrada no píer da atividade (parada, sem física) */
  docked = true;
  rider: RiderState = "pier";
  riderPos: Vec3;
  riderVel: Vec3 = v3();
  riderYaw = 0;
  /** nadando agora (para o visual) */
  swimming = false;
  climbT = 0;
  /** telemetria: tensão da corda (N), no ar, aceleração lateral suavizada (m/s²), quedas e o motivo da última */
  tension = 0;
  airborne = false;
  latAcc = 0;
  falls = 0;
  lastFall: "" | "curva" | "pulo" | "tranco" = "";
  /** inclinação visual da boia (rad) pela aceleração lateral */
  bank = 0;
  private latT = 0;
  private wasAir = false;
  private airVy = 0;

  constructor(pier: PierLayout, p: TubeParams = TUBE) {
    this.p = p; this.pier = pier;
    this.pos = this.dockPos(); this.riderPos = this.waitPos();
    this.yaw = Math.PI / 2;
  }

  /** onde a boia fica amarrada (lado leste da ponta do píer da atividade) */
  dockPos(): Vec3 { const P = this.pier; return v3(P.shoreX + P.width / 2 + this.p.radius + 0.4, 0.05, P.shoreZ + P.length - 4); }
  /** onde quem vai na boia espera, em pé no píer */
  waitPos(): Vec3 { const P = this.pier; return v3(P.shoreX + 0.35, P.deckY, P.shoreZ + P.length - 4); }
  /** ponto da popa do veículo onde a corda é presa (local do barco) */
  static towLocal(b: Speedboat): Vec3 { return v3(0, b.params.gunwaleY, -b.params.length / 2 + 0.1); }

  /** o veículo pode engatar a corda agora? (devagar, com a popa perto da boia) */
  canHook(b: Speedboat): boolean {
    if (this.hooked) return false;
    const tp = b.toWorld(TowTube.towLocal(b));
    const speed = Math.hypot(b.vel.x, b.vel.z);
    return speed < 1.5 && Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z) < (this.docked ? 12 : 8);
  }
  /** engata a corda no veículo. Se a boia estava no píer, a pessoa desce do píer e senta nela */
  hook(b: Speedboat): boolean {
    if (!this.canHook(b)) return false;
    this.hooked = b;
    if (this.docked) { this.docked = false; this.vel = v3(); if (this.rider === "pier") { this.rider = "tube"; this.riderVel = v3(); } }
    return true;
  }
  /** desengata. Perto do píer da atividade e devagar, a boia volta a ser amarrada lá e a pessoa sobe no píer */
  unhook(): "none" | "pier" | "free" {
    if (!this.hooked) return "none";
    this.hooked = null; this.tension = 0;
    if (this.nearDock() && Math.hypot(this.vel.x, this.vel.z) < 2.5) { this.dock(); return "pier"; }
    return "free";
  }
  private nearDock(): boolean { const d = this.dockPos(); return Math.hypot(this.pos.x - d.x, this.pos.z - d.z) < 10; }
  /** volta para o píer: boia amarrada, pessoa em pé esperando */
  dock(): void {
    this.hooked = null; this.docked = true; this.vel = v3(); this.pos = this.dockPos(); this.yaw = Math.PI / 2; this.tension = 0;
    this.rider = "pier"; this.riderPos = this.waitPos(); this.riderVel = v3(); this.swimming = false; this.climbT = 0; this.latT = 0; this.latAcc = 0; this.bank = 0;
  }

  /** massa atual (com a pessoa, se ela está na boia) */
  get massNow(): number { return this.p.mass + (this.rider === "tube" || this.rider === "climbing" ? this.p.riderMass : 0); }

  step(dt: number, water: IWaterSurface, world: PhysicsWorld): void {
    const P = this.p;
    if (this.docked) {
      // amarrada: acompanha a superfície (só visual) e quem espera fica no píer
      const d = this.dockPos(); this.pos = v3(d.x, water.getHeight(d.x, d.z) + P.height * 0.2, d.z); this.vel = v3();
      this.tension = 0; this.airborne = false; this.bank *= 0.9;
      return;
    }
    const M = this.massNow;
    const v0 = this.vel;
    let F = v3(0, -M * G, 0);
    // ---- água ----
    const hw = water.getHeight(this.pos.x, this.pos.z);
    const bottom = this.pos.y - P.height / 2;
    const depth = hw - bottom;                       // > 0 = tocando a água
    const contact = depth > 0;
    const cur = water.getCurrent(this.pos.x, this.pos.z);
    const rel = sub(this.vel, cur);
    const vh = v3(rel.x, 0, rel.z), sh = len(vh);
    if (contact) {
      const sub01 = clamp(depth / P.height, 0, 1);
      F = add(F, v3(0, RHO * G * P.volume * sub01 - 900 * sub01 * rel.y, 0)); // empuxo + amortecimento vertical
      F = add(F, v3(0, P.planeLift * sh * sh * clamp(depth / (P.height * 0.4), 0, 1), 0)); // planeio
      const k = (P.dragLin + P.dragQuad * sh) * (0.35 + 0.65 * Math.min(1, sub01 * 2.5));
      F = add(F, scale(vh, -k));
    }
    const sp = len(this.vel);
    if (sp > 0.1) F = add(F, scale(this.vel, -0.5 * RHO_AIR * P.airCdA * sp));
    // ---- corda ----
    this.tension = 0;
    if (this.hooked) {
      const b = this.hooked;
      const tp = b.toWorld(TowTube.towLocal(b));
      const front = add(this.pos, v3(Math.sin(this.yaw) * P.radius, 0, Math.cos(this.yaw) * P.radius));
      const d = sub(tp, front), dist = len(d);
      if (dist > P.ropeLen && dist > 1e-3) {
        const dir = scale(d, 1 / dist);
        const vRel = dot(sub(b.pointVelocity(tp), this.vel), dir); // > 0 = afastando
        const T = Math.max(0, P.ropeK * (dist - P.ropeLen) + P.ropeC * vRel);
        this.tension = T;
        F = add(F, scale(dir, T));
        b.externalForces.push({ p: tp, f: scale(dir, -T) });
      }
      // a boia aponta para a corda (o ponto de reboque fica na frente dela)
      if (dist > 1) this.yaw = turnToward(this.yaw, Math.atan2(d.x, d.z), dt * 6);
    } else if (sh > 0.3) this.yaw = turnToward(this.yaw, Math.atan2(vh.x, vh.z), dt * 2);
    // ---- integração ----
    this.vel = add(this.vel, scale(F, dt / M));
    this.pos = add(this.pos, scale(this.vel, dt));
    // fundo/margem: a boia não entra no chão
    const g = world.groundHeight(this.pos.x, this.pos.z) + P.height / 2;
    if (this.pos.y < g) { this.pos = v3(this.pos.x, g, this.pos.z); if (this.vel.y < 0) this.vel = v3(this.vel.x * 0.8, 0, this.vel.z * 0.8); }

    // ---- quem vai na boia ----
    const acc = scale(sub(this.vel, v0), 1 / dt);
    const right = v3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const lat = dot(acc, right);
    this.latAcc += (lat - this.latAcc) * (1 - Math.exp(-dt / 0.2));
    this.bank += (clamp(-this.latAcc / 25, -0.5, 0.5) - this.bank) * (1 - Math.exp(-dt / 0.15));
    const air = !contact && this.pos.y - hw > P.height * 0.6;
    if (air) this.airVy = this.vel.y;
    const landed = this.wasAir && !air;
    this.wasAir = air; this.airborne = air;
    if (this.rider === "tube") {
      this.latT = Math.abs(this.latAcc) > P.fallLatG * G ? this.latT + dt : Math.max(0, this.latT - dt * 2);
      // chicotada: acima do limite por `fallLatT` s, ou um pico forte (1,4× o limite) que arranca na hora
      const why: TowTube["lastFall"] = this.latT > P.fallLatT || Math.abs(this.latAcc) > 1.4 * P.fallLatG * G ? "curva" : landed && this.airVy < -P.fallLandV ? "pulo" : this.tension > P.fallJerkN ? "tranco" : "";
      if (why) this.fall(why, right);
    }
    this.updateRider(dt, water);
  }

  /** a pessoa cai da boia: sai para fora da curva com parte da velocidade */
  private fall(why: "curva" | "pulo" | "tranco", right: Vec3): void {
    this.rider = "water"; this.falls++; this.lastFall = why; this.latT = 0; this.climbT = 0;
    const side = Math.sign(-this.latAcc) || 1; // a força para fora da curva é oposta à aceleração lateral
    this.riderPos = add(this.pos, scale(right, side * (this.p.radius + 0.3)));
    this.riderVel = scale(this.vel, 0.55);
  }

  private updateRider(dt: number, water: IWaterSurface): void {
    if (this.rider === "tube") { this.riderPos = add(this.pos, v3(0, this.p.height * 0.5, 0)); this.riderYaw = this.yaw; this.swimming = false; return; }
    if (this.rider === "pier") { this.riderPos = this.waitPos(); this.riderYaw = -Math.PI / 2; this.swimming = false; return; }
    if (this.rider === "climbing") {
      this.climbT += dt; this.riderPos = add(this.pos, v3(0, 0, 0)); this.swimming = false;
      if (Math.hypot(this.vel.x, this.vel.z) > 2) { this.rider = "water"; this.climbT = 0; return; } // a boia arrancou: cai de novo
      if (this.climbT >= this.p.climbS) { this.rider = "tube"; this.climbT = 0; }
      return;
    }
    // na água: o colete segura; a água freia o deslize; com a boia devagar, nada até ela
    const cur = water.getCurrent(this.riderPos.x, this.riderPos.z);
    const rv = sub(this.riderVel, cur);
    this.riderVel = sub(this.riderVel, scale(v3(rv.x, 0, rv.z), Math.min(1, dt * 1.6)));
    const d = sub(this.pos, this.riderPos), dist = Math.hypot(d.x, d.z);
    const tubeSlow = Math.hypot(this.vel.x, this.vel.z) < 1.5;
    this.swimming = tubeSlow && dist > this.p.radius + 0.5;
    let sw = v3();
    if (this.swimming) { sw = v3(d.x / dist * SWIM_MS, 0, d.z / dist * SWIM_MS); this.riderYaw = Math.atan2(d.x, d.z); }
    const slide = Math.hypot(this.riderVel.x, this.riderVel.z);
    this.riderPos = add(this.riderPos, scale(add(slide > SWIM_MS ? this.riderVel : add(this.riderVel, sw), cur), dt));
    this.riderPos = v3(this.riderPos.x, water.getHeight(this.riderPos.x, this.riderPos.z), this.riderPos.z);
    if (dist < this.p.radius + 0.6 && Math.hypot(this.vel.x, this.vel.z) < 1.0) { this.rider = "climbing"; this.climbT = 0; this.riderVel = v3(); }
  }
}

const turnToward = (a: number, b: number, k: number): number => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * Math.min(1, k);
};
