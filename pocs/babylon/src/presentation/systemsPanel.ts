// Painel de SISTEMAS do barco (tecla Y nas embarcações a pistão; na AR-10 o Y abre o painel de partida da
// turbina, que tem a mesma linha de sistemas). Lê só a telemetria (regra do HUD) e manda comandos por callbacks.
//  • PARTIDA: uma chave de ignição por motor (OFF · ON com autoteste · START com mola) ou, no bote, o manete da
//    corda e o botão STOP;
//  • chave de baterias (rotativa): OFF / ON (um banco) ou OFF / IND / BB / BE / AMBAS (AR-9, dois bancos);
//  • registro do tanque de combustível (rotativo): FECHADO / ABERTO;
//  • afogador (bote carburado): EMPURRADO / PUXADO;
//  • bomba de porão: ON / OFF / AUTO; luzes de navegação.
// As chaves elétricas ficam na posição escolhida mesmo sem bateria — só o LED delas depende da tensão.

import type { BoatTelemetry } from "../sim/boat.ts";
import { makeDraggable } from "./dragPanel.ts";
import { LeverControls, type LeverCmd, type LeverKind } from "./levers.ts";
import { toggle, tri, rotary, pull, ignKey, rope, setToggle, setTri, setRotary, setPull, setKey, setRope, bindKeySpring } from "./switches.ts";

export type BatterySel = "off" | "ind" | "bb" | "be" | "both";
export type BilgeMode = "off" | "auto" | "on";
export type KeyPos = "off" | "on" | "start";

export interface SystemsPanelActions {
  setBattery(sel: BatterySel): void;
  setFuelValve(open: boolean): void;
  setChoke(on: boolean): void;
  setBilge(mode: BilgeMode): void;
  toggleLights(): void;
  setKey(engine: number, pos: KeyPos): void;  // chave de ignição de um motor
  pullStart(): void;                          // bote: puxar a corda (= P)
  stopEngine(): void;                         // bote: botão STOP
  setLever(engine: number, cmd: LeverCmd): void; // manete do painel (vai para o InputManager)
  close(): void;
}

export interface SystemsPanelCaps {
  title: string;
  banks: 0 | 1 | 2;     // 0 = sem bateria (bote)
  keys: string[];       // rótulos das chaves de ignição (um por motor); vazio = partida na corda
  choke: boolean;
  bilgePump: boolean;
  lights: string;       // "LUZES" / "LANTERNA"
  levers: LeverKind;    // tipo de manete do barco
}

const plate = (inner: string, cls = "") => `<div class="sw-plate ${cls}"><span class="screw s1"></span><span class="screw s2"></span><span class="screw s3"></span><span class="screw s4"></span>${inner}</div>`;

export class SystemsPanel {
  readonly el: HTMLElement;
  private open = false;
  private readonly act: SystemsPanelActions;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private caps: SystemsPanelCaps = { title: "", banks: 1, keys: [], choke: false, bilgePump: true, lights: "LUZES", levers: "binnacle" };
  private levers: LeverControls | null = null;

