// Painel de SISTEMAS do barco (tecla Y nas embarcações a pistão; na AR-10 o Y abre o painel de partida da
// turbina, que tem a mesma linha de sistemas). Lê só a telemetria (regra do HUD) e manda comandos por callbacks.
//  • PARTIDA: uma chave de ignição por motor (OFF · ON com autoteste · START com mola) ou, no bote, o manete da
//    corda e o botão STOP;
//  • chave de baterias (rotativa): OFF / ON (um banco) ou OFF / IND / BB / BE / AMBAS (AR-9, dois bancos);
//  • registro do tanque de combustível (rotativo): FECHADO / ABERTO;
//  • afogador (bote carburado): EMPURRADO / PUXADO;
//  • bomba de porão: ON / OFF / AUTO; luzes de navegação;
//  • motor de avião (airboat): chave dos MAGNETOS (OFF · R · L · BOTH · START com mola), PRIMER manual (cada clique =
//    uma bombada) e a alavanca de MISTURA (RICA ↔ CORTE) ao lado do pedal;
//  • moto aquática: botões START (segurar) e STOP redondos, clipe do CORDÃO de segurança e o MODO (ECO / SPORT) — sem
//    chave de bateria, sem registro de combustível, sem bomba (o sifão do jato esvazia o porão).
// As chaves elétricas ficam na posição escolhida mesmo sem bateria — só o LED delas depende da tensão.

import type { BoatTelemetry } from "../sim/boat.ts";
import { makeDraggable } from "./dragPanel.ts";
import { LeverControls, type LeverCmd, type LeverKind, type TrimOpts, type TrimState } from "./levers.ts";
import { toggle, tri, rotary, pull, ignKey, rope, lantern, setToggle, setTri, setRotary, setPull, setKey, setRope, setRd, bindKeySpring } from "./switches.ts";

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
  setTrim(dir: number): void;                     // botão de trim segurado (+1 sobe, −1 desce, 0 solta)
  horn(on: boolean): void;                        // buzina (apito no bote e na moto aquática) segurada
  setLanyard(on: boolean): void;                  // moto aquática: prender/soltar o cordão de segurança
  setEco(on: boolean): void;                      // moto aquática: modo ECO
  setMagnetos(pos: "off" | "r" | "l" | "both" | "start" | "release"): void; // motor de avião: chave dos magnetos
  prime(): void;                                  // motor de avião: uma bombada do primer
  setMixture(v: number): void;                    // motor de avião: alavanca de mistura (1 = rica, 0 = corte)
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
  display: "lcd" | "vfd" | "grey" | "glass"; // estilo dos displays de informação (LCD verde, VFD âmbar, LCD cinza, vidro)
  trim: TrimOpts | null; // controle de trim do barco (power trim ou pino)
  /** partida por botões START/STOP + cordão de segurança (moto aquática), no lugar da chave de ignição */
  startStop?: boolean;
  /** tem chave geral de bateria / registro de combustível (padrão: sim) */
  batterySwitch?: boolean;
  fuelValve?: boolean;
  /** modos de condução ECO / SPORT */
  ecoMode?: boolean;
  /** buzina elétrica ou apito de bolinha (bote, moto aquática). Ausente = buzina com bateria, apito sem */
  horn?: "buzina" | "apito";
  /** fileira de luzes de aviso (anunciadores, como na AR-10) — motor a pistão */
  annunciators?: boolean;
  /** motor de avião: magnetos + primer na partida e a alavanca de mistura no comando (no lugar da chave de ignição) */
  aircraft?: boolean;
}

const plate = (inner: string, cls = "") => `<div class="sw-plate ${cls}"><span class="screw s1"></span><span class="screw s2"></span><span class="screw s3"></span><span class="screw s4"></span>${inner}</div>`;

