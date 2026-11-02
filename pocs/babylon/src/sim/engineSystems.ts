// Simulation: sistemas auxiliares do motor de popa — combustível, arrefecimento (temperatura),
// elétrico (bateria/alternador) e horímetro. Modelos simples, documentados e testáveis;
// alimentam o HUD e os instrumentos do painel 3D (nada decorativo).

import { clamp, smoothstep } from "./math.ts";

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
  /** alternador (bobina de carga do volante): corrente máxima (A) e fração dela já na marcha lenta */
  altMaxA: number;
  altIdleFrac: number;
  /** false = motor de partida manual sem bateria (bote): sem tensão, sem alternador */
  hasBattery: boolean;
  /** combustível que fica na linha/filtro/cuba depois do registro do tanque (L): com o registro fechado o motor
   *  ainda roda até gastar isso. Ausente = 0,08 L */
  lineL?: number;
  /**
   * Tensão nominal do sistema (12 ou 24 V). O modelo elétrico trabalha SEMPRE em "equivalente 12 V" (tensões,
   * limites, correntes e Ah referidos a um bloco de 12 V); num sistema de 24 V (duas baterias de 12 V em série,
   * starter-gerador de 28 V da turbina) a telemetria mostra tensão × 2 e corrente ÷ 2 — mesma energia.
   */
  nominalV?: number;
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
  altMaxA: 35,       // 150 hp 4T: alternador de ~35 A
  altIdleFrac: 0.27, // ~9–10 A já em marcha lenta (750 rpm)
  hasBattery: true,
};

/** Booster de partida (jump start): capacidade (Ah) e corrente máxima (A) — acima dela a proteção desarma. */
export const JUMP_AH = 10;
export const JUMP_MAX_A = 200;
/** Resistência interna do booster (Ω): a 200 A a tensão cai ~2,4 V. */
const JUMP_R = 0.012;
/**
 * GPU (ground power unit, fonte de solo da doca): 28 V DC estabilizados, como as usadas para dar partida em
 * turbinas. No modelo "equivalente 12 V" (ver `nominalV`) = 14 V com resistência baixíssima e energia da rede
 * (não descarrega). Fornece a partida e as cargas e ainda carrega a bateria.
 */
export const GPU_V = 28;
/** tempo para o diesel da GPU pegar e estabilizar a rotação antes de chavear a energia (s) */
export const GPU_START_S = 4.5;
/** depois de o cabo sair, o diesel da GPU roda sem carga por alguns segundos (esfriando) e então desliga (s) */
export const GPU_STOP_S = 4;
const GPU_V12 = 14.0, GPU_R = 0.0025;

