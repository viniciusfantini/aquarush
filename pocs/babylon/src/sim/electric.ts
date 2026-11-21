// Propulsão ELÉTRICA (barco hydrofoil AR-E): bateria de alta tensão (HV, ~400 V), contatores com PRÉ-CARGA,
// inversor + motor elétrico no pod da hélice, conversor DC-DC que alimenta a casa de 12 V e o carregador de cais.
// Sem Babylon: roda no Node para os testes.
//
// Como num carro/barco elétrico real:
//  • A bateria HV fica ISOLADA por dois contatores. Quem os fecha é o BMS, que vive na rede de 12 V: com a bateria de
//    12 V descarregada (< `minV12` sob carga) o BMS não acorda e o barco não liga — mesmo com a HV cheia.
//  • Ligar a HV = PRÉ-CARGA: um contator auxiliar com resistor carrega devagar o capacitor do inversor (o barramento
//    DC sobe exponencialmente até a tensão da bateria); só com ele a ≥ 95 % o contator principal fecha ("HV ON").
//    Fechar direto daria um pico de centenas de ampères (solda o contator).
//  • Com a HV ligada, o DC-DC carrega a bateria de 12 V (é o "alternador" do barco elétrico).
//  • READY = inversor habilitado (o "motor ligado"): só então o acelerador faz o motor girar. Parado em READY o motor
//    não gira (não há marcha lenta) e quase não consome.
//  • Potência: quem pede é a hélice (a física calcula o empuxo e a potência no eixo pela teoria do disco atuador); o
//    inversor limita ao que o motor e a bateria entregam (`availKw`: cai com a bateria quase vazia — modo tartaruga —
//    e com o motor quente). A corrente da bateria é P / V e a tensão cai com a resistência interna.
//  • Motor e inversor são refrigerados pela água em volta do pod (fora d'água esquentam rápido e perdem potência).

import { clamp, smoothstep } from "./math.ts";

export interface ElectricParams {
  /** energia útil da bateria HV (kWh) e tensão nominal (V) */
  packKwh: number;
  nominalV: number;
  /** células em série (NMC: 3,0 V vazia → 4,15 V cheia) e resistência interna do pacote (Ω) */
  cellsS: number;
  packR: number;
  /** potência máxima e contínua do(s) motor(es) no eixo (kW) e rendimento motor + inversor */
  motorKw: number;
  contKw: number;
  etaDrive: number;
  /** rendimento da hélice em relação ao disco atuador ideal e a área total dos discos (m², duas hélices) */
  etaProp: number;
  propDiskM2: number;
  /** tempo mínimo da pré-carga (s) e constante de tempo do capacitor pelo resistor (s) */
  prechargeS: number;
  prechargeTau: number;
  /** tensão mínima da rede de 12 V (sob a carga do BMS) para os contatores fecharem e ficarem fechados */
  minV12: number;
  /** consumo fixo com a HV ligada (bombas de arrefecimento, BMS, inversor ocioso) (kW) */
  idleKw: number;
  /** carregador do cais: potência (kW) e aceleração de jogo do tempo de carga (o cais real leva ~2 h) */
  chargerKw: number;
  chargeTimeScale: number;
}

export type HvPhase = "off" | "precharge" | "on";

export interface ElectricInput {
  /** tensão da rede de 12 V (nos bornes, com a carga do BMS) */
  v12: number;
  /** potência pedida no eixo pela hélice (kW, ≥ 0) */
  shaftKw: number;
  /** outras cargas na HV (DC-DC para os 12 V, atuadores) (kW) */
  auxKw: number;
  /** o pod (motor) está dentro d'água — refrigerado */
  cooled: boolean;
}

export class ElectricDrive {
  readonly p: ElectricParams;
  /** estado de carga da HV (0..1) */
  soc: number;
  /** chave HV (o piloto pediu a HV ligada) e a fase dos contatores */
  hvSwitch = false;
  phase: HvPhase = "off";
  /** READY: inversor habilitado — o acelerador comanda o motor */
  ready = false;
  /** o P ligou a HV e quer READY assim que a pré-carga terminar */
  autoReady = false;
  /** tensão do barramento DC (capacitor do inversor) (V) */
  linkV = 0;
  /** corrente da bateria HV (A; + descarregando, − carregando) e potência elétrica (kW; + consumindo) */
  packA = 0;
  kw = 0;
  /** potência no eixo entregue neste passo (kW) */
  shaftKw = 0;
  /** temperaturas: motor/inversor e bateria (°C) */
  motorC = 26;
  packC = 26;
  /** carregador do cais conectado e carregando */
  shore = false;
  charging = false;
  /** último motivo de a HV ter caído/não ter ligado ("" = nenhum) */
  fault: "" | "12v" | "empty" = "";
  private preT = 0;

  constructor(p: ElectricParams, soc = 0.6) { this.p = p; this.soc = soc; }

