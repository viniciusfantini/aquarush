// Water Interaction: orquestra o mapa de esteira (deforma e espuma a própria água — wakeMap.ts)
// e as partículas: spray da proa, "rooster tail" da hélice, respingos de impacto e
// bolhas/névoa de cavitação e ventilação. Tudo dirigido pela telemetria real da simulação.

import { type Scene, DynamicTexture, Color4, ParticleSystem, Vector3, type Particle } from "@babylonjs/core";
import type { GerstnerWater, IWaterSurface } from "../sim/water.ts";
import type { Speedboat } from "../sim/boat.ts";
import { v3, clamp, smoothstep, type Vec3 } from "../sim/math.ts";
import { WakeMap } from "./wakeMap.ts";
import type { WakeField } from "../sim/wake.ts";

const softDot = (scene: Scene, name: string, hard = 0.4): DynamicTexture => {
  const s = 64;
  const tex = new DynamicTexture(name, { width: s, height: s }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(hard, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  tex.hasAlpha = true;
  tex.update();
  return tex;
};

/** Textura de gotas: vários pontinhos (spray parece água e não fumaça). */
const dropletTex = (scene: Scene): DynamicTexture => {
  const s = 64;
  const tex = new DynamicTexture("droplets", { width: s, height: s }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, s, s);
  let seed = 3;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.42;
    const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d, rad = 1 + r() * 3.2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  const mist = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  mist.addColorStop(0, "rgba(255,255,255,0.25)");
  mist.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, 0, s, s);
  tex.hasAlpha = true;
  tex.update();
  return tex;
};

interface PropFx { rooster: ParticleSystem; chop: ParticleSystem; mist: ParticleSystem; bubbles: ParticleSystem }
interface PropState { prop: Vec3; imm: number; cavitation: number; ventilation: number; throttle: number; thrustN: number; propRpm: number; running: boolean }

export class WaterInteraction {
  readonly wake: WakeMap;
  private readonly bowL: ParticleSystem;
  private readonly bowR: ParticleSystem;
  /** efeitos de cada hélice (rooster tail, leque das pás, névoa, bolhas): um conjunto por motor */
  private readonly props: PropFx[] = [];
  private readonly splash: ParticleSystem;
  private readonly telltale: ParticleSystem;
  private readonly drips: ParticleSystem;
  private dryTime = 99;
  /** superfície da água (física, com a esteira) para as partículas pararem nela */
  water: IWaterSurface | null = null;
  private lastImpact = 0;

  private readonly field: WakeField;

  constructor(scene: Scene, field: WakeField, quality: { particles: number; wakeTexture: number }) {
    this.field = field;
    this.wake = new WakeMap(scene, field, { size: quality.wakeTexture, worldSize: 320 });
    const drops = dropletTex(scene);
    const dot = softDot(scene, "softDot");
    const mk = (name: string, cap: number, tex: DynamicTexture, group = 1) => {
      const ps = new ParticleSystem(name, Math.max(16, cap), scene);
      ps.particleTexture = tex;
      ps.color1 = new Color4(1, 1, 1, 0.9);
      ps.color2 = new Color4(0.86, 0.93, 0.96, 0.75);
      ps.colorDead = new Color4(0.9, 0.95, 1, 0);
      ps.gravity = new Vector3(0, -9.81, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.minEmitBox = ps.maxEmitBox = Vector3.Zero();
      ps.emitter = Vector3.Zero();
      ps.emitRate = 0;
      ps.minAngularSpeed = -2; ps.maxAngularSpeed = 2;
      ps.renderingGroupId = group;
      ps.start();
      return ps;
    };
    const p = quality.particles;
    this.bowL = mk("sprayL", p * 0.25, drops);
    this.bowR = mk("sprayR", p * 0.25, drops);
    this.splash = mk("splash", p * 0.1, drops);
    this.telltale = mk("telltale", 600, dot);
    this.drips = mk("drips", 120, dot);
    // dois conjuntos de efeitos de hélice (o 2º só emite nos barcos de dois motores)
    for (let i = 0; i < 2; i++) {
      const sfx = i === 0 ? "" : String(i + 1);
      const fx: PropFx = {
        rooster: mk("rooster" + sfx, p * 0.2, drops),
        mist: mk("cavMist" + sfx, p * 0.1, dot),
        bubbles: mk("bubbles" + sfx, p * 0.1, dot, 0),
        chop: mk("propChop" + sfx, Math.max(200, p * 0.3), drops),
      };
      fx.rooster.minSize = 0.25; fx.rooster.maxSize = 0.9; fx.rooster.minLifeTime = 0.5; fx.rooster.maxLifeTime = 1.3;
      // névoa de cavitação/ventilação (sobe da popa)
      fx.mist.minSize = 0.6; fx.mist.maxSize = 1.8; fx.mist.minLifeTime = 0.6; fx.mist.maxLifeTime = 1.4;
      fx.mist.gravity = new Vector3(0, -1.5, 0);
      fx.mist.color1 = new Color4(1, 1, 1, 0.35); fx.mist.color2 = new Color4(0.9, 0.95, 1, 0.25);
      // bolhas: pequenas, sobem devagar (empuxo) atrás da hélice
      fx.bubbles.minSize = 0.04; fx.bubbles.maxSize = 0.14; fx.bubbles.minLifeTime = 0.4; fx.bubbles.maxLifeTime = 1.2;
      fx.bubbles.gravity = new Vector3(0, 2.5, 0);
      fx.bubbles.color1 = new Color4(0.85, 0.97, 1, 0.75); fx.bubbles.color2 = new Color4(0.7, 0.9, 0.95, 0.55);
      // hélice aflorando: as pás "picam" a superfície e jogam um leque de água para cima e para trás
      fx.chop.minSize = 0.06; fx.chop.maxSize = 0.3; fx.chop.minLifeTime = 0.35; fx.chop.maxLifeTime = 1.0;
      for (const ps of [fx.rooster, fx.mist, fx.chop]) this.clipToWater(ps, "fall");
      this.clipToWater(fx.bubbles, "rise");
      this.props.push(fx);
    }
    for (const ps of [this.bowL, this.bowR]) { ps.minSize = 0.12; ps.maxSize = 0.5; ps.minLifeTime = 0.3; ps.maxLifeTime = 0.85; }
    this.splash.minSize = 0.3; this.splash.maxSize = 1.1; this.splash.minLifeTime = 0.4; this.splash.maxLifeTime = 1.1;
    // gotas escorrendo do pé do motor depois que ele sai da água
    this.drips.minSize = 0.02; this.drips.maxSize = 0.04; this.drips.minLifeTime = 0.5; this.drips.maxLifeTime = 0.9;
    this.drips.minAngularSpeed = 0; this.drips.maxAngularSpeed = 0;
    this.drips.color1 = new Color4(0.9, 0.97, 1, 0.9); this.drips.color2 = new Color4(0.8, 0.92, 0.98, 0.8);
    // esguicho de refrigeração: jato fino e contínuo de gotas (bomba d'água do motor)
    this.telltale.minSize = 0.022; this.telltale.maxSize = 0.045;
    this.telltale.minLifeTime = 0.55; this.telltale.maxLifeTime = 0.8;
    this.telltale.minAngularSpeed = 0; this.telltale.maxAngularSpeed = 0;
    this.telltale.color1 = new Color4(0.9, 0.97, 1, 0.9); this.telltale.color2 = new Color4(0.8, 0.92, 0.98, 0.8);
    this.telltale.colorDead = new Color4(0.85, 0.95, 1, 0.2);
    // a água é uma superfície para as partículas: gota que cai nela para ali (vira respingo/bolha e some);
    // bolha que sobe estoura na superfície — nada atravessa e continua do outro lado
    for (const ps of [this.bowL, this.bowR, this.splash, this.telltale, this.drips]) this.clipToWater(ps, "fall");
  }

  /** Envolve o update da partícula: ao cruzar a superfície ela fica nela, sem velocidade vertical, e encolhe até sumir. */
  private clipToWater(ps: ParticleSystem, mode: "fall" | "rise"): void {
    const base = ps.updateFunction;
    ps.updateFunction = (particles: Particle[]) => {
      base(particles);
      const W = this.water;
      if (!W) return;
      for (const p of particles) {
        const h = W.getHeight(p.position.x, p.position.z);
        const crossed = mode === "fall" ? p.position.y < h : p.position.y > h;
        if (!crossed) continue;
        p.position.y = h + (mode === "fall" ? 0.005 : -0.005);
        p.direction.set(p.direction.x * 0.15, 0, p.direction.z * 0.15); // o impacto absorve o movimento
        p.size *= 0.82;                                                  // espalha/estoura: some em ~0,2 s
        if (p.size < 0.01) p.age = p.lifeTime;
      }
    };
  }

  /** Gotas escorrendo do pé do motor depois que ele sai da água (some em alguns segundos). */
  updateDrips(dt: number, lowestPoint: Vector3, immersion: number): void {
    this.dryTime = immersion > 0.3 ? 0 : this.dryTime + dt;
    this.drips.emitter = lowestPoint;
    this.drips.minEmitBox = new Vector3(-0.05, 0, -0.12); this.drips.maxEmitBox = new Vector3(0.05, 0, 0.12);
    this.drips.direction1 = new Vector3(-0.05, -0.2, -0.05); this.drips.direction2 = new Vector3(0.05, 0, 0.05);
    this.drips.emitRate = immersion < 0.05 ? 70 * Math.exp(-this.dryTime / 3.5) : 0;
  }

  /** Esguicho: posição do bico e direção do jato (mundo), vazão ∝ rotação da bomba d'água. */
  updateTelltale(nozzle: Vector3, dir: Vector3, rpm: number, boatVel: Vector3, pumping = true): void {
    const ps = this.telltale;
    ps.emitter = nozzle;
    // bomba d'água acionada pelo virabrequim: em lenta é um fio fraco que cai perto do capô;
    // a pressão (e o alcance) sobe com o RPM
    const r = Math.min(Math.max((rpm - 750) / 5050, 0), 1);
    const v = 0.35 + 1.25 * r; // m/s
    const d = dir.normalize();
    ps.direction1 = d.scale(v).add(new Vector3(0, 0.05, 0)).add(boatVel);
    ps.direction2 = d.scale(v * 1.06).add(new Vector3(0, 0.12, 0)).add(boatVel);
    ps.minEmitPower = ps.maxEmitPower = 1;
    ps.emitRate = rpm > 300 && pumping ? 110 + 230 * r : 0;
    ps.minSize = 0.014 + 0.01 * r; ps.maxSize = 0.026 + 0.016 * r;
  }

  update(dt: number, boat: Speedboat, water: GerstnerWater): void {
    if (!this.water) this.water = water;
    const T = boat.telemetry;
    void dt;
    this.wake.update(boat.pos.x, boat.pos.z, this.field.sampleBoat(boat));

    const fwd = boat.forward, right = boat.right;
    const vel = new Vector3(boat.vel.x, 0, boat.vel.z);

    // ---------------- spray da proa ----------------
    const planing = smoothstep(4, 14, T.waterSpeed);
    const bowWet = T.submergedPoints[0] || T.submergedPoints[1];
    const bowRate = bowWet ? planing * 900 * (1 - 0.4 * smoothstep(18, 25, T.waterSpeed)) : 0;
    const setBow = (ps: ParticleSystem, side: number) => {
      const p = boat.toWorld(v3(side * boat.params.beam * 0.41, -0.15, boat.params.length * 0.2));
      ps.emitter = new Vector3(p.x, water.getHeight(p.x, p.z) + 0.05, p.z);
      const out = new Vector3(right.x * side, 0, right.z * side);
      const base = new Vector3(fwd.x * 0.25, 0, fwd.z * 0.25).add(out.scale(0.9));
      const v = clamp(T.waterSpeed * 0.35, 1, 7);
      ps.direction1 = base.add(new Vector3(0, 0.9, 0)).scale(v).add(vel.scale(0.5));
      ps.direction2 = base.add(new Vector3(-fwd.x * 0.6, 1.4, -fwd.z * 0.6)).scale(v).add(vel.scale(0.5));
      ps.minEmitPower = 0.8; ps.maxEmitPower = 1.2;
      ps.emitRate = bowRate;
    };
    setBow(this.bowL, -1);
    setBow(this.bowR, 1);

    // ---------------- hélices: rooster tail, cavitação, ventilação (uma por motor) ----------------
    const n = boat.units.length;
    this.props.forEach((fx, i) => {
      if (i >= n) { fx.rooster.emitRate = fx.chop.emitRate = fx.mist.emitRate = fx.bubbles.emitRate = 0; return; }
      const un = boat.units[i];
      // barco de um motor: os valores da telemetria; de dois: os de cada motor
      const one = n === 1;
      this.updateProp(fx, water, fwd, right, vel, T.waterSpeed, {
        prop: one ? boat.propWorld : un.propW,
        imm: one ? T.propImmersion : un.immersion,
        cavitation: one ? T.cavitation : un.cavitation,
        ventilation: one ? T.ventilation : un.ventilation,
        throttle: one ? T.throttle : un.throttleActual,
        thrustN: one ? T.thrustN : (T.thrusts?.[i] ?? 0),
        propRpm: one ? T.propRpm : un.propRpmState,
        running: (one ? T.engine : un.engine) === "running",
      });
    });

    // ---------------- impactos ----------------
    const slam = Math.max(0, -boat.vel.y) * (T.wetFraction > 0 ? 1 : 0);
    const impact = T.lastImpact !== this.lastImpact ? T.lastImpact : 0;
    this.lastImpact = T.lastImpact;
    const c = boat.toWorld(v3(0, -0.3, 0.8));
    this.splash.emitter = new Vector3(c.x, water.getHeight(c.x, c.z), c.z);
    this.splash.minEmitBox = new Vector3(-1, 0, -1.5); this.splash.maxEmitBox = new Vector3(1, 0, 1.5);
    this.splash.direction1 = new Vector3(-2, 2.5, -2); this.splash.direction2 = new Vector3(2, 5, 2);
    this.splash.emitRate = (slam > 1.2 ? (slam - 1.2) * 900 : 0) + (impact > 8000 ? 1500 : 0);
  }
  /** Efeitos de uma hélice (rooster tail, leque das pás, névoa de cavitação, bolhas de escape). */
  private updateProp(fx: PropFx, water: GerstnerWater, fwd: Vec3, right: Vec3, vel: Vector3, waterSpeed: number, h: PropState): void {
    const prop = h.prop, imm = h.imm;
    const surf = water.getHeight(prop.x, prop.z);
    // só há água para ferver/espirrar se houver profundidade sob a hélice (encalhado na areia: nada)
    const hasWater = smoothstep(0.15, 0.5, water.getDepth(prop.x, prop.z));
    // fervura (cavitação/ar puxado) só com a hélice dentro d'água; no ar não há o que ferver
    
    const boil = clamp(Math.max(h.cavitation, (1 - h.ventilation) * smoothstep(0.15, 0.4, h.throttle)), 0, 1) * hasWater * smoothstep(0.2, 0.6, imm);
    fx.rooster.emitter = new Vector3(prop.x, surf, prop.z);
    const rv = clamp(waterSpeed * 0.3, 0, 7) + boil * 3;
    fx.rooster.direction1 = new Vector3(-fwd.x * 0.8 + right.x * 0.3, 1.1, -fwd.z * 0.8 + right.z * 0.3).scale(rv);
    fx.rooster.direction2 = new Vector3(-fwd.x * 1.2 - right.x * 0.3, 1.7, -fwd.z * 1.2 - right.z * 0.3).scale(rv);
    fx.rooster.emitRate = hasWater * smoothstep(0.5, 0.9, imm) * (h.thrustN > 500 ? smoothstep(6, 20, waterSpeed) * 600 * h.throttle + boil * 500 : boil * 300);

    // leque das pás "picando" a água: máximo com o disco pela metade (4·i·(1−i)), cresce com a rotação
    const spin = Math.min(Math.abs(h.propRpm) / 1500, 2);
    const chopAmt = hasWater * 4 * imm * (1 - imm) * spin;
    const side = Math.sign(h.propRpm) || 1;
    fx.chop.emitter = new Vector3(prop.x, surf + 0.02, prop.z);
    fx.chop.minEmitBox = new Vector3(-0.15, 0, -0.15); fx.chop.maxEmitBox = new Vector3(0.15, 0.05, 0.15);
    const cv = 2 + 3.5 * Math.min(spin, 1.5);
    fx.chop.direction1 = new Vector3(-fwd.x * 0.9 + right.x * side * 0.9, 1.6, -fwd.z * 0.9 + right.z * side * 0.9).scale(cv).add(vel.scale(0.7));
    fx.chop.direction2 = new Vector3(-fwd.x * 1.5 - right.x * side * 0.2, 2.6, -fwd.z * 1.5 - right.z * side * 0.2).scale(cv).add(vel.scale(0.7));
    fx.chop.minEmitPower = 0.7; fx.chop.maxEmitPower = 1.1;
    fx.chop.emitRate = chopAmt * 900;

    // névoa/espuma subindo da popa quando a hélice cavita ou ventila
    fx.mist.emitter = new Vector3(prop.x, surf + 0.1, prop.z);
    fx.mist.minEmitBox = new Vector3(-0.5, 0, -0.5); fx.mist.maxEmitBox = new Vector3(0.5, 0.2, 0.5);
    fx.mist.direction1 = new Vector3(-fwd.x * 2 - 0.5, 0.8, -fwd.z * 2 - 0.5);
    fx.mist.direction2 = new Vector3(-fwd.x * 3 + 0.5, 2.0, -fwd.z * 3 + 0.5);
    fx.mist.emitRate = boil * 140;

    // bolhas logo atrás da hélice (visíveis através da água transparente)
    fx.bubbles.emitter = new Vector3(prop.x - fwd.x * 0.3, Math.min(prop.y, surf - 0.1), prop.z - fwd.z * 0.3);
    fx.bubbles.minEmitBox = new Vector3(-0.2, -0.15, -0.2); fx.bubbles.maxEmitBox = new Vector3(0.2, 0.15, 0.2);
    fx.bubbles.direction1 = new Vector3(-fwd.x * 2.5 - 0.6, 0.0, -fwd.z * 2.5 - 0.6).add(vel.scale(0.6));
    fx.bubbles.direction2 = new Vector3(-fwd.x * 4 + 0.6, 0.6, -fwd.z * 4 + 0.6).add(vel.scale(0.8));
    // + bolhas de escape na lenta: os gases saem pelo cubo da hélice e sobem em rajadas
    const running = h.running ? 1 : 0;
    const exhIdle = running * hasWater * (1 - smoothstep(1.5, 5, Math.abs(waterSpeed)));
    const puff = 0.55 + 0.45 * Math.sin(performance.now() / 1000 * 9.0) * Math.sin(performance.now() / 1000 * 3.1);
    fx.bubbles.emitRate = surf > prop.y ? (boil * 900 + h.throttle * 80 * smoothstep(0.5, 4, waterSpeed + h.throttle * 3) + exhIdle * 260 * puff) : 0;
  }
}
