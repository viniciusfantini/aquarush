// PARASAIL — segunda atividade do jogo (v0.74). Sem Babylon: roda no Node para os testes.
//
// Quem voa é um corpo com massa (pessoa + cadeirinha + velame) preso por uma CORDA longa (mola que só puxa, com
// amortecimento) à popa do veículo; a reação vai para o barco (`Speedboat.externalForces`). Tudo por forças:
//  • peso;
//  • velame (paraquedas de parasail, `PARASAIL.area`): sustentação perpendicular ao vento relativo, no plano vertical
//    que o contém, e arrasto ao longo dele, os dois ∝ ½ρ·S·v² e × o quanto o velame está ABERTO (`infl`, 0..1);
//    o velame abre com vento relativo (~0,8 s no ar, devagar e só rebocado rápido na água — molhado pesa) e murcha
//    quando falta vento ou cai na água;
//  • na água: colete (empuxo até ~60 cm), amortecimento, arrasto (a pessoa "esquia" de costas quando é puxada) e o
//    velame murcho vira âncora d'água;
//  • deck do píer e terreno como apoio com atrito (o píer é de onde ela decola).
// Decolagem: no píer a equipe segura o velame meio aberto; o barco engata a corda (G), sai devagar para esticar e acelera:
// a corda arrasta a pessoa pela plataforma e, com vento relativo bastando (~24 km/h), ela sobe. Devagar demais ela cai
// na água — e decola de novo da água se o barco acelerar. Corda solta (G de novo) no ar: desce de paraquedas e cai na
// água; perto do píer, nada até ele e sobe; soltando com ela no píer ou na água perto dele, volta a esperar no píer.

import { type Vec3, v3, add, sub, scale, len, dot, clamp, normalize } from "./math.ts";
import { G, type IWaterSurface } from "./water.ts";
import type { PhysicsWorld, PierLayout } from "./world.ts";
import type { Speedboat } from "./boat.ts";
import { TowTube } from "./towTube.ts";

export interface ParasailParams {
  mass: number;        // pessoa + cadeirinha + velame (kg)
  area: number;        // área do velame (m²)
  cl: number;          // coeficiente de sustentação com o velame aberto
  cd0: number;         // arrasto com o velame fechado (pessoa + pano)
  cd: number;          // arrasto extra com o velame aberto
  inflAirS: number;    // tempo para abrir no ar (s)
  inflWaterS: number;  // tempo para abrir saindo da água (s)
  deflS: number;       // tempo para murchar (s)
  openV: number;       // vento relativo mínimo para o velame abrir (m/s)
  ropeLen: number;     // corda (m)
  ropeK: number;       // rigidez (N/m)
  ropeC: number;       // amortecimento (N·s/m)
  vestN: number;       // empuxo do colete por metro de imersão (N/m, até 0,6 m)
  waterLin: number;    // arrasto da pessoa na água (N·s/m)
  waterQuad: number;   // (N·s²/m²)
  skimLift: number;    // "esqui" da pessoa puxada na água (N por (m/s)²)
  canopyDrag: number;  // velame murcho dentro d'água (N por (m/s)²)
  deckMu: number;      // atrito no deck/chão
}

export const PARASAIL: ParasailParams = {
  mass: 98, area: 38, cl: 1.0, cd0: 0.2, cd: 0.8,
  inflAirS: 0.8, inflWaterS: 2.5, deflS: 1.5, openV: 3,
  ropeLen: 45, ropeK: 2500, ropeC: 300,
  vestN: 1800, waterLin: 60, waterQuad: 25, skimLift: 30, canopyDrag: 25,
  deckMu: 0.6,
};

export type FlyerState = "pier" | "air" | "water";
const RHO_AIR = 1.2, SWIM_MS = 1.1;
/** altura da cadeirinha (centro de massa) acima dos pés */
export const HARNESS_H = 1.0;

export class Parasail {
  readonly p: ParasailParams;
  readonly pier: PierLayout;
  /** posição da cadeirinha (centro de massa, mundo) */
  pos: Vec3;
  vel: Vec3 = v3();
  hooked: Speedboat | null = null;
  /** esperando no píer (sem física) */
  docked = true;
  state: FlyerState = "pier";
  /** velame aberto (0..1) */
  infl = 0;
  /** direção do velame a partir da cadeirinha (mundo, unitária) — a resultante aerodinâmica, suavizada */
  canopyDir: Vec3 = v3(0, 0, -1);
  /** telemetria */
  tension = 0;
  airspeed = 0;
  /** altura da cadeirinha sobre a água (m) */
  altitude = 0;
  maxAlt = 0;
  /** quedas na água (vindo do ar) e a velocidade vertical ao tocar */
  splashes = 0;
  lastSplashV = 0;
  swimming = false;
  private yawV = 0;