  /** capacidade (Ah) */
  get ah(): number { return (this.p.packKwh * 1000) / this.p.nominalV; }
  /** energia restante (kWh) */
  get kwhLeft(): number { return this.soc * this.p.packKwh; }
  /** tensão de circuito aberto pelo estado de carga (NMC: cai devagar e despenca no fim) */
  get ocv(): number { return this.p.cellsS * (3.0 + 0.3 * smoothstep(0, 0.08, this.soc) + 0.85 * this.soc); }
  /** tensão nos bornes com a corrente atual */
  get packV(): number { return this.phase === "on" ? Math.max(0, this.ocv - this.packA * this.p.packR) : this.ocv; }
  /** potência disponível no eixo (kW): motor, bateria (modo tartaruga < 6 %) e temperatura do motor (> 105 °C) */
  get availKw(): number {
    if (!this.ready || this.phase !== "on") return 0;
    const socF = this.soc <= 0.002 ? 0 : 0.3 + 0.7 * smoothstep(0.02, 0.06, this.soc);
    const tempF = 1 - 0.6 * smoothstep(105, 135, this.motorC);
    return this.p.motorKw * socF * tempF;
  }
  /** tartaruga: potência cortada pela bateria quase vazia ou motor quente */
  get limited(): boolean { return this.ready && this.availKw < this.p.motorKw * 0.95; }

  /** chave HV: liga = começa a pré-carga; desliga = abre os contatores (e tira o READY) */
  setHv(on: boolean): void {
    this.hvSwitch = on;
    if (!on) { this.phase = "off"; this.ready = false; this.autoReady = false; this.preT = 0; }
  }
  /** HV ligada e READY na hora (testes / "motor ligado" por fora, como `engine = "running"` nos outros barcos) */
  forceReady(): void { this.hvSwitch = true; this.phase = "on"; this.ready = true; this.autoReady = false; this.linkV = this.ocv; this.fault = ""; }
  /** READY liga/desliga (só com a HV ligada) */
  setReady(on: boolean): boolean {
    if (on && this.phase !== "on") return false;
    this.ready = on; if (!on) this.autoReady = false;
    return true;
  }

  update(dt: number, s: ElectricInput): void {
    const P = this.p;
    this.fault = this.fault === "empty" && this.soc > 0.01 ? "" : this.fault;
    // ---- contatores ----
    const bmsOk = s.v12 >= P.minV12;
    if (this.hvSwitch && !bmsOk) {
      // sem 12 V o BMS desliga: os contatores abrem (a HV "cai")
      if (this.phase !== "off") { this.phase = "off"; this.ready = false; this.autoReady = false; }
      this.fault = "12v"; this.preT = 0;
    } else if (this.hvSwitch && this.soc <= 0.0005) {
      if (this.phase !== "off") { this.phase = "off"; this.ready = false; }
      this.fault = "empty";
    } else if (this.hvSwitch) {
      if (this.phase === "off") { this.phase = "precharge"; this.preT = 0; this.fault = ""; }
      if (this.phase === "precharge") {
        this.preT += dt;
        this.linkV += (this.ocv - this.linkV) * (1 - Math.exp(-dt / P.prechargeTau));
        if (this.preT >= P.prechargeS && this.linkV >= 0.95 * this.ocv) this.phase = "on";
      }
    }
    if (this.phase === "on") this.linkV = this.packV;
    else if (this.phase === "off") this.linkV *= Math.exp(-dt / 1.2); // capacitor descarregando pelo resistor de dreno
    if (this.phase === "on" && this.autoReady) { this.ready = true; this.autoReady = false; }
    if (this.phase !== "on") this.ready = false;

    // ---- potência e corrente ----
    this.shaftKw = this.ready ? Math.min(s.shaftKw, this.availKw) : 0;
    const driveLoss = this.shaftKw > 0 ? this.shaftKw / P.etaDrive : 0;
    const idle = this.phase === "on" ? P.idleKw : 0;
    this.charging = this.shore && !this.ready && this.soc < 0.999;
    const chg = this.charging ? -P.chargerKw * (this.soc < 0.8 ? 1 : Math.max(0.08, (1 - this.soc) / 0.2)) : 0;
    this.kw = driveLoss + (this.phase === "on" ? s.auxKw : 0) + idle + chg;
    const v = Math.max(200, this.ocv);
    this.packA = (this.kw * 1000) / v;
    // energia: descarga em tempo real; a carga do cais é acelerada (jogo)
    const kwh = (this.kw * dt) / 3600 * (chg < 0 ? P.chargeTimeScale : 1);
    this.soc = clamp(this.soc - kwh / P.packKwh, 0, 1);

    // ---- temperaturas ----
    const r = this.shaftKw / P.contKw;
    const mTarget = s.cooled ? 24 + 48 * r * r : 26 + 160 * r * r + (this.ready ? 8 : 0);
    this.motorC += (mTarget - this.motorC) * (1 - Math.exp(-dt / (s.cooled ? 45 : 25)));
    const pTarget = 26 + 14 * Math.min(2, (Math.abs(this.kw) / P.contKw) ** 2);
    this.packC += (pTarget - this.packC) * (1 - Math.exp(-dt / 400));
  }
}