export interface EngineSystemsInput {
  engine: "off" | "cranking" | "running";
  rpm: number;
  fuelLph: number;
  load: number;              // acelerador efetivo 0..1
  intakeSubmerged: boolean;  // entrada d'água de refrigeração dentro d'água
  lightsOn: boolean;
  starterLoad?: number;      // 0..1: arranque girando (1) ou travado/solenoide (0,2)
  trimMotorA?: number;       // bomba elétrica do power trim (A)
  auxA?: number;             // outras cargas (molinete da âncora, bomba de porão) (A)
  alternators?: number;      // motores com alternador girando (2 na lancha rápida)
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
  /** booster portátil (jump start) ligado nos bornes, em paralelo com a bateria */
  jumper = false;
  /** carga do booster 0..1 (de JUMP_AH); fornece arranque, molinete, trim, luzes… e recarrega com o motor em cruzeiro */
  jumpCharge = 1;
  /** desarmes da proteção de sobrecorrente do booster (> JUMP_MAX_A) — o HUD avisa */
  jumperTrips = 0;
  /** corrente fornecida pelo booster no último passo (A) */
  jumpA = 0;
  private prevEngine: EngineSystemsInput["engine"] = "off";
  /** contador de desconexões automáticas do booster (o motor pegou) — o HUD avisa */
  jumperAutoOff = 0;
  /** corrente na bateria (A): + carregando, − descarregando (o amperímetro do painel) */
  batteryA = 0;
  /**
   * GPU da doca: `gpu` = cabo conectado e GPU pedida (só a lancha de turbina usa; quem decide se está na doca é o
   * jogo). Ela é um gerador a DIESEL: ao conectar, o motor dela dá partida e estabiliza (`gpuState` "starting",
   * ~GPU_START_S) e só então a energia externa é chaveada no barramento ("online").
   */
  gpu = false;
  gpuState: "off" | "starting" | "online" | "stopping" = "off";
  /** tempo desde que a GPU foi pedida (s) — o som do diesel segue esta curva */
  gpuT = 0;
  /** tempo desde que o cabo saiu, com o diesel ainda rodando ("stopping") */
  gpuStopT = 0;
  get gpuOnline(): boolean { return this.gpuState === "online"; }
  /**
   * Relé EXT PWR: liga a GPU ao barramento. São DOIS comandos: o cabo (`gpu`, tecla J, físico) e este relé. Com
   * `autoExt` (FADEC) ele fecha sozinho com a GPU estável e a turbina parada/partindo e abre na marcha lenta; no
   * manual é a chave EXT PWR do painel. A GPU só alimenta com o cabo, o diesel estável e o relé fechado.
   */
  extPwr = false;
  autoExt = true;
  get extOnline(): boolean { return this.gpuOnline && this.extPwr; }
  /**
   * BARRAMENTO (24 V na turbina) com três fontes, cada uma no seu relé: a BATERIA (`batteryOn`, chave BAT), a GPU
   * (EXT PWR, quando "online") e o GERADOR do motor (`genOn`, chave GEN; o starter-gerador da turbina). Os
   * periféricos (starter, velas, bomba, luzes, trim, bomba de porão) estão todos nesse barramento: com a BAT
   * desligada eles só funcionam se a GPU ou o gerador (motor girando) estiverem alimentando. `batteryV` é a tensão
   * do BARRAMENTO (com a bateria ligada, é a dela).
   */
  batteryOn = true;
  genOn = true;
  /** registro (válvula) do tanque de combustível: fechado, o motor só tem o que sobrou na linha */
  fuelValveOpen = true;
  /** combustível na linha depois do registro (L) */
  lineL: number;
  /** chega combustível ao motor (tanque com registro aberto, ou ainda há na linha) */
  get fuelFeed(): boolean { return this.fuelValveOpen ? this.fuelL > 0.005 : this.lineL > 0.0005; }
  get lineFrac(): number { return this.lineL / (this.p.lineL ?? 0.08); }
  /** potência que a GPU está fornecendo (kW reais) */
  gpuKw = 0;
  /** corrente do alternador/gerador no último passo (A, equivalente 12 V) */
  get alternatorA(): number { return this.altA; }
  /** o gerador está alimentando o barramento (passo anterior) */
  private genLive = false;
  /** desconexões automáticas da GPU (a turbina chegou à marcha lenta) — o HUD avisa */
  gpuAutoOff = 0;
  /** corrente fornecida pela GPU no último passo (A, equivalente 12 V) */
  gpuA = 0;
  /** corrente do alternador no último passo (A) */
  private altA = 0;
  /** pedido de desligamento (sem combustível ou superaquecimento extremo) */
  stallReason: "" | "fuel" | "overheat" = "";
  private sputter = 0;

  constructor(p: EngineSystemsParams = ENGINE_SYSTEMS, opts: { fuelFrac?: number; coolantC?: number; hours?: number } = {}) {
    this.p = p;
    this.fuelL = p.tankLiters * (opts.fuelFrac ?? 1);
    this.lineL = p.lineL ?? 0.08;
    this.coolantC = opts.coolantC ?? 45;
    this.engineHours = opts.hours ?? 0;
  }

