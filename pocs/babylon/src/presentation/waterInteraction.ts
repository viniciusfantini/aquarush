// Water Interaction: orquestra o mapa de esteira (deforma e espuma a própria água — wakeMap.ts)
// e as partículas: spray da proa, "rooster tail" da hélice, respingos de impacto e
// bolhas/névoa de cavitação e ventilação. Tudo dirigido pela telemetria real da simulação.

import { type Scene, DynamicTexture, Color4, ParticleSystem, Vector3 } from "@babylonjs/core";
import type { GerstnerWater } from "../sim/water.ts";
import type { Speedboat } from "../sim/boat.ts";
import { v3, clamp, smoothstep } from "../sim/math.ts";
import { WakeMap } from "./wakeMap.ts";

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

export class WaterInteraction {
  readonly wake: WakeMap;
  private readonly bowL: ParticleSystem;
  private readonly bowR: ParticleSystem;
  private readonly rooster: ParticleSystem;
  private readonly splash: ParticleSystem;
  private readonly bubbles: ParticleSystem;
  private readonly mist: ParticleSystem;
  private lastImpact = 0;

  constructor(scene: Scene, quality: { particles: number; wakeTexture: number }) {
    this.wake = new WakeMap(scene, { size: quality.wakeTexture, worldSize: 192 });
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
    this.rooster = mk("rooster", p * 0.2, drops);
    this.splash = mk("splash", p * 0.1, drops);
    this.mist = mk("cavMist", p * 0.1, dot);
    this.bubbles = mk("bubbles", p * 0.1, dot, 0);
    for (const ps of [this.bowL, this.bowR]) { ps.minSize = 0.12; ps.maxSize = 0.5; ps.minLifeTime = 0.3; ps.maxLifeTime = 0.85; }
    this.rooster.minSize = 0.25; this.rooster.maxSize = 0.9; this.rooster.minLifeTime = 0.5; this.rooster.maxLifeTime = 1.3;
    this.splash.minSize = 0.3; this.splash.maxSize = 1.1; this.splash.minLifeTime = 0.4; this.splash.maxLifeTime = 1.1;
    // névoa de cavitação/ventilação (sobe da popa)
    this.mist.minSize = 0.6; this.mist.maxSize = 1.8; this.mist.minLifeTime = 0.6; this.mist.maxLifeTime = 1.4;
    this.mist.gravity = new Vector3(0, -1.5, 0);
    this.mist.color1 = new Color4(1, 1, 1, 0.35); this.mist.color2 = new Color4(0.9, 0.95, 1, 0.25);
    // bolhas: pequenas, sobem devagar (empuxo) atrás da hélice
    this.bubbles.minSize = 0.04; this.bubbles.maxSize = 0.14; this.bubbles.minLifeTime = 0.4; this.bubbles.maxLifeTime = 1.2;
    this.bubbles.gravity = new Vector3(0, 2.5, 0);
    this.bubbles.color1 = new Color4(0.85, 0.97, 1, 0.75); this.bubbles.color2 = new Color4(0.7, 0.9, 0.95, 0.55);
  }

  update(dt: number, boat: Speedboat, water: GerstnerWater): void {
    const T = boat.telemetry;
    this.wake.update(dt, boat);

    const fwd = boat.forward, right = boat.right;
    const vel = new Vector3(boat.vel.x, 0, boat.vel.z);

    // ---------------- spray da proa ----------------
    const planing = smoothstep(4, 14, T.waterSpeed);
    const bowWet = T.submergedPoints[0] || T.submergedPoints[1];
    const bowRate = bowWet ? planing * 900 * (1 - 0.4 * smoothstep(18, 25, T.waterSpeed)) : 0;
    const setBow = (ps: ParticleSystem, side: number) => {
      const p = boat.toWorld(v3(side * 0.95, -0.15, 1.2));
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

    // ---------------- hélice: rooster tail, cavitação, ventilação ----------------
    const prop = boat.toWorld(boat.params.propPos);
    const surf = water.getHeight(prop.x, prop.z);
    const boil = clamp(Math.max(T.cavitation, (1 - T.ventilation) * smoothstep(0.15, 0.4, T.throttle)), 0, 1);
    this.rooster.emitter = new Vector3(prop.x, surf, prop.z);
    const rv = clamp(T.waterSpeed * 0.3, 0, 7) + boil * 3;
    this.rooster.direction1 = new Vector3(-fwd.x * 0.8 + right.x * 0.3, 1.1, -fwd.z * 0.8 + right.z * 0.3).scale(rv);
    this.rooster.direction2 = new Vector3(-fwd.x * 1.2 - right.x * 0.3, 1.7, -fwd.z * 1.2 - right.z * 0.3).scale(rv);
    this.rooster.emitRate = T.thrustN > 500 ? smoothstep(6, 20, T.waterSpeed) * 600 * T.throttle + boil * 500 : boil * 300;

    // névoa/espuma subindo da popa quando a hélice cavita ou ventila
    this.mist.emitter = new Vector3(prop.x, surf + 0.1, prop.z);
    this.mist.minEmitBox = new Vector3(-0.5, 0, -0.5); this.mist.maxEmitBox = new Vector3(0.5, 0.2, 0.5);
    this.mist.direction1 = new Vector3(-fwd.x * 2 - 0.5, 0.8, -fwd.z * 2 - 0.5);
    this.mist.direction2 = new Vector3(-fwd.x * 3 + 0.5, 2.0, -fwd.z * 3 + 0.5);
    this.mist.emitRate = boil * 140;

    // bolhas logo atrás da hélice (visíveis através da água transparente)
    this.bubbles.emitter = new Vector3(prop.x - fwd.x * 0.3, Math.min(prop.y, surf - 0.1), prop.z - fwd.z * 0.3);
    this.bubbles.minEmitBox = new Vector3(-0.2, -0.15, -0.2); this.bubbles.maxEmitBox = new Vector3(0.2, 0.15, 0.2);
    this.bubbles.direction1 = new Vector3(-fwd.x * 2.5 - 0.6, 0.0, -fwd.z * 2.5 - 0.6).add(vel.scale(0.6));
    this.bubbles.direction2 = new Vector3(-fwd.x * 4 + 0.6, 0.6, -fwd.z * 4 + 0.6).add(vel.scale(0.8));
    this.bubbles.emitRate = surf > prop.y ? (boil * 900 + T.throttle * 80 * smoothstep(0.5, 4, T.waterSpeed + T.throttle * 3)) : 0;

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
}