  constructor(act: SystemsPanelActions) {
    this.act = act;
    const el = document.createElement("div");
    el.id = "spanel";
    el.innerHTML = `<div class="tp-head"><b>⠿ SISTEMAS</b><button class="tp-x" aria-label="fechar">×</button></div><div class="sp-body"></div>`;
    this.title = el.querySelector<HTMLElement>(".tp-head b")!;
    this.body = el.querySelector<HTMLElement>(".sp-body")!;
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      const d = b.dataset;
      if (b.classList.contains("tp-x")) this.act.close();
      else if (d.kpos) { if (d.kpos !== "start") this.act.setKey(Number(d.key), d.kpos as KeyPos); } // START: mola (bindKeySpring)
      else if (d.rope) this.act.pullStart();
      else if (d.stop) this.act.stopEngine();
      else if (d.bat) this.act.setBattery(d.bat as BatterySel);
      else if (d.fuel) this.act.setFuelValve(d.fuel === "open");
      else if (d.choke) this.act.setChoke(!b.classList.contains("on"));
      else if (d.bilge) this.act.setBilge(d.bilge as BilgeMode);
      else if (d.lights) this.act.toggleLights();
    });
    bindKeySpring(el, (i, pos) => this.act.setKey(i, pos));
    document.body.appendChild(el);
    this.el = el;
    makeDraggable(el, el.querySelector<HTMLElement>(".tp-head")!, "aquarush.spanelPos");
    this.setOpen(false);
  }

  /** Monta o painel de chaves do barco ativo. */
  configure(caps: SystemsPanelCaps): void {
    this.caps = caps;
    const cell = (ctl: string, info: string) => `<div class="sw-cell">${ctl}<div class="rd" data-info="${info}"></div></div>`;
    // partida: chave(s) de ignição ou a corda
    const start = caps.keys.length
      ? caps.keys.map((l, i) => cell(ignKey(i, l, "OFF · ON · START"), `key${i}`)).join("")
      : cell(rope("PARTIDA", "corda + STOP"), "rope");
    const cells: string[] = [];
    if (caps.banks === 2) cells.push(cell(rotary("bat", "BATERIAS", "chave geral · 2 bancos", [{ v: "off", l: "OFF" }, { v: "ind", l: "IND" }, { v: "bb", l: "BB" }, { v: "be", l: "BE" }, { v: "both", l: "AMBAS" }]), "bat"));
    else if (caps.banks === 1) cells.push(cell(rotary("bat", "BATERIA", "chave geral", [{ v: "off", l: "OFF" }, { v: "ind", l: "ON" }]), "bat"));
    cells.push(cell(rotary("fuel", "COMBUSTÍVEL", "registro do tanque", [{ v: "closed", l: "FECHADO" }, { v: "open", l: "ABERTO" }], { cls: "fuel" }), "fuel"));
    if (caps.choke) cells.push(cell(pull("choke", "1", "AFOGADOR", "partida a frio"), "choke"));
    if (caps.bilgePump) cells.push(cell(tri("bilge", "BOMBA PORÃO", "boia ou manual", { v: "on", l: "ON" }, { v: "off", l: "OFF" }, { v: "auto", l: "AUTO" }), "bilge"));
    cells.push(cell(toggle({ attr: "lights", val: "1", label: caps.lights, sub: caps.banks ? "navegação" : "a pilha" }), "lights"));
    this.title.textContent = `⠿ SISTEMAS — ${caps.title}`;
    this.body.innerHTML = `
      <div class="sp-top"><div><div class="sp-sec">PARTIDA</div>${plate(start, "sp-start")}</div>
        <div class="sp-grow"><div class="sp-sec">COMANDO</div>${plate("", "sp-lev")}</div></div>
      <div class="sp-sec">SISTEMAS</div>${plate(cells.join(""))}
      <p class="sp-note" data-note></p>`;
    this.levers = new LeverControls(caps.levers, (i, c) => this.act.setLever(i, c));
    this.body.querySelector<HTMLElement>(".sp-lev")!.appendChild(this.levers.el);
  }

  get isOpen(): boolean { return this.open; }
  setOpen(on: boolean): void { this.open = on; this.el.classList.toggle("open", on); }

  /** Posição das manetes: o comando atual por motor (do InputManager). */
  updateLevers(cmds: LeverCmd[]): void { if (this.open) this.levers?.update(cmds); }

  update(t: BoatTelemetry, lightsOn: boolean): void {
    if (!this.open) return;
    const el = this.el, c = this.caps;
    // tensão da casa (equivalente 12 V): os LEDs das chaves elétricas só acendem com ela
    const hv = (t.houseV * 12) / t.nominalV, powered = c.banks > 0 && hv > 9;
    setRotary(el, "bat", t.batterySel === "off" ? "off" : c.banks === 1 ? "ind" : t.batterySel);
    setRotary(el, "fuel", t.fuelValveOpen ? "open" : "closed");
    setPull(el, "choke", t.choke);
    setTri(el, "bilge", t.bilgeMode, powered && t.bilgeMode !== "off", t.bilgePump);
    setToggle(el, "lights", "1", lightsOn, lightsOn && (c.banks === 0 || powered));
    // chaves de ignição: a luz acende com a ignição energizada pelo banco daquele motor
    const sel = t.batterySel;
    c.keys.forEach((_, i) => {
      const bankV = sel === "off" ? (t.engines[i] === "running" ? 13.8 : 0) : sel === "bb" ? t.batteryVs[0] : sel === "be" ? t.batteryVs[1] ?? t.batteryV : t.batteryVs[i] ?? t.batteryV;
      const key = t.keys[i] ?? "off";
      setKey(el, i, key, key !== "off" && bankV > 9);
    });
    if (!c.keys.length) setRope(el, t.engine === "running" ? "running" : t.engine === "cranking" ? "cranking" : "off");
    const info = (k: string, s: string, warn = false) => {
      const e = el.querySelector<HTMLElement>(`[data-info="${k}"]`);
      if (!e) return;
      if (e.textContent !== s) e.textContent = s;
      e.classList.toggle("warn", warn);
    };
    c.keys.forEach((_, i) => {
      const eng = t.engines[i], rpm = t.rpms[i] ?? t.rpm;
      info(`key${i}`, eng === "running" ? `ligado · ${Math.round(rpm)} rpm` : eng === "cranking" ? `arranque · ${Math.round(rpm)} rpm` : t.keys[i] === "on" ? "ignição ligada" : "desligado", t.startFail !== "" && eng === "off" && t.keys[i] === "on");
    });
    if (!c.keys.length) info("rope", t.engine === "running" ? `${Math.round(t.rpm)} rpm` : t.startFail === "pull" ? "não pegou: puxe de novo" : "motor parado", t.startFail === "pull");
    if (c.banks === 2) info("bat", `BB ${t.batteryVs[0]?.toFixed(1)} V · BE ${t.batteryVs[1]?.toFixed(1)} V`, sel === "off");
    else if (c.banks === 1) info("bat", `${t.batteryV.toFixed(1)} V · ${Math.round(t.batterySoc * 100)} %`, sel === "off");
    info("fuel", t.fuelValveOpen ? `${t.fuelL.toFixed(1)} L no tanque` : `linha ${Math.round(t.fuelLineFrac * 100)} %`, !t.fuelValveOpen);
    if (c.choke) info("choke", `motor ${t.coolantC < 40 ? "frio" : "quente"} · ${t.coolantC.toFixed(0)} °C`, t.choke && t.coolantC > 45);
    if (c.bilgePump) info("bilge", `${t.bilgePump ? "bombeando" : powered ? "parada" : "sem energia"} · ${t.bilgeL.toFixed(0)} L`, t.bilgeMode === "off" && t.bilgeL > 20);
    info("lights", lightsOn ? (powered || c.banks === 0 ? "acesas" : "sem energia") : "apagadas");
    const note = el.querySelector<HTMLElement>("[data-note]")!;
    const n = !t.fuelValveOpen && t.engine === "running" ? "Registro FECHADO: o motor vai morrer quando acabar o combustível da linha."
      : c.choke && t.choke && t.coolantC > 45 && t.engine === "running" ? "Motor quente com o afogador puxado: mistura rica — empurre o afogador antes que ele afogue."
      : c.choke && !t.choke && t.coolantC < 40 && t.engine !== "running" ? "Motor frio: puxe o afogador para dar a partida (e empurre quando ele esquentar)."
      : sel === "off" && c.banks > 0 && t.engine === "running" ? "Chave geral em OFF com o motor ligado: o alternador segura a ignição, mas a bateria não carrega (e a queda de carga pode queimar o regulador)."
      : sel === "off" && c.banks > 0 ? "Chave de baterias em OFF: sem partida, sem bomba de porão, sem luzes (as chaves ficam onde estão, só os LEDs apagam)."
      : c.keys.length && t.keys.some((k) => k === "on") && t.engine !== "running" ? "Chave em ON: segure START até o motor pegar (só em N)." : "";
    if (note.textContent !== n) note.textContent = n;
  }
}