  get fuelFrac(): number { return this.fuelL / this.p.tankLiters; }
  get overheatWarn(): boolean { return this.coolantC >= this.p.warnC; }
  get lowFuel(): boolean { return this.fuelFrac < 0.12; }
  get chargeWarn(): boolean { return this.p.hasBattery && this.batteryV < 12.2; }
  /** Resistência interna (Ω): sobe quando a bateria descarrega — a tensão despenca na partida. */
  get internalR(): number { return (0.009 + 0.03 * (1 - this.batterySoc) ** 2) * (50 / this.p.batteryAh); } // baterias em paralelo: R cai
  /**
   * Tensão em repouso pelo estado de carga (chumbo-ácido 12 V): 12,7 V cheia, ~12,2 V a 50 %, ~11,9 V a 15 %;
   * abaixo disso despenca — zerada fica em ~10,2 V (célula esgotada).
   */
  get restV(): number { return 12.7 - 0.9 * (1 - this.batterySoc) - 1.6 * (1 - smoothstep(0, 0.15, this.batterySoc)); }
  /** Tensão nos bornes com o arranque puxando a corrente cheia (para prever a partida). */
  get crankV(): number { return this.supplyV(this.p.starterA); }
  /** Fonte vista pelos consumidores: bateria sozinha ou em paralelo com o booster (12,9 V, 6 mΩ). */
  private get source(): { v: number; r: number } {
    const v = this.restV, r = this.internalR + 0.003;
    if (this.extOnline) return { v: GPU_V12, r: GPU_R }; // fonte de solo no barramento (EXT PWR fechado)
    if (!this.batteryOn) return { v: this.genLive ? 13.8 : 0, r: 0.004 }; // bateria fora: só o gerador (se girando)
    if (!this.jumper) return { v, r };
    // booster: 12,9 V cheio, cai devagar com a descarga e despenca nas últimas reservas
    const c = this.jumpCharge;
    const jv = 12.9 - 0.6 * (1 - c) - 3.0 * (1 - smoothstep(0, 0.08, c));
    return jv > v ? { v: jv, r: JUMP_R } : { v, r };
  }
  /** Carga do booster (Ah). */
  get jumpAh(): number { return this.jumpCharge * JUMP_AH; }
  /** Partidas que ainda cabem no booster (aprox.: ~1 s de arranque cada, na escala de tempo do jogo). */
  get jumpStartsLeft(): number { return Math.floor(this.jumpAh / ((this.p.starterA * 1.0 * this.p.batteryTimeScale) / 3600)); }
  /** Tensão nos bornes puxando `amps` (o alternador, girando, cobre parte da corrente). */
  supplyV(amps: number): number { const s = this.source; return Math.max(0, s.v - Math.max(0, amps - this.altA) * s.r); }
  /** A bomba do power trim tem força para girar? (abaixo de ~9 V sob carga só o relé estala) */
  get trimPumpOk(): boolean { return !this.p.hasBattery || this.supplyV(40) >= 9; }

  /** Pode dar partida? (combustível, bateria e temperatura) */
  canStart(): "" | "fuel" | "battery" | "overheat" {
    if (this.fuelL <= 0.05) return "fuel";
    if (this.p.hasBattery && this.supplyV(5) < 10.5) return "battery"; // morta: nem o relé arma
    if (this.coolantC > this.p.protectC) return "overheat";
    return "";
  }

  refuel(): void { this.fuelL = this.p.tankLiters; }