  constructor(pier: PierLayout, p: ParasailParams = PARASAIL) {
    this.p = p; this.pier = pier;
    this.pos = this.launchPos();
  }

  /** onde a pessoa espera / decola: na plataforma da ponta do píer (cadeirinha) */
  launchPos(): Vec3 { const P = this.pier; return v3(P.shoreX, P.deckY + HARNESS_H, P.shoreZ + P.length - 2); }
  get yaw(): number { return this.yawV; }

  canHook(b: Speedboat): boolean {
    if (this.hooked) return false;
    const tp = b.toWorld(TowTube.towLocal(b));
    const speed = Math.hypot(b.vel.x, b.vel.z);
    return speed < 1.5 && Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z) < (this.docked ? 16 : 10);
  }
  hook(b: Speedboat): boolean {
    if (!this.canHook(b)) return false;
    this.hooked = b;
    if (this.docked) { this.docked = false; this.vel = v3(); }
    return true;
  }
  /** solta a corda. Com a pessoa no píer, ou na água perto dele e devagar, ela volta a esperar no píer */
  unhook(): "none" | "pier" | "free" {
    if (!this.hooked) return "none";
    this.hooked = null; this.tension = 0;
    if (this.state !== "air" && this.nearPier(15) && Math.hypot(this.vel.x, this.vel.z) < 2.5) { this.dock(); return "pier"; }
    return "free";
  }
  private nearPier(r: number): boolean { const L = this.launchPos(); return Math.hypot(this.pos.x - L.x, this.pos.z - L.z) < r; }
  dock(): void {
    this.hooked = null; this.docked = true; this.state = "pier"; this.pos = this.launchPos(); this.vel = v3();
    this.infl = 0; this.tension = 0; this.swimming = false; this.canopyDir = v3(0, 0, -1); this.yawV = 0; this.altitude = 0;
  }

  private onDeck(x: number, z: number): boolean {
    const P = this.pier;
    return Math.abs(x - P.shoreX) < P.width / 2 && z > P.shoreZ - 3 && z < P.shoreZ + P.length;
  }

  step(dt: number, water: IWaterSurface, world: PhysicsWorld): void {
    const P = this.p;
    if (this.docked) {
      this.pos = this.launchPos(); this.vel = v3(); this.state = "pier"; this.tension = 0; this.airspeed = 0; this.altitude = 0;
      this.infl += (0 - this.infl) * Math.min(1, dt / P.deflS);
      return;
    }
    const M = P.mass;
    let F = v3(0, -M * G, 0);
    const hw = water.getHeight(this.pos.x, this.pos.z);
    const wind = world.wind ?? v3();
    const va = sub(this.vel, v3(wind.x, 0, wind.z));
    const V = len(va);
    this.airspeed = V;
    // ---- água (colete no peito, ~0,3 m abaixo da cadeirinha) ----
    const depth = hw - (this.pos.y - 0.3);
    const inWater = depth > 0;
    const cur = water.getCurrent(this.pos.x, this.pos.z);
    const rel = sub(this.vel, cur), vh = v3(rel.x, 0, rel.z), sh = len(vh);
    if (inWater) {
      const d = clamp(depth, 0, 0.6);
      F = add(F, v3(0, P.vestN * d - 500 * rel.y, 0));
      F = add(F, v3(0, P.skimLift * sh * sh * clamp(depth / 0.3, 0, 1), 0));
      F = add(F, scale(vh, -(P.waterLin + P.waterQuad * sh)));
      if (this.infl < 0.6) F = add(F, scale(vh, -P.canopyDrag * sh * (1 - this.infl / 0.6))); // velame murcho = âncora
    }
    // ---- velame ----
    // na plataforma a equipe segura o velame aberto em leque, baixo (0,25); quando a corda estica e puxa, eles soltam
    // e ele enche (0,6) — antes ele já ficava meio inflado de pé com o barco parado
    const held = this.state === "pier" && this.hooked ? (this.tension > 150 ? 0.6 : 0.25) : 0;
    const want = inWater ? (sh > 4.5 && this.hooked ? 1 : 0) : V > P.openV ? 1 : 0;
    const target = Math.max(want, held);
    const tau = target > this.infl ? (inWater ? P.inflWaterS : P.inflAirS) : P.deflS;
    this.infl += (target - this.infl) * Math.min(1, dt / tau);
    let aero = v3();
    if (V > 0.3) {
      const vhat = scale(va, 1 / V), q = 0.5 * RHO_AIR * V * V * P.area;
      const up = v3(0, 1, 0), lperp = sub(up, scale(vhat, dot(up, vhat)));
      const ll = len(lperp);
      const lift = ll > 1e-3 ? scale(lperp, (q * P.cl * this.infl) / ll) : v3();
      const drag = scale(vhat, -q * (P.cd0 + P.cd * this.infl));
      aero = add(lift, drag);
      F = add(F, aero);
    }
    // direção do velame (visual): a resultante aerodinâmica; sem vento, deitado atrás
    const ad = len(aero) > 50 ? normalize(aero) : V > 0.5 ? normalize(v3(-va.x, 0.15, -va.z)) : this.canopyDir;
    this.canopyDir = normalize(add(this.canopyDir, scale(sub(ad, this.canopyDir), Math.min(1, dt * 3))));
    // ---- corda ----
    this.tension = 0;
    if (this.hooked) {
      const b = this.hooked, tp = b.toWorld(TowTube.towLocal(b));
      const d = sub(tp, this.pos), dist = len(d);
      if (dist > P.ropeLen) {
        const dir = scale(d, 1 / dist);
        const vRel = dot(sub(b.pointVelocity(tp), this.vel), dir);
        const T = Math.max(0, P.ropeK * (dist - P.ropeLen) + P.ropeC * vRel);
        this.tension = T;
        F = add(F, scale(dir, T));
        TowTube.applyTow(b, scale(dir, -T));
      }
      if (Math.hypot(d.x, d.z) > 1) this.yawV = Math.atan2(d.x, d.z);
    } else if (sh > 0.5) this.yawV = Math.atan2(vh.x, vh.z);
    // ---- na água, solta: nada até o píer se ele estiver perto ----
    this.swimming = false;
    if (!this.hooked && inWater && this.nearPier(40)) {
      const L = this.launchPos(), dx = L.x - this.pos.x, dz = L.z - 1 - this.pos.z, dd = Math.hypot(dx, dz);
      if (dd > 2.5) {
        this.swimming = true; this.yawV = Math.atan2(dx, dz);
        const want = v3(dx / dd * SWIM_MS, 0, dz / dd * SWIM_MS);
        F = add(F, scale(sub(want, v3(rel.x, 0, rel.z)), M * 2)); // braçadas: aproxima a velocidade de nado
      } else { this.dock(); return; } // chegou: sobe no píer
    }
    // ---- integração ----
    this.vel = add(this.vel, scale(F, dt / M));
    this.pos = add(this.pos, scale(this.vel, dt));
    // ---- apoio: deck do píer e terreno ----
    let floor = world.groundHeight(this.pos.x, this.pos.z) + HARNESS_H * 0.3;
    let deck = false;
    const P2 = this.pier;
    if (this.onDeck(this.pos.x, this.pos.z) && this.pos.y > P2.deckY + HARNESS_H - 0.7) { floor = Math.max(floor, P2.deckY + HARNESS_H); deck = true; }
    if (this.pos.y < floor) {
      this.pos = v3(this.pos.x, floor, this.pos.z);
      if (this.vel.y < 0) this.vel = v3(this.vel.x, 0, this.vel.z);
      // atrito (só o peso que sobra: com o velame sustentando, ele quase não apoia)
      const N = Math.max(0, M * G - (aero.y > 0 ? aero.y : 0));
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > 1e-3) { const dv = Math.min(hs, (P.deckMu * N / M) * dt); this.vel = v3(this.vel.x * (1 - dv / hs), this.vel.y, this.vel.z * (1 - dv / hs)); }
    }
    // ---- estado ----
    const hw2 = water.getHeight(this.pos.x, this.pos.z);
    const wet = hw2 - (this.pos.y - 0.3) > 0;
    const prev = this.state;
    this.state = deck && this.pos.y <= floor + 0.02 ? "pier" : wet ? "water" : "air";
    if (this.state === "water" && prev === "air") { this.splashes++; this.lastSplashV = this.vel.y; }
    this.altitude = this.pos.y - hw2;
    if (this.state === "air") this.maxAlt = Math.max(this.maxAlt, this.altitude);
  }
}
