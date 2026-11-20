// WAKEBOARD — terceira atividade (v0.77). Sem Babylon: roda no Node para os testes.
//
// Quem anda é um ponto com massa (pessoa + prancha) puxado por uma CORDA de 20 m (mola que só puxa) presa no ponto de
// reboque do barco (na lancha de wakeboard AR-8, no alto da torre targa); a reação vai para o barco (`TowTube.applyTow`).
//  • Na água, segurando o manete ("water"): boia de colete com a prancha à frente; com o barco PARADO ela fica afundada
//    esperando. Quando a corda puxa com velocidade (> 3,5 m/s), ela sobe na prancha ("rising", ~1,5 s) e fica em pé.
//  • Em pé ("riding"): a prancha plana na superfície (acompanha a altura da água + a ESTEIRA NOVA do barco,
//    `WakeField.heightAtYoung`), arrasto ∝ v², e a pessoa "canta" a borda da prancha: força lateral que a leva para
//    fora da esteira e de volta, cruzando-a. Ela anda SOZINHA: escolhe um lado, corta para dentro, sobe a marola e
//    PULA ("air"): a velocidade vertical da superfície ao passar a crista + o impulso das pernas lançam ela; no ar faz uma
//    manobra (giro de 360°, backroll ou grab, conforme o tempo de voo esperado) e aterrissa do outro lado.
//  • QUEDA ("fallen"): aterrissagem forte (vy < −`fallLandV`), manobra que não completou no ar, ou um TRANCO de verdade
//    na corda (estava frouxa e esticou de repente, ou passou muito do que dá para segurar) — puxada firme com a corda
//    esticada ela aguenta (é assim que se sai da água).
//    Ela solta o manete e fica boiando; o manete fica na ponta da corda, arrastado pelo barco. Para ela "pegar" de novo,
//    passe com a corda por ela (manete a < `grabR` m dela e devagar): ela segura e sai de novo da água.
//  • Píer próprio: engatando (G) no píer ela pula na água com o manete; soltando (G) perto do píer ela volta nadando.

import { type Vec3, v3, add, sub, scale, len, dot, clamp, normalize } from "./math.ts";
import { G, type IWaterSurface } from "./water.ts";
import type { PhysicsWorld, PierLayout } from "./world.ts";
import type { Speedboat } from "./boat.ts";
import type { WakeField } from "./wake.ts";
import { TowTube } from "./towTube.ts";

export interface WakeboardParams {
  mass: number;        // pessoa + prancha (kg)
  ropeLen: number;     // corda (m)
  ropeK: number;       // rigidez (N/m)
  ropeC: number;       // amortecimento (N·s/m)
  boardCd: number;     // arrasto da prancha planando (N por (m/s)²)
  waterLin: number;    // arrasto na água sentada (N·s/m)
  waterQuad: number;   // (N·s²/m²)
  edgeAcc: number;     // aceleração lateral máxima cantando a borda (m/s²)
  riseV: number;       // velocidade para começar a subir (m/s)
  riseS: number;       // tempo para ficar em pé (s)
  sinkV: number;       // abaixo desta velocidade a prancha não plana mais e ela afunda (m/s)
  sinkS: number;       // tempo para afundar de em pé até a água (s)
  popV: number;        // impulso das pernas no pulo (m/s)
  fallLandV: number;   // aterrissagem que derruba (m/s, para baixo)
  fallJerkN: number;   // tranco: pico de tensão logo depois da corda frouxa que derruba (N); 1,9× isso derruba sempre
  grabR: number;       // distância para pegar o manete (m)
  cutOffset: number;   // até onde ela vai para os lados da esteira (m, do centro)
}

export const WAKEBOARD: WakeboardParams = {
  mass: 85, ropeLen: 20, ropeK: 2200, ropeC: 300,
  boardCd: 4.2, waterLin: 90, waterQuad: 45,
  edgeAcc: 4.5, riseV: 5.0, riseS: 2.4, sinkV: 4.2, sinkS: 0.9, popV: 1.1,
  fallLandV: 7.0, fallJerkN: 3800, grabR: 2.2, cutOffset: 7,
};

