// Water Interaction: esteira (faixa de espuma que se abre com o tempo, presa à superfície
// ondulada) e spray (partículas na proa, "rooster tail" da hélice e respingos de impacto).
// Intensidades derivam do estado real da simulação (velocidade, imersão, impacto).

import {
  type Scene, Mesh, VertexData, StandardMaterial, DynamicTexture, Color3, Color4, ParticleSystem, Vector3, Texture, Constants,
} from "@babylonjs/core";
import type { GerstnerWater } from "../sim/water.ts";
import type { Speedboat } from "../sim/boat.ts";
import { v3, clamp, smoothstep } from "../sim/math.ts";

const softDot = (scene: Scene): DynamicTexture => {
  const s = 64;
  const tex = new DynamicTexture("softDot", { width: s, height: s }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  tex.hasAlpha = true;
  tex.update();
  return tex;
};

const foamTexture = (scene: Scene): DynamicTexture => {
  const w = 128, h = 256;
  const tex = new DynamicTexture("foamTex", { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(w, h);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      // bordas (braços do V) mais intensas + centro (água revolvida da hélice)
      const edge = Math.max(Math.exp(-((u - 0.06) ** 2) / 0.004), Math.exp(-((u - 0.94) ** 2) / 0.004));
      const center = Math.exp(-((u - 0.5) ** 2) / 0.02);
      const n = r();
      const a = clamp((edge * 0.9 + center * 0.8) * (0.45 + 0.75 * n) + (n > 0.93 ? 0.35 : 0), 0, 1);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.hasAlpha = true;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.update();
  return tex;
};

interface WakeSample { x: number; z: number; dx: number; dz: number; age: number; speed: number; dist: number }

export class WaterInteraction {
  private samples: WakeSample[] = [];
  private emitTimer = 0;
  private distAcc = 0;
  private readonly wake: Mesh;
  private readonly maxSamples: number;
  private readonly bowL: ParticleSystem;
  private readonly bowR: ParticleSystem;
  private readonly rooster: ParticleSystem;
  private readonly splash: ParticleSystem;
  private lastImpact = 0;

  constructor(scene: Scene, quality: { particles: number; wakeSamples: number }) {
    this.maxSamples = quality.wakeSamples;
    this.wake = new Mesh("wake", scene);
    const mat = new StandardMaterial("wakeMat", scene);
    mat.diffuseTexture = foamTexture(scene);
    mat.diffuseTexture.hasAlpha = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveColor = new Color3(0.45, 0.5, 0.52);
    mat.diffuseColor = new Color3(0.6, 0.62, 0.64);
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.alphaMode = Constants.ALPHA_COMBINE;
    this.wake.material = mat;
    this.wake.hasVertexAlpha = true;
    this.wake.alwaysSelectAsActiveMesh = true;

    const dot = softDot(scene);
    const mk = (name: string, cap: number) => {
      const ps = new ParticleSystem(name, cap, scene);
      ps.particleTexture = dot;
      ps.color1 = new Color4(1, 1, 1, 0.85);
      ps.color2 = new Color4(0.85, 0.92, 0.95, 0.7);
      ps.colorDead = new Color4(0.9, 0.95, 1, 0);
      ps.gravity = new Vector3(0, -9.81, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.minEmitBox = ps.maxEmitBox = Vector3.Zero();
      ps.emitter = Vector3.Zero();
      ps.emitRate = 0;
      ps.start();
      return ps;
    };
    const p = quality.particles;
    this.bowL = mk("sprayL", Math.round(p * 0.3));
    this.bowR = mk("sprayR", Math.round(p * 0.3));
    this.rooster = mk("rooster", Math.round(p * 0.25));
    this.splash = mk("splash", Math.round(p * 0.15));
    for (const ps of [this.bowL, this.bowR]) { ps.minSize = 0.15; ps.maxSize = 0.55; ps.minLifeTime = 0.35; ps.maxLifeTime = 0.9; }
    this.rooster.minSize = 0.25; this.rooster.maxSize = 0.8; this.rooster.minLifeTime = 0.5; this.rooster.maxLifeTime = 1.2;
    this.splash.minSize = 0.3; this.splash.maxSize = 1.0; this.splash.minLifeTime = 0.4; this.splash.maxLifeTime = 1.1;
  }

  update(dt: number, boat: Speedboat, water: GerstnerWater): void {
    const T = boat.telemetry;
    const speed = Math.hypot(boat.vel.x, boat.vel.z);
    const fwd = boat.forward;
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const fx = fwd.x / fl, fz = fwd.z / fl;

    // ---------------- esteira ----------------
    for (const s of this.samples) s.age += dt;
    this.samples = this.samples.filter((s) => s.age < 9);
    this.emitTimer -= dt;
    const stern = boat.toWorld(v3(0, -0.3, -2.9));
    const sternH = water.getHeight(stern.x, stern.z);
    const inWater = sternH - stern.y > -0.25;
    this.distAcc += speed * dt;
    if (this.emitTimer <= 0 && speed > 0.8 && inWater) {
      this.emitTimer = 0.06;
      this.samples.push({ x: stern.x, z: stern.z, dx: fx, dz: fz, age: 0, speed, dist: this.distAcc });
      if (this.samples.length > this.maxSamples) this.samples.shift();
    }
    this.rebuildWake(water, stern, inWater && speed > 0.8 ? speed : 0, fx, fz);

    // ---------------- spray ----------------
    const planing = smoothstep(4, 14, T.waterSpeed);
    const bowWet = T.submergedPoints[0] || T.submergedPoints[1];
    const bowRate = bowWet ? planing * 900 * (1 - 0.4 * smoothstep(18, 25, T.waterSpeed)) : 0;
    const right = boat.right, up = boat.up;
    const setBow = (ps: ParticleSystem, side: number) => {
      const p = boat.toWorld(v3(side * 0.95, -0.15, 1.2));
      ps.emitter = new Vector3(p.x, water.getHeight(p.x, p.z) + 0.05, p.z);
      const out = new Vector3(right.x * side, 0, right.z * side);
      const base = new Vector3(fwd.x * 0.25, 0, fwd.z * 0.25).add(out.scale(0.9));
      const v = clamp(T.waterSpeed * 0.35, 1, 7);
      ps.direction1 = base.add(new Vector3(0, 0.9, 0)).scale(v).add(new Vector3(boat.vel.x, 0, boat.vel.z).scale(0.5));
      ps.direction2 = base.add(new Vector3(-fwd.x * 0.6, 1.4, -fwd.z * 0.6)).scale(v).add(new Vector3(boat.vel.x, 0, boat.vel.z).scale(0.5));
      ps.minEmitPower = 0.8; ps.maxEmitPower = 1.2;
      ps.emitRate = bowRate;
    };
    setBow(this.bowL, -1);
    setBow(this.bowR, 1);

    const prop = boat.toWorld(boat.params.propPos);
    this.rooster.emitter = new Vector3(prop.x, water.getHeight(prop.x, prop.z), prop.z);
    const rv = clamp(T.waterSpeed * 0.3, 0, 7);
    this.rooster.direction1 = new Vector3(-fwd.x * 0.8 - up.x * 0 + right.x * 0.3, 1.1, -fwd.z * 0.8 + right.z * 0.3).scale(rv);
    this.rooster.direction2 = new Vector3(-fwd.x * 1.2 - right.x * 0.3, 1.6, -fwd.z * 1.2 - right.z * 0.3).scale(rv);
    this.rooster.emitRate = T.thrustN > 500 && T.ventilation > 0.1 ? smoothstep(6, 20, T.waterSpeed) * 600 * T.throttle : 0;

    // respingos de impacto: casco batendo na água ou colisão
    const slam = Math.max(0, -boat.vel.y) * (T.wetFraction > 0 ? 1 : 0);
    const impact = T.lastImpact !== this.lastImpact ? T.lastImpact : 0;
    this.lastImpact = T.lastImpact;
    const c = boat.toWorld(v3(0, -0.3, 0.8));
    this.splash.emitter = new Vector3(c.x, water.getHeight(c.x, c.z), c.z);
    this.splash.minEmitBox = new Vector3(-1, 0, -1.5); this.splash.maxEmitBox = new Vector3(1, 0, 1.5);
    this.splash.direction1 = new Vector3(-2, 2.5, -2); this.splash.direction2 = new Vector3(2, 5, 2);
    this.splash.emitRate = (slam > 1.2 ? (slam - 1.2) * 900 : 0) + (impact > 8000 ? 1500 : 0);
  }

  private rebuildWake(water: GerstnerWater, stern: { x: number; z: number }, liveSpeed: number, fx: number, fz: number): void {
    const n = this.samples.length;
    const pts: WakeSample[] = [...this.samples];
    if (liveSpeed > 0) pts.push({ x: stern.x, z: stern.z, dx: fx, dz: fz, age: 0, speed: liveSpeed, dist: this.distAcc });
    if (pts.length < 2) { this.wake.setEnabled(false); return; }
    this.wake.setEnabled(true);
    const positions: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const s = pts[i];
      // largura cresce com a idade (braços do V se abrindo ~ ângulo de Kelvin)
      const half = 0.9 + s.age * Math.min(s.speed, 22) * 0.22;
      const px = -s.dz, pz = s.dx;
      const lx = s.x + px * half, lz = s.z + pz * half;
      const rx = s.x - px * half, rz = s.z - pz * half;
      positions.push(lx, water.getHeight(lx, lz) + 0.04, lz, rx, water.getHeight(rx, rz) + 0.04, rz);
      const a = 0.75 * clamp(1 - s.age / 7, 0, 1) ** 2.2 * smoothstep(0.8, 6, s.speed) * (i === pts.length - 1 ? 0.3 : 1);
      colors.push(1, 1, 1, a, 1, 1, 1, a);
      const v = s.dist / 12;
      uvs.push(0, v, 1, v);
      if (i > 0) {
        const b = (i - 1) * 2;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const vd = new VertexData();
    vd.positions = positions; vd.colors = colors; vd.uvs = uvs; vd.indices = indices;
    const normals: number[] = [];
    for (let i = 0; i < positions.length / 3; i++) normals.push(0, 1, 0);
    vd.normals = normals;
    vd.applyToMesh(this.wake, true);
    void n;
  }
}
