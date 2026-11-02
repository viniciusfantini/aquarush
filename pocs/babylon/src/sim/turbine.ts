// Turbina a gás de eixo livre (turboeixo marítimo, classe ~1100 shp): um GERADOR DE GÁS (compressor +
// câmara + turbina do compressor, rotação N1 em %) e uma TURBINA LIVRE de potência (N2 em %) ligada ao eixo
// de saída pela caixa de redução. Sem Babylon: roda no Node para os testes.
//
// Partida (sequência real de um turboeixo):
//   1. ARRANQUE: o motor de partida (starter-gerador, alimentado pela bateria) gira o gerador de gás. A rotação
//      que ele alcança depende da tensão nos bornes;
//   2. a ~12 % de N1 entram a IGNIÇÃO (velas "tic-tic-tic") e o COMBUSTÍVEL;
//   3. ACENDE (light-off) ~1 s depois: a EGT (temperatura dos gases de escape) sobe de uma vez;
//   4. o gerador de gás acelera com o arranque ajudando; a EGT faz um pico (~650 °C com bateria boa);
//   5. a ~45 % N1 a turbina já se sustenta: o arranque e a ignição desligam;
//   6. estabiliza em MARCHA LENTA (~62 % N1, EGT ~480 °C, pressão de óleo ~60 psi).
//   Falhas: bateria fraca → o arranque não chega a 12 % (partida "pendurada": aborta) ou acelera devagar e a
//   EGT passa do limite (PARTIDA QUENTE: corta o combustível); sem combustível → não acende (aborta).
// Corte: o combustível fecha, a chama apaga e N1/N2 desaceleram por ~30 s (spool-down).

import { clamp, smoothstep, lerp } from "./math.ts";

export interface TurbineParams {
  shp: number;            // potência no eixo (referência)
  idleN1: number;         // % N1 em marcha lenta
  maxN1: number;          // % N1 a plena potência
  starterN1Max: number;   // % N1 que o arranque alcança sozinho com bateria boa
  lightOffN1: number;     // % N1 em que entram ignição + combustível
  starterCutN1: number;   // % N1 autossustentável: arranque e ignição desligam
  egtAmbient: number;     // °C
  egtIdle: number;        // °C em marcha lenta
  egtMax: number;         // °C a plena potência
  egtStartLimit: number;  // °C: acima disso na partida = partida quente (aborta)
  egtRedline: number;     // °C: limite em operação (alarme)
  spoolTau: number;       // s: constante de aceleração do N1 em operação
  accelLimit: number;     // %/s: a unidade de combustível limita a aceleração (evita o estol do compressor)
  n2Rpm: number;          // rpm do eixo de saída a 100 % N2
  fuelIdleLph: number;
  fuelMaxLph: number;
  oilPsiMax: number;
  spoolDownTau: number;   // s: N1 desacelerando sem combustível
}

export type TurbinePhase = "off" | "starter" | "lightoff" | "accel" | "running" | "spooldown";
export type TurbineEvent = "starter" | "ignition" | "lightoff" | "starterOff" | "idle" | "hotStart" | "noLightOff" | "hungStart" | "shutdown" | "flameout" | "abort";

export interface TurbineInput {
  lever: number;      // manete de potência 0..1 (acima da marcha lenta)
  volts: number;      // tensão nos bornes da bateria (arranque)
  fuel: boolean;      // há combustível chegando
  load: number;       // carga da hélice (1 = absorve 100 % do torque a 100 % N2; ~0,03 em neutro)
  damage?: number;    // avaria do motor 0..1 (perde potência)
}

export class Turbine {
  readonly p: TurbineParams;
  phase: TurbinePhase = "running";
  n1: number; n2: number; egt: number; oilPsi: number;
  /** torque no eixo de saída (% do nominal) e potência entregue (fração do nominal) */
  torque = 0; power = 0;
  fuelLph = 0;
  starter = false; ignition = false; fuelValve = true; lit = true;
  /** fração do torque do arranque (0..1) — corrente puxada da bateria */
  starterLoad = 0;
  hotStarts = 0;
  private t = 0;            // tempo na fase
  private sfLight = 1;      // força do arranque no acendimento (bateria boa = 1)
  private events: TurbineEvent[] = [];

  constructor(p: TurbineParams) {
    this.p = p;
    this.n1 = p.idleN1; this.n2 = 45; this.egt = p.egtIdle; this.oilPsi = this.oilAt(p.idleN1);
  }

