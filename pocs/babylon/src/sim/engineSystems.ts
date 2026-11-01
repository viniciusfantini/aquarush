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
  /** Aceleração de jogo da carga/descarga da bateria (1 = tempo real). Com 1, dezenas de partidas
   *  mal arranham uma bateria de 50 Ah; o jogo acelera para o efeito aparecer numa sessão. */
  batteryTimeScale: number;
  starterA: number;          // corrente do motor de arranque (A)
  /** false = motor de partida manual sem bateria (bote): sem tensão, sem alternador */
  hasBattery: boolean;
}

export const ENGINE_SYSTEMS: EngineSystemsParams = {
  tankLiters: 120,
  ambientC: 26,
  thermostatC: 58,
  warnC: 85,
  protectC: 90,
  shutdownC: 115,
  protectRpm: 2000,
  batteryAh: 50,
  batteryTimeScale: 10,
  starterA: 170,
  hasBattery: true,
};

export interface EngineSystemsInput {
  engine: "off" | "cranking" | "running";
  rpm: number;
  fuelLph: number;
  load: number;              // acelerador efetivo 0..1
  intakeSubmerged: boolean;  // entrada d'água de refrigeração dentro d'água
  lightsOn: boolean;
  starterLoad?: number;      // 0..1: arranque girando (1) ou travado/solenoide (0,2)
  trimMotorA?: number;       // bomba elétrica do power trim (A)
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
  get chargeWarn(): boolean { return this.p.hasBattery && this.batteryV < 12.2; }
  /** Resistência interna (Ω): sobe quando a bateria descarrega — a tensão despenca na partida. */
  get internalR(): number { return 0.009 + 0.03 * (1 - this.batterySoc) ** 2; }
  /** Tensão em repouso pelo estado de carga (11,9 V vazia .. 12,7 V cheia). */
  get restV(): number { return 11.9 + 0.8 * this.batterySoc; }
  /** Tensão nos bornes com o arranque puxando a corrente cheia (para prever a partida). */
  get crankV(): number { return this.restV - this.p.starterA * this.internalR; }

  /** Pode dar partida? (combustível, bateria e temperatura) */
  canStart(): "" | "fuel" | "battery" | "overheat" {
    if (this.fuelL <= 0.05) return "fuel";
    if (this.p.hasBattery && this.batterySoc < 0.03) return "battery"; // morta: nem o relé arma
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
    if (!P.hasBattery) { this.batteryV = 0; this.batterySoc = 0; }
    else {
    const charging = running && s.rpm > 900;
    let drain = (s.lightsOn ? 2.5 : 0.3) + (s.trimMotorA ?? 0); // A (instrumentos + luzes + bomba do trim)
    if (s.engine === "cranking") drain += P.starterA * (s.starterLoad ?? 1); // motor de arranque
    const alt = charging ? Math.min(15, (s.rpm - 900) / 120) : 0; // A do alternador
    this.batterySoc = clamp(this.batterySoc + ((alt - drain) * dt * P.batteryTimeScale) / 3600 / this.p.batteryAh, 0, 1);
    const rest = this.restV;
    // queda de tensão = (resistência interna, que cresce com a descarga, + fiação) × corrente líquida
    const net = alt - drain;
    const R = this.internalR + 0.003;
    let vTarget = rest - Math.max(0, -net) * R;
    if (charging && net >= 0) vTarget = 13.6 + 0.6 * Math.min((s.rpm - 900) / 2500, 1); // regulador 13,6–14,2 V
    else if (charging) vTarget = Math.max(rest - (-net) * R, 13.6 + 0.6 * Math.min((s.rpm - 900) / 2500, 1) + net * 0.03); // alternador não dá conta
    this.batteryV += (vTarget - this.batteryV) * (1 - Math.exp(-dt / (s.engine === "cranking" ? 0.06 : 0.25)));
    }

    // ---- horímetro ----
    if (running) this.engineHours += dt / 3600;

    // falhas de alimentação perto do fim do tanque (o motor "engasga")
    // engasga no finzinho do tanque (≈0,1 % do tanque: 0,1 L na lancha, 0,015 L no tanque portátil do bote)
    this.sputter = running && this.fuelL < clamp(P.tankLiters * 0.001, 0.015, 0.1) ? this.sputter + dt : 0;
  }

  /** Engasgo por falta de combustível (0..1) — usado para cortar a combustão em pulsos. */
  get starving(): boolean { return this.sputter > 0 && Math.sin(this.sputter * 23) > 0.2; }
}
