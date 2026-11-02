// Painel de partida da turbina (tecla Y, só na lancha de turbina AR-10). Lê só a telemetria real (regra do HUD) e
// manda comandos por callbacks — não mexe na simulação diretamente.
//  • FADEC: botões PARTIDA e CORTE/ABORTAR (a automação aciona as chaves na ordem certa, fecha/abre o EXT PWR da
//    GPU e protege a turbina);
//  • MANUAL: uma chave por etapa — BATERIA, EXT PWR (relé da GPU), BOMBA DE COMBUSTÍVEL, STARTER, IGNIÇÃO,
//    COMBUSTÍVEL (manete de condição CORTE ↔ MARCHA LENTA) e GERADOR, com o procedimento escrito ao lado.
//    Ninguém protege: errar a ordem dá partida molhada, pendurada ou quente (e desgasta a turbina).
// Instrumentos ANALÓGICOS com as faixas dos instrumentos de turbina (verde = normal, amarelo = cautela, vermelho =
// limite) e a leitura digital dentro: N1, EGT, N2, torque, óleo, barramento e a corrente da GPU. Sem tensão no
// barramento eles ficam apagados (ponteiro no zero). Luzes BAT / EXT PWR / GEN / STARTER / IGNIÇÃO / CHAMA / EGT ALTA.

import type { BoatTelemetry } from "../sim/boat.ts";
import type { TurbineSwitch } from "../sim/turbine.ts";
import { RoundGauge } from "./hud.ts";
import { makeDraggable } from "./dragPanel.ts";
import { LeverControls, type LeverCmd, type TrimOpts, type TrimState } from "./levers.ts";
import { toggle, tri, rotary, setToggle, setTri, setRotary, setRd, isOn } from "./switches.ts";

export type PanelSwitch = TurbineSwitch | "extPwr";

export interface TurbinePanelActions {
  setFadec(on: boolean): void;
  setSwitch(s: PanelSwitch, on: boolean): void;
  fadecStart(): void;   // = tecla P no FADEC
  fadecCut(): void;     // corte / abortar
  gpu(): void;          // = tecla J (cabo da GPU: conectar/desconectar)
  setFuelTank(open: boolean): void;              // registro do tanque (sistemas do barco)
  setBilge(mode: "off" | "auto" | "on"): void;   // bomba de porão
  setBattery(sel: "off" | "bus" | "both"): void;  // seletor de baterias (24 V: duas de 12 V em série)
  setLever(cmd: LeverCmd): void;                  // manete de potência + marcha (vai para o InputManager)
  setTrim(dir: number): void;                     // botão de trim da transmissão de superfície (segurado)
  horn(on: boolean): void;                        // buzina segurada
  close(): void;
}

const SWITCHES: { id: PanelSwitch; label: string; sub: string; on?: string; off?: string; variant?: "" | "red" | "guard" }[] = [
  { id: "master", label: "MAIN", sub: "sistemas eletrônicos" },
  { id: "extPwr", label: "EXT PWR", sub: "relé da GPU", on: "FECH", off: "ABERTO" },
  { id: "boostPump", label: "BOMBA COMB.", sub: "pressão" },
  { id: "starter", label: "STARTER", sub: "gira o N1", variant: "guard" },
  { id: "ignition", label: "IGNIÇÃO", sub: "velas" },
  { id: "fuelValve", label: "COMBUSTÍVEL", sub: "condição", on: "LENTA", off: "CORTE", variant: "red" },
  { id: "generator", label: "GERADOR", sub: "→ barramento" },
];

export class TurbinePanel {
  readonly el: HTMLElement;
  private open = false;
  private readonly act: TurbinePanelActions;
  private readonly q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
  private readonly levers: LeverControls;
  /** janela do checklist de partida (FADEC e manual), aberta pelo botão CHECKLIST */
  readonly ck: ChecklistPanel;
  private readonly g: Record<"n1" | "egt" | "n2" | "tq" | "oil" | "oilT" | "bus" | "gpu", RoundGauge>;

