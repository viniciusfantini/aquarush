// Painel de partida da turbina (tecla Y, só na lancha de turbina AR-10). Lê só a telemetria real (regra do HUD) e
// manda comandos por callbacks — não mexe na simulação diretamente.
//  • FADEC: botões PARTIDA e CORTE/ABORTAR (a automação aciona as chaves na ordem certa e protege a turbina);
//  • MANUAL: uma chave por etapa — BATERIA, BOMBA DE COMBUSTÍVEL, STARTER, IGNIÇÃO e COMBUSTÍVEL (manete de
//    condição CORTE ↔ MARCHA LENTA), com o procedimento escrito ao lado. Ninguém protege: errar a ordem dá
//    partida molhada, pendurada ou quente (e desgasta a turbina).
// Leituras: N1, EGT, N2, óleo, barramento, combustível acumulado na câmara e desgaste; luzes EXT PWR (GPU),
// STARTER, IGNIÇÃO, CHAMA e EGT ALTA.

import type { BoatTelemetry } from "../sim/boat.ts";
import type { TurbineSwitch } from "../sim/turbine.ts";

export interface TurbinePanelActions {
  setFadec(on: boolean): void;
  setSwitch(s: TurbineSwitch, on: boolean): void;
  fadecStart(): void;   // = tecla P no FADEC
  fadecCut(): void;     // corte / abortar
  gpu(): void;          // = tecla J (conectar/desconectar a GPU da doca)
  close(): void;
}

const SWITCHES: { id: TurbineSwitch; label: string; sub: string }[] = [
  { id: "master", label: "BATERIA", sub: "barramento 24 V" },
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

  constructor(act: TurbinePanelActions) {
    this.act = act;
    const el = document.createElement("div");
    el.id = "tpanel";
    el.innerHTML = `
      <div class="tp-head"><b>PARTIDA DA TURBINA</b>
        <div class="tp-mode"><button data-mode="fadec">FADEC</button><button data-mode="manual">MANUAL</button></div>
        <button class="tp-x" aria-label="fechar">×</button></div>
      <div class="tp-read">
        ${["N1 %", "EGT °C", "N2 %", "ÓLEO psi", "BARRAM. V", "NA CÂMARA L"].map((t, i) => `<div><span>${t}</span><b data-r="${i}">—</b></div>`).join("")}
      </div>
      <div class="tp-ann">${["BAT", "EXT PWR", "GEN", "STARTER", "IGNIÇÃO", "CHAMA", "EGT ALTA"].map((k) => `<span data-a="${k}">${k}</span>`).join("")}</div>
      <div class="tp-fadec">
        <button class="tp-big" data-f="start">PARTIDA</button><button class="tp-big warn" data-f="cut">CORTE / ABORTAR</button>
        <p>O FADEC faz a sequência: starter → ignição e combustível a 12 % N1 → acende → starter e ignição desligam a 45 % → marcha lenta 62 %. Aborta sozinho partida pendurada, sem acendimento e quente (EGT &gt; 780 °C).</p>
      </div>
      <div class="tp-manual">
        <div class="tp-sw">${SWITCHES.map((s, i) => `<button data-s="${s.id}"><i>${i + 1}</i><b>${s.label}</b><span>${s.sub}</span><em>OFF</em></button>`).join("")}</div>
        <ol>
          <li>BATERIA e BOMBA ligadas — o barramento precisa de uma fonte: bateria (BAT), GPU (EXT PWR) ou o gerador</li>
          <li>STARTER: o N1 sobe</li>
          <li>com o N1 em <b>12 %</b>: IGNIÇÃO e COMBUSTÍVEL (abrir antes = partida molhada)</li>
          <li>acende: a EGT sobe — vigie o limite de <b>780 °C</b> (corte o combustível se passar)</li>
          <li>com o N1 em <b>45 %</b>: desligue STARTER e IGNIÇÃO (antes = ela não se sustenta)</li>
          <li>marcha lenta: N1 62 %, EGT ~480 °C, óleo ~70 psi — ligue o <b>GERADOR</b> (senão a bateria não carrega)</li>
        </ol>
      </div>
      <div class="tp-foot"><button data-g="gpu">GPU (J)</button><span data-wear></span></div>`;
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.classList.contains("tp-x")) this.act.close();
      else if (b.dataset.mode) this.act.setFadec(b.dataset.mode === "fadec");
      else if (b.dataset.f === "start") this.act.fadecStart();
      else if (b.dataset.f === "cut") this.act.fadecCut();
      else if (b.dataset.g) this.act.gpu();
      else if (b.dataset.s) this.act.setSwitch(b.dataset.s as TurbineSwitch, !b.classList.contains("on"));
    });
    document.body.appendChild(el);
    this.el = el;
    this.setOpen(false);
  }

  get isOpen(): boolean { return this.open; }
  setOpen(on: boolean): void { this.open = on; this.el.classList.toggle("open", on); }

  update(t: BoatTelemetry): void {
    if (!this.open || !t.turbine) return;
    const tb = t.turbine, blink = Math.floor(performance.now() / 350) % 2 === 0;
    this.el.classList.toggle("manual", !tb.fadec);
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("[data-mode]")) b.classList.toggle("sel", (b.dataset.mode === "fadec") === tb.fadec);
    const r = [tb.n1.toFixed(1), tb.egt.toFixed(0), tb.n2.toFixed(0), tb.oilPsi.toFixed(0), t.batteryV.toFixed(1), tb.pooledL.toFixed(2)];
    this.el.querySelectorAll<HTMLElement>("[data-r]").forEach((e, i) => { e.textContent = r[i]; e.classList.toggle("hot", (i === 1 && tb.egt > 720) || (i === 5 && tb.pooledL > 0.03)); });
    const ann: Record<string, string> = {
      BAT: t.busBattery ? "g" : "", GEN: t.busGen ? "g" : tb.generator && tb.phase === "running" ? "a" : "",
      "EXT PWR": t.gpuState === "online" ? "g" : t.gpuState === "starting" && blink ? "a" : "",
      STARTER: tb.starter ? "a" : "", "IGNIÇÃO": tb.ignition ? "a" : "", CHAMA: tb.lit ? "g" : "", "EGT ALTA": tb.egt > 720 ? "r" : "",
    };
    for (const s of this.el.querySelectorAll<HTMLElement>("[data-a]")) s.className = ann[s.dataset.a ?? ""] ?? "";
    const sw: Record<TurbineSwitch, boolean> = { master: tb.master, boostPump: tb.boostPump, starter: tb.starter, ignition: tb.ignition, fuelValve: tb.fuelValve, generator: tb.generator };
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("[data-s]")) {
      const on = sw[b.dataset.s as TurbineSwitch];
      b.classList.toggle("on", on);
      b.querySelector("em")!.textContent = b.dataset.s === "fuelValve" ? (on ? "LENTA" : "CORTE") : on ? "ON" : "OFF";
    }
    this.q<HTMLButtonElement>("[data-g]").textContent = t.gpu ? (t.gpuState === "online" ? "GPU ON — desconectar (J)" : "GPU partindo… (J)") : "conectar GPU (J, só na doca)";
    this.q<HTMLElement>("[data-wear]").textContent = tb.seized ? "TURBINA DESTRUÍDA (sobretemperatura) — R leva à oficina"
      : tb.starterLock > 0 ? `starter superaquecido: aguarde ${tb.starterLock.toFixed(0)} s`
      : tb.wear > 0.005 ? `desgaste da turbina ${(tb.wear * 100).toFixed(0)} %` : "";
  }
}