  /** Lê e limpa os eventos (para o HUD avisar e o som tocar). */
  drainEvents(): TurbineEvent[] { const e = this.events; this.events = []; return e; }
  get starting(): boolean { return this.phase === "starter" || this.phase === "lightoff" || this.phase === "accel"; }
  /** estado equivalente de um motor a pistão (para a manete, a marcha e os sistemas) */
  get engineState(): "off" | "cranking" | "running" { return this.phase === "running" ? "running" : this.starting ? "cranking" : "off"; }
  get burning(): boolean { return this.lit && this.fuelValve; }
  get egtWarn(): boolean { return this.egt > this.p.egtRedline; }

  /** Fria e parada (reposicionar no píer). */
  cold(): void {
    this.phase = "off"; this.n1 = 0; this.n2 = 0; this.egt = this.p.egtAmbient; this.oilPsi = 0;
    this.torque = 0; this.power = 0; this.fuelLph = 0; this.starter = this.ignition = this.fuelValve = this.lit = false; this.starterLoad = 0; this.t = 0; this.events = [];
  }
  /** Em marcha lenta (estado inicial dos testes, como os motores a pistão começam ligados). */
  idle(): void {
    this.phase = "running"; this.n1 = this.p.idleN1; this.n2 = 45; this.egt = this.p.egtIdle; this.oilPsi = this.oilAt(this.p.idleN1);
    this.starter = this.ignition = false; this.fuelValve = this.lit = true; this.t = 0;
  }
  /** Botão de partida: só parada (N1 < 8 %). */
  start(): boolean {
    if (this.starting || this.phase === "running" || this.n1 > 8) return false;
    this.phase = "starter"; this.t = 0; this.starter = true; this.ignition = false; this.fuelValve = false; this.lit = false;
    this.events.push("starter");
    return true;
  }
  /** Corte normal (manete de combustível em CORTE). */
  shutdown(): void {
    if (this.phase !== "running") return;
    this.cutFuel(true); this.events.push("shutdown");
  }
  /** Aborta a partida (botão de novo, partida quente, sem acender…). */
  abort(why: TurbineEvent = "abort"): void {
    if (!this.starting) return;
    this.cutFuel(true); this.events.push(why);
  }
  /** Chama apagada (sem combustível, barco virado/afundado → aviso de flameout; corte/aborto → `quiet`): spool-down. */
  cutFuel(quiet = false): void {
    const was = this.burning;
    this.fuelValve = false; this.lit = false; this.ignition = false; this.starter = false;
    if (this.phase !== "off") { this.phase = "spooldown"; this.t = 0; }
    if (was && !quiet && this.phase === "spooldown") this.events.push("flameout");
  }

  private oilAt(n1: number): number { return this.p.oilPsiMax * Math.pow(clamp((n1 - 4) / 70, 0, 1), 0.7); }
  /** força do arranque pela tensão nos bornes (~10,3 V sob carga ≈ 1; abaixo de ~7 V não gira) */
  private starterForce(v: number): number { return clamp((v - 7) / 3.3, 0, 1.1); }