  constructor(act: TurbinePanelActions) {
    this.act = act;
    const el = document.createElement("div");
    el.id = "tpanel"; el.dataset.disp = "glass";
    const SCR = `<span class="screw s1"></span><span class="screw s2"></span><span class="screw s3"></span><span class="screw s4"></span>`;
    const cell = (ctl: string, k: string) => `<div class="sw-cell">${ctl}<div class="rd" data-rd="${k}"></div></div>`;
    el.innerHTML = `
      <div class="tp-head" title="arraste para mover"><b>⠿ PARTIDA DA TURBINA</b>
        <span class="tp-fl" data-fl title="quem comanda a partida: FADEC (automático, protege) ou MANUAL (você mexeu numa chave)">FADEC</span>
        <button class="tp-ck" data-ck>CHECKLIST</button><button class="tp-x" aria-label="fechar">×</button></div>
      <div class="tp-grid">
      <div class="tp-gauges"></div>
      <div class="tp-ann">${["BAT", "EXT PWR", "GEN", "STARTER", "IGNIÇÃO", "CHAMA", "EGT ALTA", "ÓLEO QUENTE"].map((k) => `<span data-a="${k}">${k}</span>`).join("")}</div>
        <div class="sw-plate tp-sw">${SCR}${SWITCHES.map((s, i) => s.id === "fuelValve"
          // a manete de condição do combustível é um seletor rotativo (como os registros), não uma chave elétrica
          ? rotary("fv", "COMBUSTÍVEL", "condição", [{ v: "cut", l: "CORTE" }, { v: "idle", l: "LENTA" }], { num: i + 1, cls: "fuel" })
          : toggle({ attr: "s", val: s.id, label: s.label, sub: s.sub, on: s.on, off: s.off, variant: s.variant, num: i + 1 })).join("")}
        </div>
        <div class="sw-plate tp-sysp">${SCR}
          ${cell(rotary("bsel", "BATERIAS", "2 × 12 V em série", [{ v: "off", l: "OFF" }, { v: "bus", l: "BUS" }, { v: "both", l: "BOTH" }]), "bat")}
          ${cell(rotary("tank", "TANQUE", "registro", [{ v: "closed", l: "FECHADO" }, { v: "open", l: "ABERTO" }], { cls: "fuel" }), "tank")}
          ${cell(tri("bilge", "BOMBA PORÃO", "boia ou manual", { v: "on", l: "ON" }, { v: "off", l: "OFF" }, { v: "auto", l: "AUTO" }), "bilge")}
        </div>
        <div class="sw-plate tp-start">${SCR}
          <div class="rb-w"><button class="rb rb-start" data-f="start" title="partida automática: o FADEC faz a sequência e protege"><span>START</span></button><b>AUTO-START</b></div>
          <div class="rb-w"><button class="rb rb-stop" data-f="cut" title="STOP: corta o combustível (no FADEC também aborta a partida)"><span>STOP</span></button></div>
        </div>
        <div class="sw-plate tp-lev">${SCR}</div>
        <div class="tp-foot"><div class="msg-rd" data-msg><span></span></div></div>
      </div>`;
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.classList.contains("tp-x")) this.act.close();
      else if (b.dataset.ck !== undefined) this.ck.setOpen(!this.ck.isOpen);
      else if (b.dataset.f === "start") this.act.fadecStart();
      else if (b.dataset.f === "cut") this.act.fadecCut();
      else if (b.dataset.g) this.act.gpu();
      else if (b.dataset.tank) this.act.setFuelTank(b.dataset.tank === "open");
      else if (b.dataset.bsel) this.act.setBattery(b.dataset.bsel as "off" | "bus" | "both");
      else if (b.dataset.fv) this.act.setSwitch("fuelValve", b.dataset.fv === "idle");
      else if (b.dataset.bilge) this.act.setBilge(b.dataset.bilge as "off" | "auto" | "on");
      else if (b.dataset.s) this.act.setSwitch(b.dataset.s as PanelSwitch, !isOn(b));
    });
    document.body.appendChild(el);
    this.el = el;
    makeDraggable(el, this.q<HTMLElement>(".tp-head"), "aquarush.tpanelPos");
    this.ck = new ChecklistPanel();
    this.levers = new LeverControls("turbine", (_i, c) => this.act.setLever(c));
    this.levers.setHorn("buzina", (on) => this.act.horn(on));
    this.q<HTMLElement>(".tp-lev").appendChild(this.levers.el);
    // instrumentos analógicos com faixas (os mesmos limites da simulação: idle 62 %, partida 780 °C, operação 700 °C)
    const box = this.q<HTMLElement>(".tp-gauges");
    this.g = {
      n1: new RoundGauge(box, { title: "N1 %", min: 0, max: 110, labels: [0, 50, 100], minor: 10, bands: [{ from: 60, to: 101, c: "g" }, { from: 102, to: 110, c: "r" }] }),
      egt: new RoundGauge(box, { title: "EGT °C", min: 0, max: 900, labels: [0, 400, 800], minor: 100, bands: [{ from: 300, to: 700, c: "g" }, { from: 700, to: 780, c: "y" }, { from: 780, to: 900, c: "r" }] }),
      n2: new RoundGauge(box, { title: "N2 %", min: 0, max: 120, labels: [0, 60, 120], minor: 10, bands: [{ from: 40, to: 103, c: "g" }, { from: 104, to: 120, c: "r" }] }),
      tq: new RoundGauge(box, { title: "TORQUE %", min: 0, max: 120, labels: [0, 60, 120], minor: 10, bands: [{ from: 0, to: 100, c: "g" }, { from: 100, to: 105, c: "y" }, { from: 105, to: 120, c: "r" }] }),
      oil: new RoundGauge(box, { title: "ÓLEO psi", min: 0, max: 100, labels: [0, 50, 100], minor: 10, bands: [{ from: 0, to: 25, c: "r" }, { from: 25, to: 45, c: "y" }, { from: 45, to: 85, c: "g" }, { from: 90, to: 100, c: "r" }] }),
      oilT: new RoundGauge(box, { title: "ÓLEO °C", min: 0, max: 150, labels: [0, 75, 150], minor: 15, bands: [{ from: 60, to: 105, c: "g" }, { from: 105, to: 120, c: "y" }, { from: 120, to: 150, c: "r" }] }),
      bus: new RoundGauge(box, { title: "BARRAM. V", min: 16, max: 32, labels: [16, 24, 32], minor: 2, bands: [{ from: 16, to: 22, c: "r" }, { from: 22, to: 24, c: "y" }, { from: 24, to: 29.5, c: "g" }, { from: 30, to: 32, c: "r" }] }),
      gpu: new RoundGauge(box, { title: "GPU A", min: 0, max: 600, labels: [0, 300, 600], minor: 50, bands: [{ from: 0, to: 500, c: "g" }, { from: 500, to: 600, c: "r" }] }),
    };
    this.setOpen(false);
  }

  /** Posição das manetes (o comando atual, do InputManager). */
  updateLevers(cmds: LeverCmd[], trim: TrimState | null = null): void { this.cmdGear = cmds[0]?.gear ?? "N"; if (this.open) { this.levers.update(cmds); this.levers.updateTrim(trim); } }
  /** marcha pedida na manete (para o aviso "sem pressão" do câmbio hidráulico) */
  private cmdGear: "F" | "N" | "R" = "N";
  configureTrim(opts: TrimOpts | null): void { this.levers.setTrim(opts, (d) => this.act.setTrim(d)); }
  private flashMsg = "";
  private flashT = -1e9;
  /** Aviso de sistemas/motor no display do pé do painel (fica ~6 s; depois volta o aviso de estado). */
  flash(msg: string): void { this.flashMsg = msg; this.flashT = performance.now(); }

  get isOpen(): boolean { return this.open; }
  setOpen(on: boolean): void { this.open = on; this.el.classList.toggle("open", on); if (!on) this.ck.setOpen(false); }

  update(t: BoatTelemetry): void {
    if (!this.open || !t.turbine) return;
    const tb = t.turbine, blink = Math.floor(performance.now() / 350) % 2 === 0;
    this.ck.update(t);
    // quem comanda a partida (indicador, não seletor): START devolve ao FADEC; mexer numa chave passa para o manual
    const fl = this.q<HTMLElement>("[data-fl]"), flTxt = tb.fadec ? "FADEC" : "MANUAL";
    if (fl.textContent !== flTxt) fl.textContent = flTxt;
    fl.classList.toggle("man", !tb.fadec);
    this.q<HTMLElement>(".rb-start").classList.toggle("busy", tb.fadec && tb.phase !== "off" && tb.phase !== "running" && tb.phase !== "spooldown" && blink);
    this.q<HTMLElement>(".rb-start").classList.toggle("lit", tb.phase === "running");
    // instrumentos: sem tensão no barramento ficam apagados (ponteiro no zero)
    const on = tb.powered;
    const set = (g: RoundGauge, v: number, txt: string, sub = "", warn = false) => { g.el.classList.toggle("off", !on); g.set(on ? v : 0, on ? txt : "—", on ? sub : "", on && warn); };
    set(this.g.n1, tb.n1, tb.n1.toFixed(1), "", tb.n1 > 102);
    set(this.g.egt, tb.egt, tb.egt.toFixed(0), "", tb.egt > 780);
    set(this.g.n2, tb.n2, tb.n2.toFixed(0), `${Math.round(t.propRpm)} rpm`, tb.n2 > 104);
    set(this.g.tq, tb.torque, tb.torque.toFixed(0), "", tb.torque > 105);
    set(this.g.oil, tb.oilPsi, tb.oilPsi.toFixed(0), "", tb.phase === "running" && tb.oilPsi < 25);
    set(this.g.oilT, tb.oilC, tb.oilC.toFixed(0), tb.oilRed ? "DANO" : tb.oilHot ? "QUENTE" : "", tb.oilHot);
    set(this.g.bus, t.batteryV, t.batteryV.toFixed(1), t.busBattery ? `bat ${t.batteryA > 0.5 ? "+" : ""}${t.batteryA.toFixed(0)} A` : "bat fora", t.batteryV < 22);
    set(this.g.gpu, t.gpuA, t.gpuA.toFixed(0), t.extPwr ? `${t.gpuKw.toFixed(1)} kW` : "", t.gpuA > 500);
    const ann: Record<string, string> = {
      BAT: t.busBattery ? "g" : "", GEN: t.busGen ? "g" : tb.generator && tb.phase === "running" ? "a" : "",
      // verde = GPU no barramento; âmbar piscando = GPU disponível/partindo mas fora do barramento (relé aberto ou sem
      // MAIN — a luz é alimentada pela própria GPU); vermelho piscando = EXT PWR em ON sem GPU conectada (falha)
      "EXT PWR": t.extPwr ? "g" : t.extPwrFault ? (blink ? "r" : "") : t.gpu && (t.gpuState === "starting" || t.gpuState === "online") && blink ? "a" : "",
      STARTER: tb.starter ? "a" : "", "IGNIÇÃO": tb.ignition ? "a" : "", CHAMA: tb.lit ? "g" : "", "EGT ALTA": on && tb.egt > 720 ? "r" : "",
      "ÓLEO QUENTE": on && tb.oilRed ? (blink ? "r" : "") : on && tb.oilHot ? "r" : "",
    };
    for (const s of this.el.querySelectorAll<HTMLElement>("[data-a]")) s.className = ann[s.dataset.a ?? ""] ?? "";
    const sw: Record<PanelSwitch, boolean> = { master: tb.master, extPwr: t.extPwrClosed, boostPump: tb.boostPump, starter: tb.starterSw, ignition: tb.ignitionSw, fuelValve: tb.fuelValve, generator: tb.generator };
    // posição das chaves (do piloto, mesmo sem energia no barramento); o LED só acende com a função energizada
    const lit: Record<PanelSwitch, boolean> = { master: tb.master && on, extPwr: t.extPwr, boostPump: tb.boostPump && on, starter: tb.starter, ignition: tb.ignition, fuelValve: false, generator: t.busGen };
    for (const id of Object.keys(sw) as PanelSwitch[]) if (id !== "fuelValve") setToggle(this.el, "s", id, sw[id], lit[id]);
    setRotary(this.el, "fv", tb.fuelValve ? "idle" : "cut");
    setRotary(this.el, "tank", t.fuelValveOpen ? "open" : "closed");
    setRotary(this.el, "bsel", t.batterySel === "off" ? "off" : t.batterySel === "bus" ? "bus" : "both");
    setTri(this.el, "bilge", t.bilgeMode, on && t.bilgeMode !== "off", t.bilgePump);
    const rd = (k: string, txt: string) => { const e = this.el.querySelector<HTMLElement>(`[data-rd="${k}"]`); if (e && e.textContent !== txt) e.textContent = txt; };
    // câmbio hidráulico: sem a turbina rodando a alavanca mexe, mas a marcha não engata

    rd("bat", `${Math.round(t.batterySoc * 100)} % · ${t.busBattery ? "24 V no barram." : "fora"}`);
    rd("tank", t.fuelValveOpen ? `${t.fuelL.toFixed(0)} L no tanque` : `linha ${Math.round(t.fuelLineFrac * 100)} %`);
    rd("bilge", `${t.bilgePump ? "bombeando" : "parada"} · ${t.bilgeL.toFixed(0)} L`);
    // (a GPU da doca é um comando externo: fica na barra de atalhos do HUD — J — e no próprio carrinho da doca)
    // display de avisos no pé do painel (caixa fixa, o texto rola): avaria/starter/desgaste e combustível na câmara
    const wear = tb.seized ? "TURBINA DESTRUÍDA (sobretemperatura) — R leva à oficina"
      : tb.starterLock > 0 ? `starter superaquecido: aguarde ${tb.starterLock.toFixed(0)} s`
      : tb.wear > 0.005 ? `desgaste da turbina ${(tb.wear * 100).toFixed(0)} %` : "";
    const pooled = tb.pooledL > 0.01 ? `combustível na câmara: ${tb.pooledL.toFixed(2)} L` : "";
    const noPress = this.cmdGear !== "N" && t.engine !== "running" ? "SEM PRESSÃO: turbina parada, a marcha não engata" : "";
    const msg = [wear, pooled, noPress].filter(Boolean).join(" · ");
    const flashing = performance.now() - this.flashT < 6000;
    setRd(this.q<HTMLElement>("[data-msg]"), flashing ? this.flashMsg : msg, !flashing && msg !== "");
  }
}

