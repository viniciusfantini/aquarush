// Painel de SISTEMAS do barco (tecla Y nas embarcações a pistão; na AR-10 o Y abre o painel de partida da
// turbina, que tem a mesma linha de sistemas). Lê só a telemetria (regra do HUD) e manda comandos por callbacks.
//  • chave de baterias: OFF / LIGADA (um banco) ou OFF / IND. / BB / BE / AMBAS (AR-9, dois bancos);
//  • registro do tanque de combustível: ABERTO / FECHADO (fechado, o motor roda com o que ficou na linha e morre);
//  • afogador (bote carburado): EMPURRADO / PUXADO;
//  • bomba de porão: OFF / AUTO / ON;
//  • luzes de navegação.

import type { BoatTelemetry } from "../sim/boat.ts";
import { makeDraggable } from "./dragPanel.ts";

export type BatterySel = "off" | "ind" | "bb" | "be" | "both";
export type BilgeMode = "off" | "auto" | "on";

export interface SystemsPanelActions {
  setBattery(sel: BatterySel): void;
  setFuelValve(open: boolean): void;
  setChoke(on: boolean): void;
  setBilge(mode: BilgeMode): void;
  toggleLights(): void;
  close(): void;
}

export interface SystemsPanelCaps {
  title: string;
  banks: 0 | 1 | 2;     // 0 = sem bateria (bote)
  choke: boolean;
  bilgePump: boolean;
  lights: string;       // "LUZES" / "LANTERNA"
}

export class SystemsPanel {
  readonly el: HTMLElement;
  private open = false;
  private readonly act: SystemsPanelActions;
  private caps: SystemsPanelCaps = { title: "", banks: 1, choke: false, bilgePump: true, lights: "LUZES" };

  constructor(act: SystemsPanelActions) {
    this.act = act;
    const el = document.createElement("div");
    el.id = "spanel";
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      const d = b.dataset;
      if (b.classList.contains("tp-x")) this.act.close();
      else if (d.bat) this.act.setBattery(d.bat as BatterySel);
      else if (d.fuel) this.act.setFuelValve(d.fuel === "open");
      else if (d.choke) this.act.setChoke(d.choke === "on");
      else if (d.bilge) this.act.setBilge(d.bilge as BilgeMode);
      else if (d.lights) this.act.toggleLights();
    });
    document.body.appendChild(el);
    this.el = el;
    this.setOpen(false);
  }

  /** Monta os controles do barco ativo. */
  configure(caps: SystemsPanelCaps): void {
    this.caps = caps;
    const seg = (key: string, opts: [string, string][]) => `<div class="sp-seg">${opts.map(([v, l]) => `<button data-${key}="${v}">${l}</button>`).join("")}</div>`;
    const row = (label: string, sub: string, ctl: string, info = "") => `<div class="sp-row"><div class="sp-lbl"><b>${label}</b><span>${sub}</span></div>${ctl}<div class="sp-info" data-info="${label}">${info}</div></div>`;
    const rows: string[] = [];
    if (caps.banks === 2) rows.push(row("BATERIAS", "chave geral dos dois bancos", seg("bat", [["off", "OFF"], ["ind", "IND."], ["bb", "BB"], ["be", "BE"], ["both", "AMBAS"]])));
    else if (caps.banks === 1) rows.push(row("BATERIA", "chave geral", seg("bat", [["off", "OFF"], ["ind", "LIGADA"]])));
    rows.push(row("COMBUSTÍVEL", "registro do tanque", seg("fuel", [["closed", "FECHADO"], ["open", "ABERTO"]])));
    if (caps.choke) rows.push(row("AFOGADOR", "carburador: partida a frio", seg("choke", [["off", "EMPURRADO"], ["on", "PUXADO"]])));
    if (caps.bilgePump) rows.push(row("BOMBA DE PORÃO", "boia automática ou manual", seg("bilge", [["off", "OFF"], ["auto", "AUTO"], ["on", "ON"]])));
    rows.push(row(caps.lights, "navegação", `<div class="sp-seg"><button data-lights="1">LIGAR / DESLIGAR</button></div>`));
    this.el.innerHTML = `
      <div class="tp-head"><b>⠿ SISTEMAS — ${caps.title}</b><button class="tp-x" aria-label="fechar">×</button></div>
      ${rows.join("")}
      <p class="sp-note" data-note></p>`;
    makeDraggable(this.el, this.el.querySelector<HTMLElement>(".tp-head")!, "aquarush.spanelPos");
  }

  get isOpen(): boolean { return this.open; }
  setOpen(on: boolean): void { this.open = on; this.el.classList.toggle("open", on); }

  update(t: BoatTelemetry, lightsOn: boolean): void {
    if (!this.open) return;
    const sel = (key: string, v: string) => { for (const b of this.el.querySelectorAll<HTMLButtonElement>(`[data-${key}]`)) b.classList.toggle("on", b.dataset[key] === v); };
    sel("bat", t.batterySel === "off" ? "off" : this.caps.banks === 1 ? "ind" : t.batterySel);
    sel("fuel", t.fuelValveOpen ? "open" : "closed");
    sel("choke", t.choke ? "on" : "off");
    sel("bilge", t.bilgeMode);
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("[data-lights]")) b.classList.toggle("on", lightsOn);
    const info = (label: string, txt: string) => { const e = this.el.querySelector<HTMLElement>(`[data-info="${label}"]`); if (e && e.textContent !== txt) e.textContent = txt; };
    if (this.caps.banks === 2) info("BATERIAS", `BB ${t.batteryVs[0]?.toFixed(1)} V · BE ${t.batteryVs[1]?.toFixed(1)} V`);
    else if (this.caps.banks === 1) info("BATERIA", `${t.batteryV.toFixed(1)} V · ${Math.round(t.batterySoc * 100)} %`);
    info("COMBUSTÍVEL", t.fuelValveOpen ? `${t.fuelL.toFixed(1)} L no tanque` : `linha: ${Math.round(t.fuelLineFrac * 100)} %`);
    if (this.caps.choke) info("AFOGADOR", t.coolantC < 40 ? `motor frio (${t.coolantC.toFixed(0)} °C)` : `motor quente (${t.coolantC.toFixed(0)} °C)`);
    if (this.caps.bilgePump) info("BOMBA DE PORÃO", `${t.bilgePump ? "bombeando" : "parada"} · ${t.bilgeL.toFixed(0)} L`);
    info(this.caps.lights, lightsOn ? "acesas" : "apagadas");
    const note = this.el.querySelector<HTMLElement>("[data-note]")!;
    const n = !t.fuelValveOpen && t.engine === "running" ? "Registro FECHADO: o motor vai morrer quando acabar o combustível da linha."
      : this.caps.choke && t.choke && t.coolantC > 45 && t.engine === "running" ? "Motor quente com o afogador puxado: mistura rica — empurre o afogador antes que ele afogue."
      : this.caps.choke && !t.choke && t.coolantC < 40 && t.engine !== "running" ? "Motor frio: puxe o afogador para dar a partida (e empurre quando ele esquentar)."
      : t.batterySel === "off" && this.caps.banks > 0 ? "Chave de baterias em OFF: sem partida, sem bomba de porão, sem luzes." : "";
    if (note.textContent !== n) note.textContent = n;
  }
}
