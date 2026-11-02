// Turbina a gás de eixo livre (turboeixo marítimo, classe ~1100 shp): um GERADOR DE GÁS (compressor +
// câmara + turbina do compressor, rotação N1 em %) e uma TURBINA LIVRE de potência (N2 em %) ligada ao eixo
// de saída pela caixa de redução. Sem Babylon: roda no Node para os testes.
//
// A física é dirigida por CHAVES, como no painel real: BATERIA (barramento), BOMBA de combustível (pressão),
// IGNIÇÃO (velas), STARTER (motor de partida) e COMBUSTÍVEL (válvula / manete de condição CORTE ↔ MARCHA LENTA).
//  • o starter gira o gerador de gás (a rotação que ele alcança depende da tensão nos bornes);
//  • com combustível + ignição e N1 ≥ ~9 % a câmara ACENDE ~1 s depois (EGT sobe de uma vez);
//  • combustível SEM ignição (ou com N1 baixo) se acumula na câmara (partida "molhada"): quando acender, queima de
//    uma vez → labareda e pico de EGT;
//  • acesa, ela acelera com o starter ajudando; sem o starter só se sustenta acima de ~40 % N1 — abaixo disso
//    desacelera e esquenta (partida pendurada / "rollback");
//  • em marcha lenta (~62 % N1) o starter e a ignição devem ser desligados.
// FADEC (padrão): a automação aciona as mesmas chaves na ordem certa e protege (aborta partida pendurada, sem
// acendimento e partida quente). MANUAL: o piloto aciona cada chave; ninguém protege — passar do limite de EGT
// desgasta a turbina (`wear`).
// Corte: a válvula fecha, a chama apaga e N1/N2 desaceleram por ~20–40 s (spool-down).

import { clamp, smoothstep, lerp } from "./math.ts";

export interface TurbineParams {
  shp: number;            // potência no eixo (referência)
  idleN1: number;         // % N1 em marcha lenta
  maxN1: number;          // % N1 a plena potência
  starterN1Max: number;   // % N1 que o arranque alcança sozinho com bateria boa
  lightOffN1: number;     // % N1 em que o FADEC abre ignição + combustível
  starterCutN1: number;   // % N1 autossustentável: o FADEC desliga arranque e ignição
  egtAmbient: number;     // °C
  egtIdle: number;        // °C em marcha lenta
  egtMax: number;         // °C a plena potência
  egtStartLimit: number;  // °C: acima disso na partida = partida quente
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
export type TurbineEvent = "starter" | "ignition" | "lightoff" | "starterOff" | "idle" | "hotStart" | "noLightOff" | "hungStart"
  | "shutdown" | "flameout" | "abort" | "overtemp" | "starterOverspeed" | "wetStart";

/** chaves do painel de partida (manual) */
export type TurbineSwitch = "master" | "boostPump" | "ignition" | "starter" | "fuelValve";

export interface TurbineInput {
  lever: number;      // manete de potência 0..1 (acima da marcha lenta)
  volts: number;      // tensão no barramento (equivalente 12 V)
  fuel: boolean;      // há combustível no tanque
  load: number;       // carga da hélice (1 = absorve 100 % do torque a 100 % N2; ~0,03 em neutro)
  damage?: number;    // avaria do motor 0..1 (perde potência)
}

/** N1 mínimo para a câmara acender (fluxo de ar suficiente) e para se sustentar sem o starter */
const LIGHT_MIN_N1 = 9, SELF_SUSTAIN_N1 = 40;

export class Turbine {
  readonly p: TurbineParams;
  /** FADEC (automático) ou partida manual pelo painel */
  fadec = true;
  // ---- chaves (no FADEC a automação as aciona) ----
  master = true; boostPump = true; ignition = false; starter = false; fuelValve = true;
  // ---- estado ----
  lit = true;                 // chama acesa
  running = true;             // chegou à marcha lenta (fica até a chama apagar)
  n1: number; n2: number; egt: number; oilPsi: number;
  /** torque no eixo de saída (% do nominal) e potência entregue (fração do nominal) */
  torque = 0; power = 0;
  fuelLph = 0;
  /** fração do torque do arranque (0..1) — corrente puxada da bateria */
  starterLoad = 0;
  hotStarts = 0;
  /** combustível que entrou na câmara sem queimar (L) — partida molhada */
  pooledL = 0;
  /** desgaste por sobretemperatura (0..1): perde potência (só acontece no manual; o FADEC protege) */
  wear = 0;
  private lightT = 0;       // tempo com combustível + ignição esperando acender
  private sinceLight = 99;  // s desde o acendimento
  private sfLight = 1;      // força do arranque no acendimento (bateria boa = 1; sem starter = 0)
  private quietCut = false; // o próximo apagar foi um corte intencional (sem aviso de flameout)
  private seq: "none" | "start" = "none"; // sequência do FADEC em andamento
  private seqT = 0;
  private overtempOn = false;
  /** calor do combustível acumulado queimando de uma vez (°C a mais na EGT, decai em ~2,5 s) */
  private burst = 0;
  private events: TurbineEvent[] = [];

