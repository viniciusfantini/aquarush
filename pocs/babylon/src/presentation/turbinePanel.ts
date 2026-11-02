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

export type PanelSwitch = TurbineSwitch | "extPwr";

export interface TurbinePanelActions {
  setFadec(on: boolean): void;
  setSwitch(s: PanelSwitch, on: boolean): void;
  fadecStart(): void;   // = tecla P no FADEC
  fadecCut(): void;     // corte / abortar
  gpu(): void;          // = tecla J (cabo da GPU: conectar/desconectar)
  close(): void;
}

const SWITCHES: { id: PanelSwitch; label: string; sub: string }[] = [
  { id: "master", label: "BATERIA", sub: "relé da bateria (BAT)" },
  { id: "extPwr", label: "EXT PWR", sub: "relé da GPU no barramento" },
  { id: "boostPump", label: "BOMBA COMB.", sub: "pressão de combustível" },
  { id: "starter", label: "STARTER", sub: "gira o gerador de gás" },
  { id: "ignition", label: "IGNIÇÃO", sub: "velas (tic-tic)" },
  { id: "fuelValve", label: "COMBUSTÍVEL", sub: "CORTE ↔ MARCHA LENTA" },
  { id: "generator", label: "GERADOR", sub: "starter-gerador → barramento" },
];

export class TurbinePanel {
  readonly el: HTMLElement;
  private open = false;
  private readonly act: TurbinePanelActions;
  private readonly q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
  private readonly g: Record<"n1" | "egt" | "n2" | "tq" | "oil" | "oilT" | "bus" | "gpu", RoundGauge>;