  update(dt: number, s: EngineSystemsInput): void {
    const P = this.p;
    const running = s.engine === "running";
    this.stallReason = "";
    // GPU: o diesel parte, estabiliza e chaveia a energia externa
    if (!this.gpu) {
      // cabo retirado: a energia sai na hora; o diesel ainda roda sem carga uns segundos e só então desliga
      this.extPwr = false;
      if (this.gpuState === "online" || this.gpuState === "starting") { this.gpuState = "stopping"; this.gpuStopT = 0; }
      if (this.gpuState === "stopping") {
        this.gpuStopT += dt; this.gpuT += dt;
        if (this.gpuStopT >= GPU_STOP_S) { this.gpuState = "off"; this.gpuT = 0; }
      } else this.gpuT = 0;
    } else {
      if (this.gpuState === "stopping") this.gpuState = "online"; // cabo de volta com o diesel ainda girando
      this.gpuT += dt;
      if (this.gpuState === "off") this.gpuState = "starting";
      if (this.gpuState === "starting" && this.gpuT >= GPU_START_S) this.gpuState = "online";
      // FADEC: fecha o EXT PWR com a GPU estável enquanto a turbina não está rodando
      if (this.autoExt && this.gpuOnline && !running) this.extPwr = true;
    }

    // ---- combustível ----
    const cap = P.lineL ?? 0.08;
    if (running) {
      if (this.fuelValveOpen) {
        this.fuelL = Math.max(0, this.fuelL - (s.fuelLph / 3600) * dt);
        if (this.fuelL <= 0) this.stallReason = "fuel";
      } else {
        // registro fechado: o motor gasta o que ficou na linha e morre
        this.lineL = Math.max(0, this.lineL - (s.fuelLph / 3600) * dt);
        if (this.lineL <= 0) this.stallReason = "fuel";
      }
    }
    // registro aberto (e tanque com combustível): a linha enche de novo
    if (this.fuelValveOpen && this.fuelL > 0.005 && this.lineL < cap) { const d = Math.min(cap - this.lineL, 0.05 * dt, this.fuelL); this.lineL += d; this.fuelL -= d; }

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
    // o alternador carrega desde a marcha lenta (~9 A a 750 rpm) e chega ao máximo por volta de 3000 rpm
    // (sem o relé do gerador — chave GEN — ou sem alternador funcionando, nada carrega)
    const charging = running && s.rpm > 550 && this.genOn && (s.alternators ?? 1) > 0;
    let drain = (s.lightsOn ? 2.5 : 0.3) + (s.trimMotorA ?? 0) + (s.auxA ?? 0); // A (instrumentos + luzes + trim + molinete/bomba de porão)
    if (s.engine === "cranking") drain += P.starterA * (s.starterLoad ?? 1); // motor de arranque
    // corrente que a bateria aceita cai perto da carga cheia (o regulador limita): o alternador fornece só o necessário
    const altCap = charging ? (s.alternators ?? 1) * P.altMaxA * (P.altIdleFrac + (1 - P.altIdleFrac) * smoothstep(750, 3000, s.rpm)) : 0;
    const accept = 3 + 60 * (1 - this.batterySoc); // A que a bateria aceita além das cargas
    const alt = Math.min(altCap, drain + accept); // A do alternador
    this.altA = alt;
    // o motor pegou com o booster ligado: ele é desconectado sozinho (como a pessoa faria)
    if (running && this.prevEngine === "cranking" && this.jumper) { this.jumper = false; this.jumperAutoOff++; }
    // idem a GPU: com a turbina em marcha lenta o cabo é retirado (o starter-gerador assume)
    // FADEC: com a turbina em marcha lenta abre o EXT PWR (a GPU sai do barramento; o cabo continua até o J)
    if (running && this.prevEngine === "cranking" && this.extOnline && this.autoExt) { this.extPwr = false; this.gpuAutoOff++; }
    this.prevEngine = s.engine;
    // booster ligado (e com carga): ele fornece as cargas do barco; a bateria fica só com o alternador
    const boosting = this.jumper && this.jumpCharge > 0 && !this.extOnline;
    this.jumpA = boosting ? Math.max(0, drain - alt) : 0;
    // GPU: fornece tudo o que falta e carrega a bateria pelo que ela aceita (até ~40 A equivalentes)
    this.gpuA = this.extOnline ? Math.max(0, drain - alt) + Math.min(40, 3 + 60 * (1 - this.batterySoc)) : 0;
    if (this.jumpA > JUMP_MAX_A) { this.jumper = false; this.jumperTrips++; this.jumpA = 0; } // proteção de sobrecorrente
    // descarga em Ah (mesma escala de tempo de jogo da bateria)
    if (this.jumpA > 0) this.jumpCharge = Math.max(0, this.jumpCharge - (this.jumpA * dt * P.batteryTimeScale) / 3600 / JUMP_AH);
    // em cruzeiro (alternador folgado) ele recarrega na tomada 12 V do barco a ~10 A (≈ 6 min de 0 a 100 %)
    // (só em cruzeiro, com folga de alternador: o carregador do booster puxa ~10 A da tomada 12 V)
    if (running && s.rpm >= 2000 && altCap - drain >= 10) this.jumpCharge = Math.min(1, this.jumpCharge + (10 * dt * P.batteryTimeScale) / 3600 / JUMP_AH);
    this.genLive = altCap > 0;
    if (!this.batteryOn) {
      // BATERIA fora do barramento: ela não carrega nem descarrega; o barramento fica com a GPU ou o gerador
      this.altA = Math.min(altCap, drain);
      this.jumpA = 0;
      this.gpuA = this.extOnline ? Math.max(0, drain - this.altA) : 0;
      this.batteryA = 0;
      const reg = 13.6 + 0.6 * smoothstep(750, 3000, s.rpm);
      const vBus = this.extOnline ? GPU_V12 - this.gpuA * GPU_R
        : altCap > 0 ? (altCap >= drain ? reg : Math.max(0, reg - (drain - altCap) * 0.05)) : 0;
      this.batteryV += (vBus - this.batteryV) * (1 - Math.exp(-dt / 0.1));
      this.gpuKw = (this.gpuA * GPU_V12) / 1000;
    } else {
    const battNet = this.extOnline ? Math.min(40, 3 + 60 * (1 - this.batterySoc)) : this.jumpA > 0 ? alt : alt - drain;
    this.batteryA = battNet;
    this.batterySoc = clamp(this.batterySoc + (battNet * dt * P.batteryTimeScale) / 3600 / this.p.batteryAh, 0, 1);
    this.gpuKw = (this.gpuA * GPU_V12) / 1000;
    const src = this.source;
    const rest = src.v;
    // queda de tensão = (resistência interna, que cresce com a descarga, + fiação) × corrente líquida
    const net = alt - drain;
    const R = src.r;
    let vTarget = rest - Math.max(0, -net) * R;
    const reg = 13.6 + 0.6 * smoothstep(750, 3000, s.rpm); // regulador 13,6 V (lenta) – 14,2 V
    if (charging && net >= 0) vTarget = reg;
    else if (charging) vTarget = Math.max(rest - (-net) * R, reg + net * 0.03); // alternador não dá conta
    this.batteryV += (vTarget - this.batteryV) * (1 - Math.exp(-dt / (s.engine === "cranking" ? 0.06 : 0.25)));
    }
    }

    // ---- horímetro ----
    if (running) this.engineHours += dt / 3600;

    // falhas de alimentação perto do fim do tanque (o motor "engasga")
    // engasga no finzinho do tanque (≈0,1 % do tanque: 0,1 L na lancha, 0,015 L no tanque portátil do bote)
    // ou no fim da linha com o registro fechado
    const low = this.fuelValveOpen ? this.fuelL < clamp(P.tankLiters * 0.001, 0.015, 0.1) : this.lineL < cap * 0.2;
    this.sputter = running && low ? this.sputter + dt : 0;
  }

  /** Engasgo por falta de combustível (0..1) — usado para cortar a combustão em pulsos. */
  get starving(): boolean { return this.sputter > 0 && Math.sin(this.sputter * 23) > 0.2; }
}