  constructor(p: TurbineParams) {
    this.p = p;
    this.n1 = p.idleN1; this.n2 = 45; this.egt = p.egtIdle; this.oilPsi = this.oilAt(p.idleN1);
  }

  /** Lê e limpa os eventos (para o HUD avisar e o som tocar). */
  drainEvents(): TurbineEvent[] { const e = this.events; this.events = []; return e; }
  get phase(): TurbinePhase {
    if (this.lit) return this.running ? "running" : "accel";
    if (this.fuelValve && this.ignition && (this.starter || this.n1 > 5)) return "lightoff";
    if (this.starter) return "starter";
    return this.n1 > 1 ? "spooldown" : "off";
  }
  get starting(): boolean { const ph = this.phase; return ph === "starter" || ph === "lightoff" || ph === "accel"; }
  /** estado equivalente de um motor a pistão (para a manete, a marcha e os sistemas) */
  get engineState(): "off" | "cranking" | "running" { return this.phase === "running" ? "running" : this.starting ? "cranking" : "off"; }
  get burning(): boolean { return this.lit && this.fuelValve; }
  get egtWarn(): boolean { return this.egt > this.p.egtRedline; }

  /** Fria e parada (reposicionar no píer). No FADEC a bateria fica ligada; no manual, tudo desligado. */
  cold(): void {
    this.n1 = 0; this.n2 = 0; this.egt = this.p.egtAmbient; this.oilPsi = 0;
    this.torque = 0; this.power = 0; this.fuelLph = 0; this.starterLoad = 0; this.pooledL = 0;
    this.lit = this.running = false; this.starter = this.ignition = this.fuelValve = false;
    this.master = this.boostPump = this.fadec;
    this.seq = "none"; this.lightT = 0; this.sinceLight = 99; this.quietCut = false; this.overtempOn = false; this.burst = 0;
    this.events = [];
  }
  /** Em marcha lenta (estado inicial dos testes, como os motores a pistão começam ligados). */
  idle(): void {
    this.n1 = this.p.idleN1; this.n2 = 45; this.egt = this.p.egtIdle; this.oilPsi = this.oilAt(this.p.idleN1);
    this.master = this.boostPump = this.fuelValve = true; this.starter = this.ignition = false;
    this.lit = this.running = true; this.seq = "none"; this.pooledL = 0;
  }

  // ---------------- FADEC ----------------
  /** Botão de partida do FADEC: só parada (N1 < 8 %). No manual, use as chaves. */
  start(): boolean {
    if (!this.fadec || this.starting || this.running || this.n1 > 8) return false;
    this.master = true; this.boostPump = true; this.ignition = false; this.fuelValve = false; this.starter = true;
    this.seq = "start"; this.seqT = 0;
    this.events.push("starter");
    return true;
  }
  /** Corte normal (manete de condição em CORTE). */
  shutdown(): void {
    if (!this.running) return;
    this.cutFuel(true); this.events.push("shutdown");
  }
  /** Aborta a partida (botão de novo, partida quente, sem acender…). */
  abort(why: TurbineEvent = "abort"): void {
    if (!this.starting && this.seq === "none") return;
    this.cutFuel(true); this.starter = false; this.events.push(why);
  }
  /** Fecha o combustível (chama apaga → spool-down). `quiet` = corte intencional (sem aviso de flameout). */
  cutFuel(quiet = false): void {
    this.fuelValve = false; this.ignition = false; this.seq = "none";
    if (this.lit) this.quietCut = quiet;
  }

