// Fumaça e fogo do escape da turbina (lancha AR-10). Só lê a telemetria da turbina (fase, chama, EGT, N1, potência):
//  • arranque antes de acender: só um sopro de ar quente/vapor do compressor girando;
//  • ignição + combustível ainda sem chama: névoa branca de combustível não queimado;
//  • ACENDIMENTO (light-off): uma labareda curta pelos bocais e um bolo de fumaça escura (o combustível acumulado
//    queimando de uma vez), que vai clareando enquanto o gerador de gás acelera;
//  • EGT alta na partida (partida quente): labaredas contínuas ("torching") e fumaça preta;
//  • em operação: fumaça fina e quase transparente, mais densa ao acelerar (transitório rico); tremulação de calor;
//  • corte/spool-down: fiapos brancos que somem com o N1.
// Partículas no mundo: o bocal se move com o barco, a fumaça fica para trás e sobe (gás quente).

import { type Scene, ParticleSystem, DynamicTexture, Color4, Vector3, type TransformNode } from "@babylonjs/core";
import type { BoatTelemetry } from "../sim/boat.ts";

const puffTex = (scene: Scene, name: string, hard: number): DynamicTexture => {
  const s = 64;
  const tex = new DynamicTexture(name, { width: s, height: s }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(hard, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  tex.hasAlpha = true; tex.update();
  return tex;
};

interface Nozzle { smoke: ParticleSystem; fire: ParticleSystem }

export class TurbineExhaustFx {
  private readonly nozzles: Nozzle[] = [];
  private prevLit = false;
  private burst = 0;      // labareda do acendimento (s restantes)
  private soot = 0;       // fumaça escura acumulada (0..1), decai
  private prevN1 = 0;

  constructor(scene: Scene, count = 2) {
    const smokeTex = puffTex(scene, "exhSmoke", 0.25), fireTex = puffTex(scene, "exhFire", 0.45);
    for (let i = 0; i < count; i++) {
      const smoke = new ParticleSystem("exhSmoke" + i, 900, scene);
      smoke.particleTexture = smokeTex;
      smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      smoke.minLifeTime = 1.6; smoke.maxLifeTime = 3.4;
      smoke.minSize = 0.25; smoke.maxSize = 0.5;
      // a fumaça cresce enquanto se espalha
      smoke.addSizeGradient(0, 0.5); smoke.addSizeGradient(0.4, 1.6); smoke.addSizeGradient(1, 3.2);
      smoke.minAngularSpeed = -0.6; smoke.maxAngularSpeed = 0.6;
      smoke.gravity = new Vector3(0, 0.5, 0); // gás quente sobe
      smoke.minEmitBox = new Vector3(-0.08, -0.03, 0); smoke.maxEmitBox = new Vector3(0.08, 0.03, 0);
      smoke.emitRate = 0; smoke.renderingGroupId = 1;
      smoke.emitter = Vector3.Zero();
      smoke.start();
      const fire = new ParticleSystem("exhFire" + i, 500, scene);
      fire.particleTexture = fireTex;
      fire.blendMode = ParticleSystem.BLENDMODE_ADD;
      fire.minLifeTime = 0.08; fire.maxLifeTime = 0.28;
      fire.minSize = 0.18; fire.maxSize = 0.42;
      fire.addSizeGradient(0, 0.7); fire.addSizeGradient(0.5, 1.2); fire.addSizeGradient(1, 0.4);
      fire.color1 = new Color4(1, 0.82, 0.35, 1); fire.color2 = new Color4(1, 0.42, 0.08, 1); fire.colorDead = new Color4(0.25, 0.05, 0, 0);
      fire.gravity = new Vector3(0, 1.5, 0);
      fire.minEmitBox = new Vector3(-0.12, -0.03, 0); fire.maxEmitBox = new Vector3(0.12, 0.03, 0);
      fire.emitRate = 0; fire.renderingGroupId = 1;
      fire.emitter = Vector3.Zero();
      fire.start();
      this.nozzles.push({ smoke, fire });
    }
  }

  /** `nodes`: bocais do barco ativo (−Z local = saída). Sem turbina ou sem bocais: tudo para de emitir. */
  update(dt: number, nodes: TransformNode[] | undefined, T: BoatTelemetry["turbine"], vel: { x: number; y: number; z: number }, paused: boolean): void {
    if (!T || !nodes || nodes.length === 0 || paused) {
      for (const n of this.nozzles) { n.smoke.emitRate = 0; n.fire.emitRate = 0; }
      this.prevLit = T?.lit ?? false;
      return;
    }
    // acendeu agora: labareda + bolo de fumaça escura
    if (T.lit && !this.prevLit && (T.phase === "accel" || T.phase === "lightoff")) { this.burst = 1.1; this.soot = 1; }
    this.prevLit = T.lit;
    this.burst = Math.max(0, this.burst - dt);
    this.soot = Math.max(0, this.soot - dt / 6);
    const dN1 = dt > 0 ? (T.n1 - this.prevN1) / dt : 0;
    this.prevN1 = T.n1;
    const starting = T.phase === "starter" || T.phase === "lightoff" || T.phase === "accel";
    const egtHot = Math.max(0, Math.min(1, (T.egt - 640) / 140));   // perto do limite de partida (780 °C)
    const fuelMist = T.phase === "lightoff" && !T.lit ? 1 : 0;      // combustível entrando sem chama
    const power = Math.max(0, Math.min(1.2, T.torque / 100 * T.n2 / 100));
    const accel = T.phase === "running" ? Math.max(0, Math.min(1, dN1 / 9)) : 0; // transitório (mistura rica)

    // ---- fumaça ----
    let rate = 0, dark = 0, alpha = 0.35, speed = 3 + 0.25 * T.n1;
    // starter girando a seco: sem combustão não há fumaça; só se houver combustível acumulado na câmara (partida
    // molhada) o ar do compressor o empurra para fora como névoa branca de vapor
    if (T.phase === "starter") { rate = T.pooledL > 0.01 ? 70 * Math.min(1, T.pooledL / 0.08) * Math.min(1, T.n1 / 8) : 0; alpha = 0.32; dark = 0; }
    else if (fuelMist) { rate = 70 * Math.min(1, T.n1 / 8); alpha = 0.3; dark = 0.05; }
    else if (T.phase === "accel") { rate = 40 + 220 * this.soot + 120 * egtHot; dark = 0.35 + 0.5 * Math.max(this.soot, egtHot); alpha = 0.5; }
    else if (T.phase === "running") { rate = 8 + 30 * power + 90 * accel + 60 * this.soot; dark = 0.15 + 0.5 * accel + 0.4 * this.soot; alpha = 0.1 + 0.18 * accel + 0.3 * this.soot; }
    else if (T.phase === "spooldown") { rate = 25 * Math.min(1, T.n1 / 40) + 160 * this.soot; alpha = 0.22 + 0.3 * this.soot; dark = 0.25 * this.soot + 0.5 * egtHot; }
    speed += 20 * power;
    // ---- fogo ----
    let fire = 0;
    if (this.burst > 0) fire = 420 * Math.min(1, this.burst / 0.6);
    if (starting && T.lit) fire = Math.max(fire, 260 * egtHot);            // "torching" na partida quente
    if (T.phase === "spooldown" && egtHot > 0.2) fire = Math.max(fire, 200 * egtHot);
    if (T.phase === "running") fire = Math.max(fire, 25 * accel * (T.n1 > 85 ? 1 : 0)); // lambida no transitório a toda

    const g = 0.85 - 0.7 * Math.min(1, dark); // cinza claro → preto
    // um bocal só (duto único, mais largo) concentra o gás dos dois: mais partículas e um "boca" maior
    const k = 2 / nodes.length;
    for (let i = 0; i < this.nozzles.length; i++) {
      const nz = this.nozzles[i], node = nodes[i];
      if (!node) { nz.smoke.emitRate = 0; nz.fire.emitRate = 0; continue; }
      const box = 0.08 * k;
      nz.smoke.minEmitBox.set(-box, -box * 0.6, 0); nz.smoke.maxEmitBox.set(box, box * 0.6, 0);
      nz.fire.minEmitBox.set(-box * 1.3, -box, 0); nz.fire.maxEmitBox.set(box * 1.3, box, 0);
      const p = node.getAbsolutePosition();
      const dir = Vector3.TransformNormal(new Vector3(0, 0, -1), node.getWorldMatrix()).normalize();
      const v = new Vector3(vel.x, vel.y, vel.z);
      // fumaça: sai do bocal com o gás e herda boa parte da velocidade do barco (fica para trás devagar)
      nz.smoke.emitter = p.clone();
      nz.smoke.direction1 = dir.scale(speed * 0.8).add(v.scale(0.85)).add(new Vector3(-0.4, 0.2, -0.4));
      nz.smoke.direction2 = dir.scale(speed * 1.1).add(v.scale(0.95)).add(new Vector3(0.4, 0.8, 0.4));
      nz.smoke.minEmitPower = 1; nz.smoke.maxEmitPower = 1;
      nz.smoke.color1 = new Color4(g, g, g * 1.02, alpha);
      nz.smoke.color2 = new Color4(g * 0.9, g * 0.9, g * 0.92, alpha * 0.8);
      nz.smoke.colorDead = new Color4(g, g, g, 0);
      nz.smoke.emitRate = rate * k;
      // fogo: jato curto e rápido saindo do bocal
      nz.fire.emitter = p.add(dir.scale(0.05));
      nz.fire.direction1 = dir.scale(6).add(v).add(new Vector3(-0.5, -0.2, -0.5));
      nz.fire.direction2 = dir.scale(11).add(v).add(new Vector3(0.5, 0.5, 0.5));
      nz.fire.minEmitPower = 1; nz.fire.maxEmitPower = 1;
      nz.fire.emitRate = fire * k;
    }
  }
}