/**
 * Checklist de partida da turbina (janela à parte, arrastável). Cada item fica marcado ✓ pela telemetria real
 * (regra do HUD: nada decorativo). Duas listas: partida automática (FADEC) e partida manual, chave por chave.
 */
export class ChecklistPanel {
  readonly el: HTMLElement;
  private open = false;
  private static readonly FADEC: [string, (t: BoatTelemetry) => boolean][] = [
    ["MAIN — ON", (t) => !!t.turbine?.master],
    ["BATERIAS — BOTH (ou BUS com a GPU)", (t) => !!t.turbine?.powered],
    ["TANQUE — ABERTO", (t) => t.fuelValveOpen],
    ["MARCHA — N", (t) => t.gear === "N"],
    ["START (botão verde) ou P", (t) => !!t.turbine && t.turbine.fadec && t.turbine.phase !== "off"],
    ["Marcha lenta: N1 62 %, EGT ~480 °C", (t) => t.turbine?.phase === "running"],
    ["GPU — recolher o cabo (J)", (t) => t.turbine?.phase === "running" && !t.gpu],
  ];
  private static readonly MANUAL: [string, (t: BoatTelemetry) => boolean][] = [
    ["MAIN — ON, com fonte no barramento", (t) => !!t.turbine?.master && !!t.turbine?.powered],
    ["BOMBA COMB. — ON", (t) => !!t.turbine?.boostPump],
    ["STARTER — ON: o N1 sobe", (t) => !!t.turbine && (t.turbine.starterSw || t.turbine.n1 > 10)],
    ["N1 ≥ 12 %: IGNIÇÃO ON e COMBUSTÍVEL em LENTA", (t) => !!t.turbine && ((t.turbine.ignitionSw && t.turbine.fuelValve) || t.turbine.lit)],
    ["Acendeu: vigie a EGT (limite 780 °C)", (t) => !!t.turbine?.lit],
    ["N1 ≥ 45 %: STARTER e IGNIÇÃO OFF", (t) => !!t.turbine && t.turbine.lit && t.turbine.n1 >= 45 && !t.turbine.starterSw && !t.turbine.ignitionSw],
    ["Marcha lenta (62 %): GERADOR ON", (t) => t.turbine?.phase === "running" && !!t.turbine?.generator],
    ["EXT PWR — OFF (GPU fora do barramento)", (t) => t.turbine?.phase === "running" && !t.extPwrClosed],
  ];