  // ---------------- manual ----------------
  /** Aciona uma chave do painel (só no modo manual). Devolve o novo estado. */
  setSwitch(s: TurbineSwitch, on: boolean): boolean {
    if (this.fadec) return this[s];
    if (s === "starter" && on && this.n1 > 50) { this.events.push("starterOverspeed"); return false; } // embreagem do starter não engata
    if (s === "fuelValve" && !on && this.lit) this.quietCut = true;
    this[s] = on;
    if (s === "starter" && on) this.events.push("starter");
    if (s === "ignition" && on) this.events.push("ignition");
    return on;
  }
  /** Troca FADEC ↔ manual. Ao entrar no FADEC com a turbina parada as chaves voltam ao padrão dele. */
  setFadec(on: boolean): void {
    this.fadec = on; this.seq = "none";
    if (on && !this.lit && !this.starter) { this.master = true; this.boostPump = true; this.ignition = false; this.fuelValve = false; }
  }

  private oilAt(n1: number): number { return this.p.oilPsiMax * Math.pow(clamp((n1 - 4) / 70, 0, 1), 0.7); }
  /** força do arranque pela tensão nos bornes (~10,3 V sob carga ≈ 1; abaixo de ~7 V não gira) */
  private starterForce(v: number): number { return clamp((v - 7) / 3.3, 0, 1.1); }

  private fadecStep(dt: number): void {
    const P = this.p;
    if (this.seq !== "start") return;
    this.seqT += dt;
    if (!this.lit && !this.fuelValve) {
      if (this.n1 >= P.lightOffN1) {
        this.ignition = true; this.fuelValve = true; this.seqT = 0; this.events.push("ignition");
      } else if (this.seqT > 20) this.abort("hungStart");          // pendurada: não chega à rotação de ignição
    } else if (!this.lit) {
      if (this.seqT > 10) this.abort("noLightOff");                 // não acendeu (sem combustível / sem faísca)
    } else {
      if (this.starter && this.n1 >= P.starterCutN1) { this.starter = false; this.ignition = false; this.events.push("starterOff"); }
      if (this.egt > P.egtStartLimit) { this.hotStarts++; this.abort("hotStart"); }
      if (this.running) this.seq = "none";
    }
  }