export type RiderState = "pier" | "water" | "rising" | "riding" | "air" | "fallen";
export type TrickKind = "" | "180" | "360" | "backroll" | "grab";
const SWIM_MS = 1.1;

/** RNG determinístico (os testes repetem o mesmo resultado) */
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export class Wakeboard {
  readonly p: WakeboardParams;
  readonly pier: PierLayout;
  pos: Vec3;
  vel: Vec3 = v3();
  /** rumo da prancha (rad, mundo) */
  yaw = 0;
  hooked: Speedboat | null = null;
  docked = true;
  state: RiderState = "pier";
  /** manete na ponta da corda quando ela caiu (mundo) */
  handle: Vec3 = v3();
  private handleVel: Vec3 = v3();
  /** subindo na prancha 0..1 */
  rise = 0;
  /** manobra no ar: tipo e progresso 0..1 (o visual gira a pessoa por isto) */
  trick: TrickKind = "";
  trickT = 0;
  private trickDur = 0;
  airT = 0;
  /** telemetria */
  tension = 0;
  speed = 0;
  /** distância lateral da esteira (m, + = boreste do barco) */
  offset = 0;
  /** altura da esteira sob ela (m) */
  wakeH = 0;
  jumps = 0;
  falls = 0;
  lastFall: "" | "aterrissagem" | "manobra" | "tranco" = "";
  lastTrick: TrickKind = "";
  maxAir = 0;
  swimming = false;
  /** base: pé esquerdo à frente (true) ou "switch"/direito à frente (false) — a prancha é bidirecional: depois de um
   *  180 ela segue andando com o outro pé na frente */
  regular = true;
  /** aceleração lateral da borda (m/s², mundo) — o visual inclina a prancha e o corpo por ela */
  edgeAx = 0;
  edgeAz = 0;
  /** agachamento 0..1 (carrega antes da marola, estica no impulso, encolhe no ar, absorve na aterrissagem) */
  crouch = 0.35;
  /** lado para onde ela está indo (+1/−1) */
  private side = 1;
  private sideT = 0;
  private lastSurfY = 0;
  private dhdtPrev = 0;
  private landVy = 0;
  /** há quanto tempo a corda está esticada (s) — para saber se uma tensão alta é tranco ou puxada firme */
  private slackT = 99;
  /** cortando para o centro da esteira (é só aí que ela pula) */
  private inward = false;
  /** tempo desde a queda (s): logo depois ela ainda está se recuperando e não pega o manete */
  private fallenT = 0;
  /** altura de onde ela decolou e a superfície sob ela no passo anterior (para a aterrissagem relativa) */
  private takeoffY = 0;
  private airSurfPrev = 0;
  private landing = 0;
  private readonly rand = rng(7);

  constructor(pier: PierLayout, p: WakeboardParams = WAKEBOARD) {
    this.p = p; this.pier = pier;
    this.pos = this.waitPos();
  }

  /** onde ela espera, em pé no píer (pés) */
  waitPos(): Vec3 { const P = this.pier; return v3(P.shoreX, P.deckY, P.shoreZ + P.length - 2); }
  /** onde ela entra na água ao engatar: na frente da ponta do píer */
  private jumpInPos(): Vec3 { const P = this.pier; return v3(P.shoreX, 0, P.shoreZ + P.length + 2.5); }
  /** segurando o manete? */
  get holding(): boolean { return this.state === "water" || this.state === "rising" || this.state === "riding" || this.state === "air"; }

  canHook(b: Speedboat): boolean {
    if (this.hooked) return false;
    const tp = b.toWorld(TowTube.towLocal(b));
    const speed = Math.hypot(b.vel.x, b.vel.z);
    const target = this.docked ? this.waitPos() : this.pos;
    return speed < 1.5 && Math.hypot(tp.x - target.x, tp.z - target.z) < (this.docked ? 16 : 10);
  }
  hook(b: Speedboat): boolean {
    if (!this.canHook(b)) return false;
    this.hooked = b;
    if (this.docked) { this.docked = false; this.pos = this.jumpInPos(); this.vel = v3(); }
    this.state = "water"; this.rise = 0; this.swimming = false;
    return true;
  }
  /** solta a corda. Perto do píer, ela volta nadando para ele */
  unhook(): "none" | "pier" | "free" {
    if (!this.hooked) return "none";
    this.hooked = null; this.tension = 0;
    if (this.state !== "water" && this.state !== "fallen") { this.state = "fallen"; }
    else this.state = "fallen";
    return this.nearPier(40) ? "pier" : "free";
  }
  private nearPier(r: number): boolean { const L = this.waitPos(); return Math.hypot(this.pos.x - L.x, this.pos.z - L.z) < r; }
  dock(): void {
    this.hooked = null; this.docked = true; this.state = "pier"; this.pos = this.waitPos(); this.vel = v3(); this.tension = 0;
    this.rise = 0; this.trick = ""; this.trickT = 0; this.airT = 0; this.swimming = false; this.yaw = 0;
  }

  /** idade máxima da esteira somada por cima da água (no jogo a água da física já tem a esteira de ≥ 3 s: só falta a
   *  nova; nos testes, com a água sem esteira, soma tudo até 8 s) */
  wakeMaxAge = 8;
  /** amostra de esteira da prancha: só planando na água (não no ar, nem afundada/caída) — um rastro só, de espuma */
  wakeSample(): import("./wake.ts").WakeSample | null {
    if (this.docked || this.state !== "riding") return null;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), v = this.speed;
    return { bx: this.pos.x + fx * 0.69, bz: this.pos.z + fz * 0.69, sx: this.pos.x - fx * 0.69, sz: this.pos.z - fz * 0.69, rx: fz, rz: -fx,
      // (v0.77.5: `size` 0 = sem os braços do V — eram 3 rastros atrás da prancha; fica UM, o de espuma do meio)
      v, thr: Math.min(1, Math.hypot(this.edgeAx, this.edgeAz) / 4) * 0.8 + 0.2, boil: 0, exh: 0, wet: 1, air: 0, span: 0, age: 0, size: 0 };
  }

  /** altura da superfície (água + esteira nova do barco) */
  private surf(water: IWaterSurface, wake: WakeField | null, x: number, z: number): number {
    return water.getHeight(x, z) + (wake ? wake.heightAtYoung(x, z, this.wakeMaxAge) : 0);
  }

  step(dt: number, water: IWaterSurface, world: PhysicsWorld, wake: WakeField | null = null): void {
    const P = this.p;
    if (this.docked) { this.pos = this.waitPos(); this.vel = v3(); this.state = "pier"; this.tension = 0; return; }
    const b = this.hooked;
    const M = P.mass;
    const sy = this.surf(water, wake, this.pos.x, this.pos.z);
    this.wakeH = wake ? wake.heightAtYoung(this.pos.x, this.pos.z, this.wakeMaxAge) : 0;
    const cur = water.getCurrent(this.pos.x, this.pos.z);
    let F = v3(0, -M * G, 0);
    this.tension = 0;
    // ---- corda (só se ela segura o manete) ----
    let ropeDir = v3(), apex = v3();
    if (b) {
      apex = b.toWorld(TowTube.towLocal(b));
      const hands = add(this.pos, v3(0, this.state === "riding" || this.state === "air" ? 1.0 : 0.3, 0));
      if (this.holding) {
        const d = sub(apex, hands), dist = len(d);
        ropeDir = dist > 1e-3 ? scale(d, 1 / dist) : v3();
        if (dist > P.ropeLen) {
          const vRel = dot(sub(b.pointVelocity(apex), this.vel), ropeDir);
          const T = Math.max(0, P.ropeK * (dist - P.ropeLen) + P.ropeC * vRel);
          this.tension = T;
          F = add(F, scale(ropeDir, T));
          TowTube.applyTow(b, scale(ropeDir, -T));
        }
      }
      // lado da esteira em relação ao barco (para as manobras)
      const r = b.right, rel = sub(this.pos, b.pos);
      this.offset = dot(rel, v3(r.x, 0, r.z));
    }
    const rel = sub(this.vel, cur), vh = v3(rel.x, 0, rel.z), sh = len(vh);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // ---- por estado ----
    if (this.state === "water" || this.state === "fallen") {
      // boiando de colete (sentada, prancha à frente): empuxo até a superfície e muito arrasto
      const depth = sy - (this.pos.y - 0.2);
      F = add(F, v3(0, M * G * clamp(1 + depth * 2.5, 0, 2.2) - 260 * rel.y, 0));
      F = add(F, scale(vh, -(P.waterLin + P.waterQuad * sh)));
      // segurando o manete com o barco puxando rápido: começa a subir na prancha
      // começa a sair com a corda puxando e ~14 km/h (a prancha ainda "ara" a água: o barco precisa vencer isso)
      if (this.state === "water" && this.tension > 200 && this.speed > P.sinkV * 0.9) { this.state = "rising"; this.rise = 0; }
      // caída: nada até o píer se ele estiver perto e ninguém reboca
      this.swimming = false;
      // caída com a corda engatada: SEMPRE nada na direção do manete (para pegá-lo quando o barco passar devagar)
      if (this.state === "fallen" && b) {
        const dx = this.handle.x - this.pos.x, dz = this.handle.z - this.pos.z, dd = Math.hypot(dx, dz);
        if (dd > 0.8) { this.swimming = true; this.yaw = Math.atan2(dx, dz); F = add(F, scale(sub(v3(dx / dd * SWIM_MS, 0, dz / dd * SWIM_MS), vh), M * 2)); }
      }
      if (this.state === "fallen" && !b && this.nearPier(40)) {
        const L = this.waitPos(), dx = L.x - this.pos.x, dz = L.z - 1 - this.pos.z, dd = Math.hypot(dx, dz);
        if (dd > 2.5) { this.swimming = true; this.yaw = Math.atan2(dx, dz); F = add(F, scale(sub(v3(dx / dd * SWIM_MS, 0, dz / dd * SWIM_MS), vh), M * 2)); }
        else { this.dock(); return; }
      }
    } else if (this.state === "rising") {
      // saindo da água (ou afundando): com velocidade para planar a prancha sobe e ela fica em pé; sem ela, afunda.
      // A prancha atravessada ainda empurra muita água: o arrasto é alto até ela estar em pé (sair é DIFÍCIL)
      if (this.speed >= P.riseV) this.rise = Math.min(1, this.rise + dt / P.riseS);
      else if (this.speed >= P.sinkV * 0.9) this.rise = Math.min(1, this.rise + 0.4 * dt / P.riseS); // sofrendo: sobe devagar
      else this.rise = Math.max(0, this.rise - dt / P.sinkS);
      const depth = sy - (this.pos.y - 0.2 * (1 - this.rise));
      F = add(F, v3(0, M * G * clamp(1 + depth * 3, 0, 2.5) - 300 * rel.y, 0));
      const plow = 1 - this.rise; // prancha atravessada, "arado" de água
      F = add(F, scale(vh, -(P.waterLin * plow * 1.6 + P.boardCd * sh + P.waterQuad * plow * 1.6 * sh)));
      if (this.rise <= 0) { this.state = "water"; this.rise = 0; }
      else if (this.rise >= 1) { this.state = "riding"; this.lastSurfY = sy; this.dhdtPrev = 0; }
    } else if (this.state === "riding") {
      // planando: segue a superfície (a prancha não afunda) e anda para onde a borda leva
      const dhdt = (sy - this.lastSurfY) / dt;
      this.lastSurfY = sy;
      F = add(F, scale(vh, -P.boardCd * sh));
      F = add(F, v3(0, M * G, 0)); // a água sustenta a prancha (a altura é a da superfície, abaixo)
      // "IA": cruza a esteira de um lado para o outro; ao chegar no lado escolhido, vira e corta de volta
      if (b) {
        this.sideT += dt;
        const target = this.side * P.cutOffset;
        if ((this.side > 0 && this.offset > target - 0.8) || (this.side < 0 && this.offset < target + 0.8) || this.sideT > 7) { this.side = -this.side as 1 | -1; this.sideT = 0; }
        const r = b.right, rh = normalize(v3(r.x, 0, r.z));
        // (a velocidade lateral é medida em relação ao barco: ela corta a esteira, não "corre" do barco)
        const bl = dot(b.vel, rh), vLat = dot(this.vel, rh) - bl, want = clamp((this.side * P.cutOffset - this.offset) * 0.8, -4, 4);
        const ea = clamp((want - vLat) * 1.8, -P.edgeAcc, P.edgeAcc);
        F = add(F, scale(rh, M * ea));
        this.edgeAx += (rh.x * ea - this.edgeAx) * Math.min(1, dt * 6);
        this.edgeAz += (rh.z * ea - this.edgeAz) * Math.min(1, dt * 6);
        this.inward = vLat * this.offset < 0 && Math.abs(vLat) > 2; // cortando para o centro da esteira, com força
        // agachamento: carrega cortando para dentro, perto da marola; senão a postura normal (joelhos meio dobrados)
        const wantC = this.landing > 0 ? 0.85 : this.inward && Math.abs(this.offset) < 4 ? 0.65 : 0.35;
        this.crouch += (wantC - this.crouch) * Math.min(1, dt * 5);
      }
      // PULO: cortando forte e passando a crista da marola (a superfície sobe e para de subir)
      // (só cortando PARA DENTRO — saindo para fora ela passa por cima da marola sem pular, como na vida real)
      if (this.dhdtPrev > 1.0 && dhdt <= 0.2 && this.speed > 5 && this.landing <= 0 && this.inward) {
        // (as pernas absorvem parte da rampa: a subida da marola entra pela metade, até ~4,5 m/s — pulo de ~1 m)
        const vy = Math.min(3.8, this.dhdtPrev * 0.55 + P.popV);
        this.vel = v3(this.vel.x, vy, this.vel.z);
        this.state = "air"; this.airT = 0; this.jumps++; this.takeoffY = this.pos.y; this.airSurfPrev = sy; this.crouch = 0; // estica no impulso
        // tempo de voo esperado decide a manobra
        const tAir = (2 * vy) / G;
        const roll = this.rand();
        // (escolhe a manobra que cabe no voo esperado, com margem: backroll 0,65 s, 360 0,5 s, 180 0,36 s, grab 0,3 s)
        this.trick = tAir > 0.74 && roll < 0.4 ? "backroll" : tAir > 0.6 && roll < 0.7 ? "360" : tAir > 0.45 && roll < 0.85 ? "180" : "grab";
        this.trickDur = this.trick === "backroll" ? 0.65 : this.trick === "360" ? 0.5 : this.trick === "180" ? 0.36 : 0.3;
        this.trickT = 0; this.lastTrick = this.trick;
      }
      this.dhdtPrev = dhdt;
      if (this.speed < P.sinkV) { this.state = "rising"; this.rise = 1; } // devagar demais: a prancha para de planar e ela vai afundando
    } else if (this.state === "air") {
      this.airT += dt;
      this.crouch += (0.55 - this.crouch) * Math.min(1, dt * 8); // encolhe as pernas no ar
      this.trickT = Math.min(1, this.airT / Math.max(0.1, this.trickDur));
      F = add(F, scale(this.vel, -0.5 * 1.2 * 0.6 * len(this.vel))); // ar
    }
    // ---- integração ----
    this.vel = add(this.vel, scale(F, dt / M));
    this.pos = add(this.pos, scale(this.vel, dt));
    const sy2 = this.surf(water, wake, this.pos.x, this.pos.z);
    if (this.state === "riding" || this.state === "rising" && this.rise > 0.7) {
      this.pos = v3(this.pos.x, sy2, this.pos.z);
      this.vel = v3(this.vel.x, 0, this.vel.z);
    }
    if (this.state === "air") {
      this.maxAir = Math.max(this.maxAir, this.pos.y - this.takeoffY); // altura do pulo (acima de onde decolou)
      const surfRate = (sy2 - this.airSurfPrev) / dt; // a superfície sob ela sobe/desce (descida da marola: negativa)
      this.airSurfPrev = sy2;
      if (this.pos.y <= sy2 && this.vel.y < 0) {
        // aterrissou: o impacto é a velocidade em relação à superfície (pousar na descida da marola amortece)
        this.landVy = this.vel.y - Math.min(0, surfRate);
        const incomplete = this.trick !== "grab" && this.trickT < 0.92;
        if (this.landVy < -P.fallLandV) this.fall("aterrissagem");
        else if (incomplete) this.fall("manobra");
        else {
          if (this.trick === "180") this.regular = !this.regular; // pousou de "switch": segue com o outro pé na frente
          this.state = "riding"; this.pos = v3(this.pos.x, sy2, this.pos.z); this.vel = v3(this.vel.x, 0, this.vel.z); this.lastSurfY = sy2; this.dhdtPrev = 0; this.landing = 0.8; this.crouch = 0.9;
        }
        this.trick = ""; this.trickT = 0;
      }
    }
    this.landing = Math.max(0, this.landing - dt);
    // tranco: a corda estava frouxa há pouco (< 0,6 s) e esticou acima do limite, ou passou muito do que dá para segurar.
    // Puxada firme com a corda esticada (saindo da água acelerando forte) NÃO derruba.
    if (this.holding) {
      if (this.tension < 80) this.slackT = 0; else this.slackT += dt;
      const snap = this.slackT < 0.6 && this.tension > P.fallJerkN;
      if ((snap || this.tension > P.fallJerkN * 1.9) && this.state !== "water") this.fall("tranco");
    }
    // rumo da prancha: para onde ela anda (devagar, aponta para a corda)
    if (this.speed > 1.5) this.yaw = Math.atan2(this.vel.x, this.vel.z);
    else if (b && this.holding) this.yaw = Math.atan2(ropeDir.x, ropeDir.z);
    // ---- manete solto (ela caiu): na ponta da corda, arrastado pelo barco; ela pega se ele passar perto ----
    if (this.state === "fallen" && b) {
      const d = sub(this.handle, apex), dist = len(d);
      this.handleVel = scale(this.handleVel, Math.exp(-dt * 1.5)); // a água freia
      this.handle = add(this.handle, scale(this.handleVel, dt));
      if (dist > P.ropeLen) {
        const np = add(apex, scale(d, P.ropeLen / dist));
        this.handleVel = scale(sub(np, this.handle), 1 / dt);
        this.handle = np;
      }
      this.handle = v3(this.handle.x, water.getHeight(this.handle.x, this.handle.z), this.handle.z);
      const hv = Math.hypot(this.handleVel.x, this.handleVel.z), bv = Math.hypot(b.vel.x, b.vel.z);
      this.fallenT += dt;
      // pega o manete se ele passar perto dela, devagar, com o barco devagar (o "passar com a corda" do piloto)
      if (this.fallenT > 1.5 && bv < 3.5 && hv < 3 && Math.hypot(this.handle.x - this.pos.x, this.handle.z - this.pos.z) < P.grabR) {
        this.state = "water"; this.rise = 0; // pegou o manete: sai de novo quando o barco puxar
      }
    } else this.handle = add(this.pos, v3(0, this.state === "riding" || this.state === "air" ? 1.0 : 0.3, 0));
    // fundo/margem
    const g = world.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y < g) { this.pos = v3(this.pos.x, g, this.pos.z); if (this.vel.y < 0) this.vel = v3(this.vel.x * 0.5, 0, this.vel.z * 0.5); }
  }

  private fall(why: "aterrissagem" | "manobra" | "tranco"): void {
    this.state = "fallen"; this.falls++; this.lastFall = why; this.trick = ""; this.trickT = 0; this.rise = 0; this.fallenT = 0;
    this.handle = add(this.pos, v3(0, 0.8, 0)); this.handleVel = scale(this.vel, 0.6);
    this.vel = scale(this.vel, 0.35); // a água freia o tombo
    this.tension = 0;
  }
}