  constructor() {
    const el = document.createElement("div");
    el.id = "ckpanel";
    const list = (k: string, items: [string, unknown][]) => `<ol data-l="${k}">${items.map(([txt], i) => `<li data-i="${i}"><i></i>${txt}</li>`).join("")}</ol>`;
    el.innerHTML = `<div class="tp-head"><b>⠿ CHECKLIST DE PARTIDA — AR-10</b><button class="tp-x" aria-label="fechar">×</button></div>
      <div class="ck-cols">
        <div class="ck-col" data-c="fadec"><h4>PARTIDA AUTOMÁTICA (FADEC)</h4>${list("fadec", ChecklistPanel.FADEC)}
          <p>O FADEC faz a sequência e aborta sozinho partida pendurada, sem acendimento e quente (EGT &gt; 780 °C).</p></div>
        <div class="ck-col" data-c="manual"><h4>PARTIDA MANUAL</h4>${list("manual", ChecklistPanel.MANUAL)}
          <p>Ninguém protege: combustível cedo = partida quente/molhada; starter solto antes de 45 % = rollback.</p></div>
      </div>`;
    el.querySelector(".tp-x")!.addEventListener("click", () => this.setOpen(false));
    document.body.appendChild(el);
    this.el = el;
    makeDraggable(el, el.querySelector<HTMLElement>(".tp-head")!, "aquarush.ckpanelPos");
  }

  get isOpen(): boolean { return this.open; }
  setOpen(on: boolean): void { this.open = on; this.el.classList.toggle("open", on); }

  update(t: BoatTelemetry): void {
    if (!this.open || !t.turbine) return;
    const mark = (k: string, items: [string, (t: BoatTelemetry) => boolean][]) => {
      const rows = this.el.querySelectorAll<HTMLElement>(`ol[data-l="${k}"] li`);
      let next = true; // o primeiro item ainda não feito fica em destaque
      items.forEach(([, ok], i) => {
        const done = ok(t);
        rows[i].classList.toggle("done", done);
        rows[i].classList.toggle("next", !done && next);
        if (!done) next = false;
      });
    };
    mark("fadec", ChecklistPanel.FADEC); mark("manual", ChecklistPanel.MANUAL);
    for (const c of this.el.querySelectorAll<HTMLElement>(".ck-col")) c.classList.toggle("act", (c.dataset.c === "fadec") === t.turbine.fadec);
  }
}