  update(dt: number, inp: TurbineInput): void {
    const P = this.p;
    const k = (tau: number) => 1 - Math.exp(-dt / tau);
    if (this.fadec) this.fadecStep(dt);
    const powered = this.master && inp.volts > 6;
    const sf = this.starter && powered ? this.starterForce(inp.volts) : 0;
    const ignOn = this.ignition && powered;
    const pumpOn = this.boostPump && powered;
    // combustível chega à câmara com a válvula aberta e pressão (bomba elétrica; acima de ~45 % N1 a bomba do motor basta)
    const fuelFlow = this.fuelValve && inp.fuel && (pumpOn || this.n1 > 45);
    // starter: a embreagem solta acima de ~60 % (proteção de sobrevelocidade)
    if (this.starter && this.n1 > 60) { this.starter = false; this.events.push(this.fadec ? "starterOff" : "starterOverspeed"); }
    this.starterLoad = this.starter && powered ? clamp(1 - 0.5 * this.n1 / P.starterCutN1, 0.3, 1) : 0;

    // ---- acender / apagar ----
    let kick = 0;
    if (!this.lit) {
      if (fuelFlow && ignOn && this.n1 >= LIGHT_MIN_N1) {
        this.lightT += dt;
        if (this.lightT > 1.1) {
          this.lit = true; this.running = false; this.sinceLight = 0; this.sfLight = sf; this.lightT = 0;
          kick = this.pooledL; this.pooledL = 0;
          this.events.push("lightoff");
          if (kick > 0.05) this.events.push("wetStart");
        }
      } else this.lightT = 0;
      // combustível entrando sem queimar acumula na câmara (partida molhada)
      if (fuelFlow && !(ignOn && this.n1 >= LIGHT_MIN_N1)) this.pooledL += (P.fuelIdleLph * 0.6 / 3600) * dt;
    }
    // drenos + ar do compressor tiram o combustível acumulado
    this.pooledL = Math.max(0, this.pooledL - dt * (0.0004 + 0.00008 * this.n1));
    if (this.lit && (!fuelFlow || this.n1 < 6)) {
      this.lit = false; this.running = false;
      if (!this.quietCut) this.events.push("flameout");
      this.quietCut = false;
    }

    // ---- gerador de gás (N1) e EGT ----
    let egtTarget = P.egtAmbient + 1.2 * this.n1;
    let egtTau = this.n1 > 1 ? 5 : 4;
    let gas = 0; // potência do gerador de gás (fração do nominal)
    if (this.lit && this.running) {
      // governador da turbina livre: N2 acima de ~101 % (sem carga, ex.: em neutro) reduz o combustível
      const gov = clamp((104 - this.n2) / 3, 0, 1);
      const target = P.idleN1 + (P.maxN1 - P.idleN1) * clamp(inp.lever, 0, 1) * gov;
      let d = (target - this.n1) * k(P.spoolTau);
      d = clamp(d, -15 * dt, P.accelLimit * dt);   // a unidade de combustível limita acelerar/desacelerar
      this.n1 += d;
      gas = Math.pow(clamp((this.n1 - 55) / (100 - 55), 0, 1.06), 2) * (1 - 0.6 * Math.max(inp.damage ?? 0, this.wear));
      // EGT sobe com a potência e um pouco mais acelerando (excesso de combustível no transitório)
      egtTarget = P.egtIdle + (P.egtMax - P.egtIdle) * Math.min(1, gas) + 70 * clamp(d / (P.accelLimit * dt), 0, 1) * (gas < 0.9 ? 1 : 0);
      egtTau = 1.6;
    } else if (this.lit) {
      // acesa, acelerando até a marcha lenta: com o starter ajudando; sem ele só acima de ~40 % (abaixo: rollback)
      this.sinceLight += dt;
      let rollback = 0;
      if (sf > 0) this.n1 += (P.idleN1 + 6 - this.n1) * k(6 / (0.55 + 0.45 * sf));
      else if (this.n1 >= SELF_SUSTAIN_N1) this.n1 += (P.idleN1 + 6 - this.n1) * k(6 / 0.75);
      else { this.n1 += (0 - this.n1) * k(14); rollback = 1 - this.n1 / SELF_SUSTAIN_N1; }
      // pico de EGT: mais combustível que ar no começo; acelerar devagar (arranque fraco ou ausente) = mais quente
      const peak = 680 + 480 * Math.pow(1 - Math.min(1, this.sfLight), 1.3);
      const bump = this.n1 < 22 ? smoothstep(P.lightOffN1, 22, this.n1) : 1 - smoothstep(32, P.idleN1, this.n1);
      egtTarget = lerp(P.egtAmbient, P.egtIdle, smoothstep(0, 2.5, this.sinceLight)) + (peak - P.egtIdle) * bump + 380 * rollback;
      egtTau = 0.9;
      if (this.n1 >= P.idleN1 - 0.5) { this.running = true; this.events.push("idle"); }
    } else if (sf > 0) {
      this.n1 += (P.starterN1Max * sf - this.n1) * k(5);  // starter girando a seco
    } else {
      this.n1 += (0 - this.n1) * k(P.spoolDownTau);       // desacelerando (spool-down)
      if (this.n1 < 0.5) this.n1 = 0;
    }
    // combustível acumulado queimando de uma vez no acendimento: labareda e salto de EGT por alguns segundos
    if (kick > 0) this.burst = Math.min(750, 9000 * kick);
    this.burst *= 1 - k(2.5);
    this.egt += (egtTarget + this.burst - this.egt) * k(this.burst > 30 ? 0.5 : egtTau);
    this.oilPsi += (this.oilAt(this.n1) - this.oilPsi) * k(0.8);
    // sobretemperatura sem proteção (manual): desgasta a turbina
    const over = this.egt > P.egtStartLimit;
    if (over && !this.fadec) this.wear = Math.min(1, this.wear + dt * (this.egt - P.egtStartLimit) / 600);
    if (over && !this.overtempOn && !this.fadec) this.events.push("overtemp");
    this.overtempOn = over;

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
    this.fuelLph = fuelFlow ? (this.running ? P.fuelIdleLph + (P.fuelMaxLph - P.fuelIdleLph) * Math.min(1.05, gas) : P.fuelIdleLph * 0.6) : 0;
  }
}