  update(dt: number, inp: TurbineInput): void {
    const P = this.p;
    this.t += dt;
    const k = (tau: number) => 1 - Math.exp(-dt / tau);
    let egtTarget = P.egtAmbient + 1.2 * this.n1; // sem chama: o ar do compressor aquece pouco
    let egtTau = 4;
    const sf = this.starterForce(inp.volts);
    this.starterLoad = this.starter ? clamp(1 - 0.5 * this.n1 / P.starterCutN1, 0.3, 1) : 0;
    let gas = 0; // potência do gerador de gás (fração do nominal)

    switch (this.phase) {
      case "off":
        this.n1 += (0 - this.n1) * k(6);
        break;
      case "starter": {
        // o arranque gira o gerador de gás; a rotação final depende da tensão
        this.n1 += (P.starterN1Max * sf - this.n1) * k(5);
        if (this.n1 >= P.lightOffN1) {
          this.phase = "lightoff"; this.t = 0; this.ignition = true; this.fuelValve = true; this.sfLight = sf;
          this.events.push("ignition");
        } else if (this.t > 20) { this.abort("hungStart"); } // pendurada: não chega à rotação de ignição
        break;
      }
      case "lightoff": {
        this.n1 += (P.starterN1Max * sf - this.n1) * k(5);
        if (!inp.fuel) { if (this.t > 10) this.abort("noLightOff"); break; }
        if (this.t > 1.1) { this.lit = true; this.phase = "accel"; this.t = 0; this.events.push("lightoff"); }
        break;
      }
      case "accel": {
        if (!inp.fuel) { this.cutFuel(); break; }
        // com o arranque ajudando o gerador de gás acelera até a marcha lenta; bateria fraca = mais devagar
        const assist = this.starter ? 0.55 + 0.45 * sf : 0.75;
        this.n1 += (P.idleN1 + 6 - this.n1) * k(6 / assist);
        // pico de EGT: mais combustível que ar no começo; acelerar devagar (arranque fraco) = mais quente
        const peak = 680 + 480 * Math.pow(1 - Math.min(1, this.sfLight), 1.3);
        const bump = this.n1 < 22 ? smoothstep(P.lightOffN1, 22, this.n1) : 1 - smoothstep(32, P.idleN1, this.n1);
        // acendeu: a EGT sobe de uma vez (~2 s) e faz o pico entre 22 e 32 % N1
        egtTarget = lerp(P.egtAmbient, P.egtIdle, smoothstep(0, 2.5, this.t)) + (peak - P.egtIdle) * bump;
        egtTau = 0.9;
        if (this.starter && this.n1 >= P.starterCutN1) { this.starter = false; this.ignition = false; this.events.push("starterOff"); }
        if (this.egt > P.egtStartLimit) { this.hotStarts++; this.abort("hotStart"); break; }
        if (this.n1 >= P.idleN1 - 0.5) { this.phase = "running"; this.t = 0; this.events.push("idle"); }
        break;
      }
      case "running": {
        if (!inp.fuel) { this.cutFuel(); break; }
        // governador da turbina livre: N2 acima de ~101 % (sem carga, ex.: em neutro) reduz o combustível
        const gov = clamp((104 - this.n2) / 3, 0, 1);
        const target = P.idleN1 + (P.maxN1 - P.idleN1) * clamp(inp.lever, 0, 1) * gov;
        let d = (target - this.n1) * k(P.spoolTau);
        d = clamp(d, -15 * dt, P.accelLimit * dt);   // a unidade de combustível limita acelerar/desacelerar
        this.n1 += d;
        gas = Math.pow(clamp((this.n1 - 55) / (100 - 55), 0, 1.06), 2) * (1 - 0.6 * (inp.damage ?? 0));
        // EGT sobe com a potência e um pouco mais acelerando (excesso de combustível no transitório)
        egtTarget = P.egtIdle + (P.egtMax - P.egtIdle) * Math.min(1, gas) + 70 * clamp(d / (P.accelLimit * dt), 0, 1) * (gas < 0.9 ? 1 : 0);
        egtTau = 1.6;
        break;
      }
      case "spooldown": {
        this.n1 += (0 - this.n1) * k(P.spoolDownTau);
        egtTarget = P.egtAmbient + 1.2 * this.n1 + 60 * Math.exp(-this.t / 8);
        egtTau = 5;
        if (this.n1 < 1) { this.n1 = 0; this.phase = "off"; }
        break;
      }
    }
    this.egt += (egtTarget - this.egt) * k(egtTau);
    this.oilPsi += (this.oilAt(this.n1) - this.oilPsi) * k(0.8);

    // turbina livre (N2): o fluxo de gás dá torque, maior com N2 baixo (torque de "estol" ~2× o nominal); a
    // hélice absorve ∝ N2² (lei da hélice) × carga. Mesmo em marcha lenta o fluxo de gás move a turbina livre
    // (~3,5 % da potência); sem chama, só o ar do gerador de gás girando. Inércia: ~1 s.
    const flow = (this.burning ? 0.035 : 0.012) * smoothstep(15, P.idleN1, this.n1);
    const gasEff = Math.max(gas, flow);
    const n2f = this.n2 / 100;
    const qAvail = gasEff * (2 - Math.min(1.2, n2f));
    const qLoad = Math.max(0.02, inp.load) * n2f * n2f;
    this.n2 = clamp(this.n2 + (qAvail - qLoad) * 90 * dt, 0, 110);
    this.torque = 100 * qLoad;
    this.power = qLoad * n2f;
    this.fuelLph = this.burning ? (this.phase === "running" ? P.fuelIdleLph + (P.fuelMaxLph - P.fuelIdleLph) * Math.min(1.05, gas) : P.fuelIdleLph * 0.6) : 0;
  }
}
