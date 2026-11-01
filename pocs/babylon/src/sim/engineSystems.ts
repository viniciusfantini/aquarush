// Simulation: sistemas auxiliares do motor de popa — combustível, arrefecimento (temperatura),
// elétrico (bateria/alternador) e horímetro. Modelos simples, documentados e testáveis;
// alimentam o HUD e os instrumentos do painel 3D (nada decorativo).

import { clamp } from "./math.ts";

export interface EngineSystemsParams {
  tankLiters: number;
  ambientC: number;
  thermostatC: number;       // temperatura regulada pelo termostato (motor 4T de popa ~55–60 °C)
  warnC: number;             // alarme de superaquecimento
  protectC: number;          // modo de proteção (limita a rotação)
  shutdownC: number;         // desliga o motor
  protectRpm: number;        // rotação máxima em modo de proteção
  batteryAh: number;
}

export const ENGINE_SYSTEMS: EngineSystemsParams = {
  tankLiters: 120,
  ambientC: 26,
  thermostatC: 58,
  warnC: 85,
  protectC: 90,
  shutdownC: 115,
  protectRpm: 2000,
  batteryAh: 75,
};

export interface EngineSystemsInput {
  engine: "off" | "cranking" | "running";
  rpm: number;
  fuelLph: number;
  load: number;              // acelerador efetivo 0..1
  intakeSubmerged: boolean;  // entrada d'água de refrigeração dentro d'água
  lightsOn: boolean;
}

export class EngineSystems {
  readonly p: EngineSystemsParams;
  fuelL: number;
  coolantC: number;
  batterySoc = 0.92;     // estado de carga 0..1
  batteryV = 12.6;
  engineHours = 0;
  /** motor em modo de proteção (superaquecido): rotação limitada */
  protect = false;
  /** pedido de desligamento (sem combustível ou superaquecimento extremo) */
  stallReason: "" | "fuel" | "overheat" = "";
  private sputter = 0;

  constructor(p: EngineSystemsParams = ENGINE_SYSTEMS, opts: { fuelFrac?: number; coolantC?: number; hours?: number } = {}) {
    this.p = p;
    this.fuelL = p.tankLiters * (opts.fuelFrac ?? 1);
    this.coolantC = opts.coolantC ?? 45;
    this.engineHours = opts.hours ?? 0;
  }

  get fuelFrac(): number { return this.fuelL / this.p.tankLiters; }
  get overheatWarn(): boolean { return this.coolantC >= this.p.warnC; }
  get lowFuel(): boolean { return this.fuelFrac < 0.12; }
  get chargeWarn(): boolean { return this.batteryV < 12.2; }

  /** Pode dar partida? (combustível, bateria e temperatura) */
  canStart(): "" | "fuel" | "battery" | "overheat" {
    if (this.fuelL <= 0.05) return "fuel";
    if (this.batterySoc < 0.15) return "battery";
    if (this.coolantC > this.p.protectC) return "overheat";
    return "";
  }

  refuel(): void { this.fuelL = this.p.tankLiters; }

  update(dt: number, s: EngineSystemsInput): void {
    const P = this.p;
    const running = s.engine === "running";
    this.stallReason = "";

    // ---- combustível ----
    if (running) {
      this.fuelL = Math.max(0, this.fuelL - (s.fuelLph / 3600) * dt);
      if (this.fuelL <= 0) this.stallReason = "fuel";
    }

    // ---- arrefecimento (água do lago bombeada pelo pé do motor; termostato) ----
    let target: number, tau: number;
    if (running && s.intakeSubmerged) {
      target = P.thermostatC + 6 * s.load;  // termostato segura ~58–64 °C
      tau = this.coolantC < P.thermostatC ? 90 : 25; // aquece devagar a frio; regula rápido
    } else if (running) {
      target = 135;                          // sem água de refrigeração: esquenta rápido
      tau = 40;
    } else {
      target = P.ambientC;                   // desligado: esfria devagar
      tau = 420;
    }
    this.coolantC += (target - this.coolantC) * (1 - Math.exp(-dt / tau));
    if (running && this.coolantC >= P.shutdownC) this.stallReason = "overheat";
    // histerese do modo de proteção
    if (this.coolantC >= P.protectC) this.protect = true;
    else if (this.coolantC < P.warnC - 5) this.protect = false;

    // ---- elétrico: bateria + alternador ----
    const charging = running && s.rpm > 900;
    let drain = s.lightsOn ? 2.5 : 0.3;                    // A (instrumentos + luzes)
    if (s.engine === "cranking") drain += 160;             // motor de arranque
    const alt = charging ? Math.min(15, (s.rpm - 900) / 120) : 0; // A do alternador
    this.batterySoc = clamp(this.batterySoc + ((alt - drain) * dt) / 3600 / this.p.batteryAh, 0, 1);
    const rest = 11.9 + 0.8 * this.batterySoc;             // 11,9 V vazia .. 12,7 V cheia
    let vTarget = rest - drain * 0.004;
    if (s.engine === "cranking") vTarget = rest - 1.9;     // queda na partida
    else if (charging) vTarget = 13.6 + 0.6 * Math.min((s.rpm - 900) / 2500, 1); // regulador 13,6–14,2 V
    this.batteryV += (vTarget - this.batteryV) * (1 - Math.exp(-dt / 0.4));

    // ---- horímetro ----
    if (running) this.engineHours += dt / 3600;

    // falhas de alimentação perto do fim do tanque (o motor "engasga")
    this.sputter = running && this.fuelL < 0.6 ? this.sputter + dt : 0;
  }

  /** Engasgo por falta de combustível (0..1) — usado para cortar a combustão em pulsos. */
  get starving(): boolean { return this.sputter > 0 && Math.sin(this.sputter * 23) > 0.2; }
}