  constructor(act: TurbinePanelActions) {
    this.act = act;
    const el = document.createElement("div");
    el.id = "tpanel";
    el.innerHTML = `
      <div class="tp-head" title="arraste para mover"><b>⠿ PARTIDA DA TURBINA</b>
        <div class="tp-mode"><button data-mode="fadec">FADEC</button><button data-mode="manual">MANUAL</button></div>
        <button class="tp-x" aria-label="fechar">×</button></div>
      <div class="tp-gauges"></div>
      <div class="tp-ann">${["BAT", "EXT PWR", "GEN", "STARTER", "IGNIÇÃO", "CHAMA", "EGT ALTA", "ÓLEO QUENTE"].map((k) => `<span data-a="${k}">${k}</span>`).join("")}</div>
      <div class="tp-fadec">
        <button class="tp-big" data-f="start">PARTIDA</button><button class="tp-big warn" data-f="cut">CORTE / ABORTAR</button>
        <p>O FADEC faz a sequência: EXT PWR (com a GPU estável) → starter → ignição e combustível a 12 % N1 → acende → starter e ignição desligam a 45 % → marcha lenta 62 % → GERADOR ligado e EXT PWR aberto. Aborta sozinho partida pendurada, sem acendimento e quente (EGT &gt; 780 °C).</p>
      </div>
      <div class="tp-manual">
        <div class="tp-sw">${SWITCHES.map((s, i) => `<button data-s="${s.id}"><i>${i + 1}</i><b>${s.label}</b><span>${s.sub}</span><em>OFF</em></button>`).join("")}</div>
        <ol>
          <li>uma fonte no barramento: BATERIA e/ou a GPU (cabo com J, espere ela estabilizar e feche o EXT PWR)</li>
          <li>BOMBA ligada; STARTER: o N1 sobe</li>
          <li>com o N1 em <b>12 %</b>: IGNIÇÃO e COMBUSTÍVEL (abrir antes = partida quente ou molhada)</li>
          <li>acende: a EGT sobe — vigie o limite de <b>780 °C</b> (corte o combustível se passar)</li>
          <li>com o N1 em <b>45 %</b>: desligue STARTER e IGNIÇÃO (antes = ela não se sustenta)</li>
          <li>marcha lenta (N1 62 %, EGT ~480 °C, óleo ~70 psi): ligue o <b>GERADOR</b> e abra o <b>EXT PWR</b></li>
        </ol>
      </div>
      <div class="tp-foot"><button data-g="gpu">GPU (J)</button><span data-note></span><span data-wear></span></div>`;
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.classList.contains("tp-x")) this.act.close();
      else if (b.dataset.mode) this.act.setFadec(b.dataset.mode === "fadec");
      else if (b.dataset.f === "start") this.act.fadecStart();
      else if (b.dataset.f === "cut") this.act.fadecCut();
      else if (b.dataset.g) this.act.gpu();
      else if (b.dataset.s) this.act.setSwitch(b.dataset.s as PanelSwitch, !b.classList.contains("on"));
    });
    document.body.appendChild(el);
    this.el = el;
    this.makeDraggable();
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

  /** Arrasta pela barra de título; a posição fica salva (por navegador) e sempre dentro da tela. */
  private makeDraggable(): void {
    const el = this.el, head = this.q<HTMLElement>(".tp-head");
    const place = (x: number, y: number) => {
      const w = el.offsetWidth || 560, h = el.offsetHeight || 300;
      const nx = Math.min(Math.max(4, x), innerWidth - w - 4), ny = Math.min(Math.max(4, y), innerHeight - Math.min(h, 120));
      el.style.left = `${nx}px`; el.style.top = `${ny}px`; el.style.right = "auto"; el.style.bottom = "auto";
      return { x: nx, y: ny };
    };
    try {
      const saved = JSON.parse(localStorage.getItem("aquarush.tpanelPos") ?? "null") as { x: number; y: number } | null;
      if (saved) requestAnimationFrame(() => place(saved.x, saved.y));
    } catch { /* sem storage */ }
    let drag: { dx: number; dy: number } | null = null;
    head.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return; // os botões do cabeçalho continuam clicáveis
      const r = el.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      head.setPointerCapture(e.pointerId); el.classList.add("dragging");
      e.preventDefault();
    });
    head.addEventListener("pointermove", (e) => { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
    const end = () => {
      if (!drag) return;
      drag = null; el.classList.remove("dragging");
      const r = el.getBoundingClientRect();
      try { localStorage.setItem("aquarush.tpanelPos", JSON.stringify({ x: r.left, y: r.top })); } catch { /* sem storage */ }
    };
    head.addEventListener("pointerup", end); head.addEventListener("pointercancel", end);
    addEventListener("resize", () => { const r = el.getBoundingClientRect(); if (el.style.left) place(r.left, r.top); });
  }

  get isOpen(): boolean { return this.open; }
  setOpen(on: boolean): void { this.open = on; this.el.classList.toggle("open", on); }

  update(t: BoatTelemetry): void {
    if (!this.open || !t.turbine) return;
    const tb = t.turbine, blink = Math.floor(performance.now() / 350) % 2 === 0;
    this.el.classList.toggle("manual", !tb.fadec);
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("[data-mode]")) b.classList.toggle("sel", (b.dataset.mode === "fadec") === tb.fadec);
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
      "EXT PWR": t.extPwr ? "g" : t.gpu && (t.gpuState === "starting" || (t.gpuState === "online" && !t.extPwrClosed)) && blink ? "a" : "",
      STARTER: tb.starter ? "a" : "", "IGNIÇÃO": tb.ignition ? "a" : "", CHAMA: tb.lit ? "g" : "", "EGT ALTA": on && tb.egt > 720 ? "r" : "",
      "ÓLEO QUENTE": on && tb.oilRed ? (blink ? "r" : "") : on && tb.oilHot ? "r" : "",
    };
    for (const s of this.el.querySelectorAll<HTMLElement>("[data-a]")) s.className = ann[s.dataset.a ?? ""] ?? "";
    const sw: Record<PanelSwitch, boolean> = { master: tb.master, extPwr: t.extPwrClosed, boostPump: tb.boostPump, starter: tb.starterSw, ignition: tb.ignitionSw, fuelValve: tb.fuelValve, generator: tb.generator };
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("[data-s]")) {
      const id = b.dataset.s as PanelSwitch;
      const pos = sw[id]; // posição da chave (mesmo sem energia no barramento)
      b.classList.toggle("on", pos);
      b.querySelector("em")!.textContent = id === "fuelValve" ? (pos ? "LENTA" : "CORTE") : pos ? "ON" : "OFF";
    }
    this.q<HTMLButtonElement>("[data-g]").textContent = t.gpu ? (t.gpuState === "online" ? "cabo da GPU: recolher (J)" : "GPU partindo… (J)") : "conectar o cabo da GPU (J, só na doca)";
    this.q<HTMLElement>("[data-note]").textContent = tb.pooledL > 0.01 ? `combustível na câmara: ${tb.pooledL.toFixed(2)} L` : "";
    this.q<HTMLElement>("[data-wear]").textContent = tb.seized ? "TURBINA DESTRUÍDA (sobretemperatura) — R leva à oficina"
      : tb.starterLock > 0 ? `starter superaquecido: aguarde ${tb.starterLock.toFixed(0)} s`
      : tb.wear > 0.005 ? `desgaste da turbina ${(tb.wear * 100).toFixed(0)} %` : "";
  }
}