export class SystemsPanel {
  readonly el: HTMLElement;
  private open = false;
  private readonly act: SystemsPanelActions;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private caps: SystemsPanelCaps = { title: "", banks: 1, keys: [], choke: false, bilgePump: true, lights: "LUZES", levers: "binnacle", display: "lcd", trim: null };
  private flashMsg = "";
  private flashT = -1e9;
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
      else if (d.ss === "stop") this.act.setKey(0, "off");
      else if (d.lan) this.act.setLanyard(!b.classList.contains("on"));
      else if (d.eco) this.act.setEco(!b.classList.contains("on"));
      else if (d.mag && d.mag !== "start") this.act.setMagnetos(d.mag as "off" | "r" | "l" | "both");
      else if (d.prime) { this.act.prime(); b.classList.remove("push"); void b.offsetWidth; b.classList.add("push"); }
    });
    bindKeySpring(el, (i, pos) => this.act.setKey(i, pos));
    // START da moto aquática: segurar = arranque (acorda a central e gira); soltar em qualquer lugar = solta
    let ssHeld = false;
    el.addEventListener("pointerdown", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-ss='start']");
      if (!b) return;
      ssHeld = true; b.classList.add("down"); this.act.setKey(0, "start"); e.preventDefault();
    });
    const ssUp = () => { if (!ssHeld) return; ssHeld = false; el.querySelector("button[data-ss='start']")?.classList.remove("down"); this.act.setKey(0, "on"); };
    addEventListener("pointerup", ssUp); addEventListener("pointercancel", ssUp); addEventListener("blur", ssUp);
    // magnetos: START tem mola — segurar dá a partida; soltar volta para BOTH
    let magHeld = false;
    el.addEventListener("pointerdown", (e) => {
      if (!(e.target as HTMLElement).closest("button[data-mag='start']")) return;
      magHeld = true; this.act.setMagnetos("start"); e.preventDefault();
    });
    const magUp = () => { if (!magHeld) return; magHeld = false; this.act.setMagnetos("release"); };
    addEventListener("pointerup", magUp); addEventListener("pointercancel", magUp); addEventListener("blur", magUp);
    document.body.appendChild(el);
    this.el = el;
    makeDraggable(el, el.querySelector<HTMLElement>(".tp-head")!, "aquarush.spanelPos");
    this.setOpen(false);
  }

  /** Monta o painel de chaves do barco ativo. */
  configure(caps: SystemsPanelCaps): void {
    this.caps = caps;
    const cell = (ctl: string, info: string) => `<div class="sw-cell">${ctl}<div class="rd" data-info="${info}"></div></div>`;
    this.el.dataset.disp = caps.display;
    // partida: chave(s) de ignição ou a corda
    const start = caps.aircraft
      ? cell(rotary("mag", "MAGNETOS", "OFF · R · L · BOTH · START", [{ v: "off", l: "OFF" }, { v: "r", l: "R" }, { v: "l", l: "L" }, { v: "both", l: "BOTH" }, { v: "start", l: "START" }], { cls: "mag" }), "mag")
        + cell(`<div class="pr-w"><button class="pr" data-prime="1" title="primer manual: cada clique é uma bombada (frio: 2–4; demais afoga)"><span class="pr-body"></span><span class="pr-knob"></span></button><b>PRIMER</b><small>bomba manual</small></div>`, "prime")
      : caps.startStop
      ? cell(`<div class="ss"><div class="rb-w"><button class="rb rb-start" data-ss="start" title="segure: acorda a central e dá a partida (em N, com o cordão preso)"><span>START</span></button></div>
          <div class="rb-w"><button class="rb rb-stop" data-ss="stop" title="desliga o motor"><span>STOP</span></button></div>
          <div class="ly-w"><button class="ly" data-lan="1" title="cordão de segurança: preso no botão de parada e no pulso do piloto"><span class="ly-coil"></span><span class="ly-clip"></span></button><b>CORDÃO</b><small>de segurança</small></div>
          ${caps.ecoMode ? toggle({ attr: "eco", val: "1", label: "MODO", sub: "ECO / SPORT", on: "ECO", off: "SPORT" }) : ""}</div>`, "ss")
      : caps.keys.length
      ? caps.keys.map((l, i) => cell(ignKey(i, l, "OFF · ON · START"), `key${i}`)).join("")
      : cell(rope("PARTIDA", "corda + STOP"), "rope");
    const cells: string[] = [];
    if (caps.batterySwitch === false) { /* (sem chave geral: a bateria fica sempre ligada) */ }
    else if (caps.banks === 2) cells.push(cell(rotary("bat", "BATERIAS", "chave geral · 2 bancos", [{ v: "off", l: "OFF" }, { v: "ind", l: "IND" }, { v: "bb", l: "BB" }, { v: "be", l: "BE" }, { v: "both", l: "AMBAS" }]), "bat"));
    else if (caps.banks === 1) cells.push(cell(rotary("bat", "BATERIA", "chave geral", [{ v: "off", l: "OFF" }, { v: "ind", l: "ON" }]), "bat"));
    if (caps.fuelValve !== false) cells.push(cell(rotary("fuel", "COMBUSTÍVEL", "registro do tanque", [{ v: "closed", l: "FECHADO" }, { v: "open", l: "ABERTO" }], { cls: "fuel" }), "fuel"));
    if (caps.ecoMode && !caps.startStop) cells.push(cell(toggle({ attr: "eco", val: "1", label: "MODO", sub: "ECO limita o gatilho", on: "ECO", off: "SPORT" }), "eco"));
    if (caps.choke) cells.push(cell(pull("choke", "1", "AFOGADOR", "partida a frio"), "choke"));
    if (caps.bilgePump) cells.push(cell(tri("bilge", "BOMBA PORÃO", "boia ou manual", { v: "on", l: "ON" }, { v: "off", l: "OFF" }, { v: "auto", l: "AUTO" }), "bilge"));
    // bote: lanterna de mão a pilha (manual) — não é chave de painel
    if (caps.lights) cells.push(cell(caps.banks ? toggle({ attr: "lights", val: "1", label: caps.lights, sub: "navegação" }) : lantern("lights", caps.lights, "de mão, a pilha"), "lights"));
    this.title.textContent = `⠿ SISTEMAS — ${caps.title}`;
    // anunciadores (como no painel da AR-10): apagado = normal ("cockpit escuro"); TESTE acende todos + alarme
    const ann = caps.annunciators
      ? `<div class="sp-ann-row"><div class="tp-ann sp-ann">${SystemsPanel.ANN.map((k) => `<span data-a="${k}">${k}</span>`).join("")}</div></div>`
      : "";
    this.body.innerHTML = ann + `
      <div class="sp-top"><div><div class="sp-sec">PARTIDA</div>${plate(start, "sp-start")}</div>
        <div class="sp-grow"><div class="sp-sec">COMANDO</div>${plate("", "sp-lev")}</div></div>
      ${cells.length ? `<div class="sp-sec">SISTEMAS</div>${plate(cells.join(""))}` : ""}
      <div class="msg-rd" data-note><span></span></div>`;
    this.levers = new LeverControls(caps.levers, (i, c) => this.act.setLever(i, c));
    this.body.querySelector<HTMLElement>(".sp-lev")!.appendChild(this.levers.el);
    this.levers.setTrim(caps.trim, (d) => this.act.setTrim(d));
    if (caps.aircraft) {
      // alavanca de MISTURA (punho vermelho): em cima RICA, embaixo CORTE (é assim que se desliga um motor de avião)
      const mx = document.createElement("div");
      mx.className = "pl pl-mix";
      mx.title = "mistura: RICA para a partida e a potência máxima; empobrecer economiza; em CORTE o motor apaga";
      mx.innerHTML = `<div class="pl-track" data-mix><span class="pl-slot"></span><i class="pl-l max">RICA</i><i class="pl-l idle">CORTE</i><span class="pl-handle"><span class="pl-t"></span></span></div><em class="mt-rd">RICA</em><b>MISTURA</b>`;
      const track = mx.querySelector<HTMLElement>(".pl-track")!;
      let drag = false;
      const at = (e: PointerEvent) => { const r = track.getBoundingClientRect(); this.act.setMixture(Math.max(0, Math.min(1, 1 - (e.clientY - r.top - 12) / (r.height - 24)))); };
      track.addEventListener("pointerdown", (e) => { drag = true; try { track.setPointerCapture(e.pointerId); } catch { /* */ } e.preventDefault(); at(e); });
      track.addEventListener("pointermove", (e) => { if (drag && e.buttons !== 0) at(e); });
      const up = () => { drag = false; };
      track.addEventListener("pointerup", up); track.addEventListener("pointercancel", up);
      this.levers.el.insertBefore(mx, this.levers.el.querySelector(".hb-w"));
    }
    this.levers.setHorn(caps.horn ?? (caps.banks === 0 ? "apito" : "buzina"), (on) => this.act.horn(on));
  }

  /** luzes de aviso do motor a pistão (ordem do painel) */
  static readonly ANN = ["IGNIÇÃO", "PARTIDA", "ALTERNADOR", "ÓLEO", "TEMP CAB.", "COMB. BAIXO"];
  /** (sem botão TESTE no painel de sistemas — mantido para o main, sempre falso) */
  lampTestOn = false;

  get isOpen(): boolean { return this.open; }
  setOpen(on: boolean): void { this.open = on; this.el.classList.toggle("open", on); }

  /** Posição das manetes: o comando atual por motor (do InputManager). */
  updateLevers(cmds: LeverCmd[], trim: TrimState | null = null): void { if (this.open) { this.levers?.update(cmds); this.levers?.updateTrim(trim); } }
  /** Aviso de sistemas/motor no display do pé do painel (fica ~6 s; depois volta o aviso de estado). */
  flash(msg: string): void { this.flashMsg = msg; this.flashT = performance.now(); }

  update(t: BoatTelemetry, lightsOn: boolean): void {
    if (!this.open) return;
    const el = this.el, c = this.caps;
    // tensão da casa (equivalente 12 V): os LEDs das chaves elétricas só acendem com ela
    const hv = (t.houseV * 12) / t.nominalV, powered = c.banks > 0 && hv > 9;
    if (c.annunciators) {
      // IGNIÇÃO = chave ligada · PARTIDA = arranque girando · ALTERNADOR = sem carga (chave ligada e motor parado, ou falha)
      // ÓLEO = pressão baixa (motor parado com a chave ligada) · TEMP CAB. = cabeçote quente (pisca na proteção)
      // COMB. BAIXO = reserva (vermelha sem combustível). Tudo só com energia na casa.
      const keyOn = (t.keys[0] ?? "off") !== "off" || t.engine !== "off";
      const blink = Math.floor(performance.now() / 350) % 2 === 0;
      // as lâmpadas seguem acesas (mais fracas) até ~6 V: no arranque a tensão cai, mas o painel não apaga
      const lit = c.banks > 0 && hv > 6;
      const on = lit && keyOn;
      const L: Record<string, string> = {
        "IGNIÇÃO": on ? "a" : "",
        PARTIDA: lit && t.engine === "cranking" ? "a" : "",
        ALTERNADOR: on && (t.engine !== "running" || t.chargeWarn) ? "a" : "",
        "ÓLEO": on && t.engine !== "running" ? "r" : "",
        "TEMP CAB.": lit && (t.protectMode ? blink : t.overheatWarn) ? "r" : "",
        "COMB. BAIXO": lit && t.lowFuel ? (t.fuelL <= 0.05 ? "r" : "a") : "",
      };
      for (const s of this.el.querySelectorAll<HTMLElement>(".sp-ann [data-a]")) { const v = L[s.dataset.a ?? ""] ?? ""; if (s.className !== v) s.className = v; }
    }
    setRotary(el, "bat", t.batterySel === "off" ? "off" : c.banks === 1 ? "ind" : t.batterySel);
    setRotary(el, "fuel", t.fuelValveOpen ? "open" : "closed");
    setPull(el, "choke", t.choke);
    setTri(el, "bilge", t.bilgeMode, powered && t.bilgeMode !== "off", t.bilgePump);
    setToggle(el, "lights", "1", lightsOn, lightsOn && (c.banks === 0 || powered));
    for (const l of el.querySelectorAll<HTMLElement>(".lan")) l.classList.toggle("on", lightsOn);
    // chaves de ignição: a luz acende com a ignição energizada pelo banco daquele motor
    const sel = t.batterySel;
    c.keys.forEach((_, i) => {
      const bankV = sel === "off" ? (t.engines[i] === "running" ? 13.8 : 0) : sel === "bb" ? t.batteryVs[0] : sel === "be" ? t.batteryVs[1] ?? t.batteryV : t.batteryVs[i] ?? t.batteryV;
      const key = t.keys[i] ?? "off";
      setKey(el, i, key, key !== "off" && bankV > 9);
    });
    if (!c.keys.length && !c.startStop && !c.aircraft) setRope(el, t.engine === "running" ? "running" : t.engine === "cranking" ? "cranking" : "off");
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
    if (c.startStop) {
      this.levers?.setIbb(t.ibb);
      const awake = (t.keys[0] ?? "off") !== "off" || t.engine !== "off";
      const sb = el.querySelector<HTMLElement>("button[data-ss='start']");
      sb?.classList.toggle("lit", t.engine === "running" && hv > 9); sb?.classList.toggle("busy", t.engine === "cranking");
      el.querySelector<HTMLElement>("button[data-lan]")?.classList.toggle("on", t.lanyard);
      setToggle(el, "eco", "1", t.driveMode === "eco", t.driveMode === "eco" && awake && hv > 9);
      info("ss", (t.driveMode === "eco" ? "ECO · " : "") + (t.engine === "running" ? `ligada · ${Math.round(t.rpm)} rpm · ${t.boostBar.toFixed(2)} bar` : t.engine === "cranking" ? `arranque · ${Math.round(t.rpm)} rpm`
        : !t.lanyard ? "cordão SOLTO: não liga" : awake ? "central acordada" : "desligada"), !t.lanyard || (t.startFail !== "" && t.engine === "off" && awake));

    }
    if (c.aircraft) {
      setRotary(el, "mag", t.engine === "cranking" ? "start" : t.magnetos);
      info("mag", t.engine === "running" ? `ligado · ${Math.round(t.rpm)} rpm${t.magnetos === "r" || t.magnetos === "l" ? ` · só ${t.magnetos.toUpperCase()}` : ""}` : t.engine === "cranking" ? `arranque · ${Math.round(t.rpm)} rpm` : t.magnetos === "off" ? "magnetos desligados" : "magnetos ligados");
      const pr = Math.round(t.prime);
      info("prime", t.engine === "running" ? "—" : pr > 6 || (t.coolantC >= 40 && pr > 3) ? `AFOGADO · ${pr} bombadas` : `${pr} bombada${pr === 1 ? "" : "s"} · motor ${t.coolantC < 40 ? "frio" : "quente"}`, pr > 6 || (t.coolantC >= 40 && pr > 3));
      const mx = el.querySelector<HTMLElement>(".pl-mix");
      if (mx) {
        const b = `calc(${t.mixture * 100}% - ${t.mixture * 24}px)`;
        const h = mx.querySelector<HTMLElement>(".pl-handle")!; if (h.style.bottom !== b) h.style.bottom = b;
        const rd = mx.querySelector<HTMLElement>(".mt-rd")!;
        const s = t.mixture < 0.15 ? "CORTE" : t.mixture > 0.95 ? "RICA" : `${Math.round(t.mixture * 100)} %`;
        if (rd.textContent !== s) rd.textContent = s;
        rd.classList.toggle("warn", t.mixture < 0.5);
      }
    }
    if (!c.keys.length && !c.startStop && !c.aircraft) info("rope", t.engine === "running" ? `${Math.round(t.rpm)} rpm` : t.startFail === "pull" ? "não pegou: puxe de novo" : "motor parado", t.startFail === "pull");
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
      : c.startStop && !t.lanyard ? "Cordão de segurança SOLTO: prenda o clipe no botão de parada para dar partida (ele fica no pulso do piloto)."
      : c.startStop && (t.keys[0] ?? "off") === "on" && t.engine === "off" ? "Central acordada: segure START até o motor pegar (em N); ela dorme 30 s depois de parada."
      : c.keys.length && t.keys.some((k) => k === "on") && t.engine !== "running" ? "Chave em ON: segure START até o motor pegar (só em N)." : "";
    // display de avisos: caixa fixa no pé do painel, o texto rola; um aviso novo de sistemas/motor fica ~6 s
    const flashing = performance.now() - this.flashT < 6000;
    setRd(note, flashing ? this.flashMsg : n, !flashing && n !== "");
  }
}
