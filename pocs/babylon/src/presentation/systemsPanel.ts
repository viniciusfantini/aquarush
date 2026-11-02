// Painel de SISTEMAS do barco (tecla Y nas embarcações a pistão; na AR-10 o Y abre o painel de partida da
// turbina, que tem a mesma linha de sistemas). Lê só a telemetria (regra do HUD) e manda comandos por callbacks.
//  • chave de baterias: OFF / LIGADA (um banco) ou OFF / IND. / BB / BE / AMBAS (AR-9, dois bancos);
//  • registro do tanque de combustível: ABERTO / FECHADO (fechado, o motor roda com o que ficou na linha e morre);
//  • afogador (bote carburado): EMPURRADO / PUXADO;
//  • bomba de porão: OFF / AUTO / ON;
//  • luzes de navegação.

import type { BoatTelemetry } from "../sim/boat.ts";
import { makeDraggable } from "./dragPanel.ts";
import { toggle, tri, rotary, pull, setToggle, setTri, setRotary, setPull, isOn } from "./switches.ts";

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
      else if (d.fuel) this.act.setFuelValve(!isOn(b));
      else if (d.choke) this.act.setChoke(!isOn(b));
      else if (d.bilge) this.act.setBilge(d.bilge as BilgeMode);
      else if (d.lights) this.act.toggleLights();
    });
    document.body.appendChild(el);
    this.el = el;
    this.setOpen(false);
  }

  /** Monta o painel de chaves do barco ativo. */
  configure(caps: SystemsPanelCaps): void {
    this.caps = caps;
    const cell = (ctl: string, info: string, wide = false) => `<div class="sw-cell${wide ? " wide" : ""}">${ctl}<div class="rd" data-info="${info}"></div></div>`;
    const cells: string[] = [];
    if (caps.banks === 2) cells.push(cell(rotary("bat", "BATERIAS", "chave geral · 2 bancos", [{ v: "off", l: "OFF" }, { v: "ind", l: "IND" }, { v: "bb", l: "BB" }, { v: "be", l: "BE" }, { v: "both", l: "AMBAS" }]), "bat", true));
    else if (caps.banks === 1) cells.push(cell(rotary("bat", "BATERIA", "chave geral", [{ v: "off", l: "OFF" }, { v: "ind", l: "ON" }]), "bat", true));
    cells.push(cell(toggle({ attr: "fuel", val: "1", label: "COMBUSTÍVEL", sub: "registro do tanque", on: "ABERTO", off: "FECHADO", variant: "red" }), "fuel"));
    if (caps.choke) cells.push(cell(pull("choke", "1", "AFOGADOR", "partida a frio"), "choke"));
    if (caps.bilgePump) cells.push(cell(tri("bilge", "BOMBA PORÃO", "boia ou manual", { v: "on", l: "ON" }, { v: "off", l: "OFF" }, { v: "auto", l: "AUTO" }), "bilge"));
    cells.push(cell(toggle({ attr: "lights", val: "1", label: caps.lights, sub: "navegação" }), "lights"));
    this.el.innerHTML = `
      <div class="tp-head"><b>⠿ SISTEMAS — ${caps.title}</b><button class="tp-x" aria-label="fechar">×</button></div>
      <div class="sw-plate"><span class="screw s1"></span><span class="screw s2"></span><span class="screw s3"></span><span class="screw s4"></span>${cells.join("")}</div>
      <p class="sp-note" data-note></p>`;
    makeDraggable(this.el, this.el.querySelector<HTMLElement>(".tp-head")!, "aquarush.spanelPos");
  }

  get isOpen(): boolean { return this.open; }
  setOpen(on: boolean): void { this.open = on; this.el.classList.toggle("open", on); }

  update(t: BoatTelemetry, lightsOn: boolean): void {
    if (!this.open) return;
    const el = this.el;
    setRotary(el, "bat", t.batterySel === "off" ? "off" : this.caps.banks === 1 ? "ind" : t.batterySel);
    setToggle(el, "fuel", "1", t.fuelValveOpen);
    setPull(el, "choke", t.choke);
    setTri(el, "bilge", t.bilgeMode);
    setToggle(el, "lights", "1", lightsOn);
    // a lâmpada da bomba acende quando o motor dela está girando (em AUTO, só com a boia)
    for (const c of el.querySelectorAll<HTMLElement>(".tri[data-tri=bilge]")) c.classList.toggle("run", t.bilgePump);
    const info = (k: string, txt: string, warn = false) => {
      const e = el.querySelector<HTMLElement>(`[data-info="${k}"]`);
      if (!e) return;
      if (e.textContent !== txt) e.textContent = txt;
      e.classList.toggle("warn", warn);
    };
    if (this.caps.banks === 2) info("bat", `BB ${t.batteryVs[0]?.toFixed(1)} V · BE ${t.batteryVs[1]?.toFixed(1)} V`, t.batterySel === "off");
    else if (this.caps.banks === 1) info("bat", `${t.batteryV.toFixed(1)} V · ${Math.round(t.batterySoc * 100)} %`, t.batterySel === "off");
    info("fuel", t.fuelValveOpen ? `${t.fuelL.toFixed(1)} L no tanque` : `linha ${Math.round(t.fuelLineFrac * 100)} %`, !t.fuelValveOpen);
    if (this.caps.choke) info("choke", `motor ${t.coolantC < 40 ? "frio" : "quente"} · ${t.coolantC.toFixed(0)} °C`, t.choke && t.coolantC > 45);
    if (this.caps.bilgePump) info("bilge", `${t.bilgePump ? "bombeando" : "parada"} · ${t.bilgeL.toFixed(0)} L`, t.bilgeMode === "off" && t.bilgeL > 20);
    info("lights", lightsOn ? "acesas" : "apagadas");
    const note = el.querySelector<HTMLElement>("[data-note]")!;
    const n = !t.fuelValveOpen && t.engine === "running" ? "Registro FECHADO: o motor vai morrer quando acabar o combustível da linha."
      : this.caps.choke && t.choke && t.coolantC > 45 && t.engine === "running" ? "Motor quente com o afogador puxado: mistura rica — empurre o afogador antes que ele afogue."
      : this.caps.choke && !t.choke && t.coolantC < 40 && t.engine !== "running" ? "Motor frio: puxe o afogador para dar a partida (e empurre quando ele esquentar)."
      : t.batterySel === "off" && this.caps.banks > 0 ? "Chave de baterias em OFF: sem partida, sem bomba de porão, sem luzes." : "";
    if (note.textContent !== n) note.textContent = n;
  }
}
