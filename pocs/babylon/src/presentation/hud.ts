// HUD (DOM/SVG): relógios redondos com ponteiro + leitura digital dentro.
// Lê SOMENTE a telemetria real da simulação (BoatTelemetry).

import type { BoatTelemetry } from "../sim/boat.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SVG = "http://www.w3.org/2000/svg";

export interface GaugeOpts {
  title: string;
  min: number;
  max: number;
  labels: number[];          // valores com número
  minor?: number;            // passo das marcas menores
  redFrom?: number; redTo?: number;
  /** faixas coloridas do mostrador (como nos instrumentos de turbina): g = operação normal, y = cautela, r = limite */
  bands?: { from: number; to: number; c: "g" | "y" | "r" }[];
  labelFmt?: (v: number) => string;
  big?: boolean;
}

/** Relógio redondo (SVG): arco de 270°, ponteiro animado e 2 linhas digitais no centro. */
export class RoundGauge {
  readonly el: SVGSVGElement;
  private needle: SVGGElement;
  private l1: SVGTextElement;
  private l2: SVGTextElement;
  private shown: number;
  private readonly o: GaugeOpts;
  private readonly ang: (v: number) => number;

  constructor(parent: HTMLElement, o: GaugeOpts) {
    this.o = o;
    this.shown = o.min;
    const A0 = -135, A1 = 135;
    const el = document.createElementNS(SVG, "svg");
    el.setAttribute("viewBox", "0 0 100 100");
    el.classList.add("gauge", o.big ? "big" : "small");
    const mk = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parentEl: Element = el) => {
      const n = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      parentEl.appendChild(n);
      return n;
    };
    const ang = (v: number) => A0 + ((v - o.min) / (o.max - o.min)) * (A1 - A0);
    this.ang = ang;
    const pt = (a: number, r: number) => [50 + r * Math.sin((a * Math.PI) / 180), 50 - r * Math.cos((a * Math.PI) / 180)];
    mk("circle", { cx: 50, cy: 50, r: 48, class: "g-face" });
    mk("circle", { cx: 50, cy: 50, r: 48, class: "g-rim" });
    for (const b of o.bands ?? []) {
      const a0 = ang(b.from), a1 = ang(b.to);
      const [x0, y0] = pt(a0, 42), [x1, y1] = pt(a1, 42);
      mk("path", { d: `M ${x0} ${y0} A 42 42 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`, class: b.c === "g" ? "g-green" : b.c === "y" ? "g-yellow" : "g-red" });
    }
    if (o.redFrom !== undefined) {
      const a0 = ang(o.redFrom), a1 = ang(o.redTo ?? o.max);
      const [x0, y0] = pt(a0, 42), [x1, y1] = pt(a1, 42);
      mk("path", { d: `M ${x0} ${y0} A 42 42 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`, class: "g-red" });
    }
    const step = o.minor ?? (o.max - o.min) / 20;
    for (let v = o.min; v <= o.max + 1e-6; v += step) {
      const isMajor = o.labels.some((l) => Math.abs(l - v) < step * 0.01);
      const a = ang(v);
      const [x0, y0] = pt(a, isMajor ? 37 : 40), [x1, y1] = pt(a, 45);
      mk("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: isMajor ? "g-major" : "g-minor" });
    }
    for (const v of o.labels) {
      const [x, y] = pt(ang(v), o.big ? 29 : 30);
      const t = mk("text", { x, y: y + 3, class: "g-num" });
      t.textContent = o.labelFmt ? o.labelFmt(v) : String(v);
    }
    const title = mk("text", { x: 50, y: o.big ? 36 : 35, class: "g-title" });
    title.textContent = o.title;
    // leitura digital na faixa livre de baixo do mostrador (entre o fim e o começo da escala)
    this.l1 = mk("text", { x: 50, y: o.big ? 80 : 84, class: "g-l1" });
    this.l2 = mk("text", { x: 50, y: o.big ? 90 : 93, class: "g-l2" });
    this.needle = mk("g", {});
    mk("polygon", { points: "48.6,50 51.4,50 50,10", class: "g-needle" }, this.needle);
    mk("circle", { cx: 50, cy: 50, r: 4.5, class: "g-hub" });
    parent.appendChild(el);
    this.el = el;
  }

  set(value: number, line1: string, line2 = "", warn = false): void {
    const v = Math.min(Math.max(value, this.o.min), this.o.max + (this.o.max - this.o.min) * 0.02);
    this.shown += (v - this.shown) * 0.25; // amortecimento do ponteiro
    this.needle.setAttribute("transform", `rotate(${this.ang(this.shown).toFixed(2)} 50 50)`);
    if (this.l1.textContent !== line1) this.l1.textContent = line1;
    if (this.l2.textContent !== line2) this.l2.textContent = line2;
    this.el.classList.toggle("warn", warn);
  }
}

export interface HudOpts { speedMax: number; temp: boolean; battery: boolean; trimPins: number; gear?: "bar" | "dial"; /** dois motores: um conta-giros por motor (BB / BE) */ twin?: boolean; /** turbina: N1, EGT, torque, N2, óleo e luzes da partida */ turbine?: boolean; /** fundo de escala do conta-giros (padrão 7000; moto aquática 9000) e início do vermelho */ rpmMax?: number; rpmRed?: number; /** moto aquática: manômetro do compressor (BOOST) e luz do iBR */ jet?: boolean }

export class Hud {
  private speedG!: RoundGauge;
  private rpmG!: RoundGauge;
  private rpmG2: RoundGauge | null = null;
  /** turbina: EGT (grande), torque, N2 e pressão de óleo (pequenos) + luzes da sequência de partida */
  private egtG: RoundGauge | null = null;
  private tqG: RoundGauge | null = null;
  private n2G: RoundGauge | null = null;
  private oilG: RoundGauge | null = null;
  private oilTG: RoundGauge | null = null;
  private annun: HTMLElement | null = null;
  private fuelG!: RoundGauge;
  private tempG: RoundGauge | null = null;
  private voltG: RoundGauge | null = null;
  private ampG: RoundGauge | null = null;
  /** moto aquática: pressão do compressor e a luz do iBR (caçamba: NEUTRO / FREIO / RÉ) */
  private boostG: RoundGauge | null = null;
  private ibrLamp: HTMLElement | null = null;
  /** 2º motor (AR-9): temperatura e banco de bateria próprios */
  private tempG2: RoundGauge | null = null;
  /** escala do voltímetro (1 = 12 V, 2 = 24 V) */
  private vk = 1;
  private voltG2: RoundGauge | null = null;
  private bilgeChip = $("h-bilge");
  private anchorChip = $("h-anchor");
  private ancBox = $("g-anchor");
  private ancRope = $("h-anc-rope");
  private ancMin = $("h-anc-min");
  private ancIcon = $("h-anc-icon");
  private ancTxt = $("h-anc");
  private ancSt = $("h-anc-st");
  /** cabo total no paiol (m) — escala do indicador */
  anchorRodeMax = 50;
  private pins = 0;
  private gearStyle: "bar" | "dial" = "bar";
  private shownGear = "";
  private thrBar = $("h-thr-bar");
  private thrTxt = $("h-thr");
  private trimMark = $("h-trim-mark");
  private trimTxt = $("h-trim");
  private planing = $("h-planing");
  private engineChip = $("h-engine");
  private hotChip = $("h-hot");
  private lowFuelChip = $("h-lowfuel");
  private chargeChip = $("h-charge");
  private cav = $("h-cav");
  private vent = $("h-vent");
  private water = $("h-water");
  private occ = $("h-occ");
  private dmgHull = $("h-dmg-hull");
  private dmgEng = $("h-dmg-eng");
  private depthBox = $("g-depth");
  private depthWater = $("h-depth-water");
  private draftMark = $("h-draft-mark");
  private draftHull = $("h-draft-hull");
  private depthTxt = $("h-depth");
  private draftTxt = $("h-draft");
  private fuelAut = $("g-aut");
  private cam = $("h-cam");
  private lights = $("h-lights");
  private debug = $("h-debug");
  private help = $("h-help");
  private toast = $("h-toast");
  private toastTimer = 0;
  debugOn = false;

  /** opts: barco com/sem painel de instrumentos (bote de cana não tem temperatura nem bateria) */
  constructor(opts?: HudOpts) { this.configure(opts); }

  /** (Re)monta os relógios para o barco escolhido. */
  configure(opts: HudOpts = { speedMax: 100, temp: true, battery: true, trimPins: 0, gear: "bar" }): void {
    const big = $("g-big"), small = $("g-small");
    // marcha: lancha = barra da manete (F em cima, N, R embaixo); bote = alavanca de câmbio do motor (mostrador redondo)
    const gearBox = $("g-gear");
    if ((opts.gear ?? "bar") === "bar") {
      gearBox.innerHTML = `<div class="vbar"><div class="track gear"><span class="gl" data-g="F" style="bottom:85%">F</span><span class="gl" data-g="N" style="bottom:50%">N</span><span class="gl" data-g="R" style="bottom:15%">R</span><div id="h-gear-mark"></div></div><b id="h-gear">N</b>MARCHA</div>`;
    } else {
      // vista lateral da alavanca no motor (proa para a direita): F = para a frente, N = em pé, R = para trás
      gearBox.innerHTML = `<div class="vbar"><svg class="gear-dial" viewBox="0 0 64 64"><circle class="face" cx="32" cy="32" r="30"/>
        <text data-g="R" x="11" y="20">R</text><text data-g="N" x="32" y="9">N</text><text data-g="F" x="53" y="20">F</text>
        <g id="h-gear-lever"><line class="lever" x1="32" y1="44" x2="32" y2="18"/><circle class="knob" cx="32" cy="16" r="5"/></g>
        <circle class="knob" cx="32" cy="44" r="4"/></svg><b id="h-gear">N</b>MARCHA</div>`;
    }
    this.gearStyle = opts.gear ?? "bar";
    this.shownGear = "";
    big.innerHTML = ""; small.innerHTML = "";
    this.pins = opts.trimPins;
    const sm = opts.speedMax;
    this.speedG = new RoundGauge(big, { title: "km/h", min: 0, max: sm, labels: Array.from({ length: 6 }, (_, i) => (sm / 5) * i), minor: sm / 20, big: true });
    this.egtG = this.tqG = this.n2G = this.oilG = this.oilTG = null;
    this.annun?.remove(); this.annun = null;
    this.boostG = null; this.ibrLamp?.remove(); this.ibrLamp = null;
    if (opts.turbine) {
      // turbina: N1 (gerador de gás, %) e EGT (gases de escape, °C) grandes; vermelho no limite de partida/operação
      this.rpmG = new RoundGauge(big, { title: "N1 %", min: 0, max: 110, labels: [0, 20, 40, 60, 80, 100], minor: 5, big: true, bands: [{ from: 60, to: 101, c: "g" }, { from: 102, to: 110, c: "r" }] });
      this.egtG = new RoundGauge(big, { title: "EGT °C", min: 0, max: 900, labels: [0, 300, 600, 900], minor: 50, big: true, bands: [{ from: 300, to: 700, c: "g" }, { from: 700, to: 780, c: "y" }, { from: 780, to: 900, c: "r" }] });
      this.rpmG2 = null;
    } else if (opts.twin) {
      // V8 de centro: faixa até 6000 rpm, vermelho a partir de 5000 (um relógio por motor, bombordo e boreste)
      const rpmOpts = (t: string) => ({ title: t, min: 0, max: 6000, labels: [0, 1000, 2000, 3000, 4000, 5000, 6000], minor: 250, redFrom: 5000, big: true, labelFmt: (v: number) => String(v / 1000) });
      this.rpmG = new RoundGauge(big, rpmOpts("RPM BB"));
      this.rpmG2 = new RoundGauge(big, rpmOpts("RPM BE"));
    } else {
      const mx = opts.rpmMax ?? 7000;
      this.rpmG = new RoundGauge(big, { title: "RPM x1000", min: 0, max: mx, labels: Array.from({ length: mx / 1000 + 1 }, (_, i) => i * 1000), minor: 250, redFrom: opts.rpmRed ?? 6000, big: true, labelFmt: (v) => String(v / 1000) });
      this.rpmG2 = null;
    }
    if (opts.turbine) {
      this.tqG = new RoundGauge(small, { title: "TORQUE %", min: 0, max: 120, labels: [0, 60, 120], minor: 10, bands: [{ from: 0, to: 100, c: "g" }, { from: 100, to: 105, c: "y" }, { from: 105, to: 120, c: "r" }] });
      this.n2G = new RoundGauge(small, { title: "N2 %", min: 0, max: 120, labels: [0, 60, 120], minor: 10, bands: [{ from: 40, to: 103, c: "g" }, { from: 104, to: 120, c: "r" }] });
      this.oilG = new RoundGauge(small, { title: "ÓLEO psi", min: 0, max: 100, labels: [0, 50, 100], minor: 10, bands: [{ from: 0, to: 25, c: "r" }, { from: 25, to: 45, c: "y" }, { from: 45, to: 85, c: "g" }, { from: 90, to: 100, c: "r" }] });
      // temperatura do óleo: normal ~75–95 °C; alarme a 110 °C; acima de 120 °C os mancais se desgastam
      this.oilTG = new RoundGauge(small, { title: "ÓLEO °C", min: 0, max: 150, labels: [0, 75, 150], minor: 15, bands: [{ from: 60, to: 105, c: "g" }, { from: 105, to: 120, c: "y" }, { from: 120, to: 150, c: "r" }] });
      // luzes da sequência de partida (como no painel de uma turbina)
      const an = document.createElement("div");
      an.id = "g-annun";
      an.style.cssText = "display:flex;gap:4px;justify-content:center;margin-top:4px;font:600 9.5px/1 system-ui,sans-serif;letter-spacing:.04em";
      an.innerHTML = ["GPU", "ARRANQUE", "IGNIÇÃO", "GOV", "EGT"].map((k) => `<span data-k="${k}" style="padding:3px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.35);background:rgba(0,0,0,.25)">${k}</span>`).join("");
      small.parentElement?.insertBefore(an, this.fuelAut);
      this.annun = an;
    }
    if (opts.jet) {
      // compressor: verde até ~1 bar (pleno), vermelho acima (sobrepressão)
      this.boostG = new RoundGauge(small, { title: "BOOST bar", min: 0, max: 1.4, labels: [0, 0.7, 1.4], minor: 0.1, bands: [{ from: 0.05, to: 1.1, c: "g" }, { from: 1.1, to: 1.2, c: "y" }, { from: 1.2, to: 1.4, c: "r" }] });
      const l = document.createElement("div");
      l.id = "g-ibr";
      l.innerHTML = `<span class="ibr-dot"></span><b>iBR</b><em>FRENTE</em>`;
      small.parentElement?.insertBefore(l, this.fuelAut);
      this.ibrLamp = l;
    }
    this.fuelG = new RoundGauge(small, { title: "COMBUST.", min: 0, max: 1, labels: [0, 0.5, 1], minor: 0.125, redFrom: 0, redTo: 0.12, labelFmt: (v) => (v === 0 ? "E" : v === 1 ? "F" : "½") });
    // dois motores: um relógio de temperatura e um de bateria para cada (BB = bombordo, BE = boreste: bancos separados)
    const tw = !!opts.twin;
    const tempOpts = (t: string) => ({ title: t, min: 40, max: 120, labels: [40, 80, 120], minor: 10, redFrom: 90 });
    // voltímetro na escala do sistema (24 V na turbina: 16–32 V, vermelho abaixo de 23 V)
    const vk = opts.turbine ? 2 : 1;
    this.vk = vk;
    const voltOpts = (t: string): GaugeOpts => opts.turbine
      ? { title: t, min: 16, max: 32, labels: [16, 24, 32], minor: 2, bands: [{ from: 16, to: 22, c: "r" }, { from: 22, to: 24, c: "y" }, { from: 24, to: 29.5, c: "g" }, { from: 30, to: 32, c: "r" }] }
      : { title: t, min: 8 * vk, max: 16 * vk, labels: [8 * vk, 12 * vk, 16 * vk], minor: vk, redFrom: 8 * vk, redTo: 11.5 * vk };
    this.tempG = opts.temp && !opts.turbine ? new RoundGauge(small, tempOpts(tw ? "TEMP BB" : "TEMP")) : null; // turbina: temp. do óleo vai no relógio de óleo
    this.tempG2 = opts.temp && tw ? new RoundGauge(small, tempOpts("TEMP BE")) : null;
    this.voltG = opts.battery ? new RoundGauge(small, voltOpts(tw ? "BAT. BB" : opts.turbine ? "BARRAM. V" : "BATERIA")) : null;
    this.voltG2 = opts.battery && tw ? new RoundGauge(small, voltOpts("BAT. BE")) : null;
    // amperímetro: corrente na bateria (+ carga do alternador, − consumo: arranque, trim, molinete, bomba)
    this.ampG = opts.battery ? new RoundGauge(small, { title: tw ? "AMP. BB" : "AMPÈRES", min: -60, max: 30, labels: [-60, -30, 0, 30], minor: 10, redFrom: -60, redTo: -40 }) : null;
  }

  update(t: BoatTelemetry, fps: number, extra: Record<string, string>): void {
    this.speedG.set(t.speedKmh, `${Math.round(t.speedKmh)}`, `marcha ${t.gear}`);
    if (this.rpmG2 && t.rpms && t.rpms.length > 1) {
      const r0 = t.rpms[0], r1 = t.rpms[1], g = t.gears ?? [];
      this.rpmG.set(r0, `${Math.round(r0 / 10) * 10}`, `${g[0] ?? t.gear} · ${t.engineHours.toFixed(1).padStart(6, "0")} h`, t.revLimiter);
      this.rpmG2.set(r1, `${Math.round(r1 / 10) * 10}`, `${g[1] ?? t.gear}`, t.revLimiter);
    } else if (this.egtG && t.turbine) {
      const tb = t.turbine;
      const phase: Record<string, string> = { off: "parada", starter: "ARRANQUE", lightoff: "IGNIÇÃO", accel: "acelerando", running: `${t.engineHours.toFixed(1).padStart(6, "0")} h`, spooldown: "desacelerando" };
      // instrumentos elétricos: sem tensão no barramento ficam apagados (ponteiro no zero, sem leitura)
      const on = tb.powered;
      const set = (g: RoundGauge | null, v: number, a: string, b: string, w: boolean) => { if (!g) return; g.el.classList.toggle("off", !on); g.set(on ? v : 0, on ? a : "—", on ? b : "sem energia", on && w); };
      set(this.rpmG, tb.n1, tb.n1.toFixed(1), phase[tb.phase] ?? "", tb.n1 > 102);
      set(this.egtG, tb.egt, `${tb.egt.toFixed(0)}`, tb.egtWarn ? "LIMITE" : tb.lit ? "chama" : "", tb.egtWarn || (tb.phase === "accel" && tb.egt > 720));
      set(this.tqG, tb.torque, `${tb.torque.toFixed(0)}`, "", tb.torque > 105);
      set(this.n2G, tb.n2, `${tb.n2.toFixed(0)}`, `${Math.round(t.propRpm)} rpm`, tb.n2 > 104);
      set(this.oilG, tb.oilPsi, `${tb.oilPsi.toFixed(0)}`, "", tb.phase === "running" && tb.oilPsi < 25);
      set(this.oilTG, tb.oilC, `${tb.oilC.toFixed(0)}`, tb.oilRed ? "DANO" : tb.oilHot ? "QUENTE" : "", tb.oilHot);
      if (this.annun) {
        // GPU: pisca (âmbar) enquanto o diesel dela parte e estabiliza; verde e acesa com a energia externa chaveada
        const blink = Math.floor(performance.now() / 350) % 2 === 0;
        const on: Record<string, [boolean, string]> = { GPU: [t.extPwr || (t.gpu && (t.gpuState === "starting" || !t.extPwrClosed) && blink), t.extPwr ? "#3ddc84" : "#ffb020"], ARRANQUE: [tb.starter, "#ffb020"], "IGNIÇÃO": [tb.ignition, "#ffb020"], GOV: [!tb.governor && !tb.fadec ? true : tb.govActing && blink, !tb.governor && !tb.fadec ? "#ffb020" : "#3ddc84"], EGT: [tb.egtWarn || (tb.phase === "accel" && tb.egt > 720), "#ff4040"] };
        for (const el of Array.from(this.annun.children) as HTMLElement[]) {
          const [lit, c] = on[el.dataset.k ?? ""] ?? [false, ""];
          el.style.color = lit ? "#111" : "rgba(255,255,255,.35)"; el.style.background = lit ? c : "rgba(0,0,0,.25)"; el.style.borderColor = lit ? c : "rgba(255,255,255,.18)";
        }
      }
    } else this.rpmG.set(t.rpm, `${Math.round(t.rpm / 10) * 10}`, `${t.engineHours.toFixed(1).padStart(6, "0")} h`, t.revLimiter);
    const autonomy = t.fuelLph > 0.1 ? t.fuelL / t.fuelLph : 0;
    const autTxt = t.engine === "running" && autonomy > 0 ? ` · ${Math.floor(autonomy)}h${String(Math.floor((autonomy % 1) * 60)).padStart(2, "0")}` : "";
    this.fuelG.set(t.fuelFrac, `${t.fuelL.toFixed(1)} L`, `${t.fuelLph.toFixed(1)} L/h`, t.fuelL <= 0.05); // mostrador vermelho só sem combustível
    this.fuelAut.textContent = autTxt ? `autonomia${autTxt.replace(" ·", "")}` : "";
    if (this.tempG2 || this.voltG2) {
      // dois motores: cada relógio lê o seu motor/banco (o alarme acende só no que está quente/descarregado)
      const tempTag = (c: number) => (c >= 90 ? "PROTEÇÃO" : c >= 85 ? "QUENTE" : "");
      const voltTag = (i: number) => (i === 0 && t.jumper ? "jump" : t.engines?.[i] === "running" && t.batteryVs[i] > 13.2 ? "carga" : `${Math.round(t.batterySocs[i] * 100)}%`);
      [this.tempG, this.tempG2].forEach((g, i) => { const c = t.coolants[i] ?? t.coolantC; g?.set(c, `${c.toFixed(0)}°C`, tempTag(c), c >= 85); });
      [this.voltG, this.voltG2].forEach((g, i) => { const v = t.batteryVs[i] ?? t.batteryV; g?.set(v, `${v.toFixed(1)} V`, voltTag(i), v < 12.2); });
    } else {
      this.tempG?.set(t.coolantC, `${t.coolantC.toFixed(0)}°C`, t.protectMode ? "PROTEÇÃO" : t.overheatWarn ? "QUENTE" : "", t.overheatWarn);
      this.voltG?.set(t.batteryV, `${t.batteryV.toFixed(1)} V`, t.gpu ? "GPU" : t.jumper ? "jump" : t.engine === "running" && t.batteryV > 13.2 * this.vk ? "carga" : `${Math.round(t.batterySoc * 100)}%`, t.chargeWarn);
    }
    const amps = t.batteryA;
    this.ampG?.set(Math.max(-60, Math.min(30, amps)), `${amps > 0.5 ? "+" : ""}${amps.toFixed(0)} A`, amps > 0.5 ? "carga" : amps < -0.5 ? "consumo" : "", amps < -40);
    this.boostG?.set(Math.max(0, t.boostBar), `${t.boostBar.toFixed(2)}`, `${(t.boostBar * 14.5).toFixed(0)} psi`, t.boostBar > 1.2);
    if (this.ibrLamp) {
      const st = t.ibr, txt = st === "brake" ? "FREIO" : st === "reverse" ? "RÉ" : st === "neutral" ? "NEUTRO" : "FRENTE";
      if (this.ibrLamp.dataset.s !== st) { this.ibrLamp.dataset.s = st; this.ibrLamp.querySelector("em")!.textContent = txt; }
    }
    // porão: bomba jogando água fora / água alta (alerta luminoso piscando)
    const bilgeShow = t.bilgeAlarm || t.swamped || t.sunk;
    this.bilgeChip.classList.toggle("warn", bilgeShow);
    if (bilgeShow) {
      const fb = t.freeboard < 5 ? ` · borda ${Math.max(0, t.freeboard * 100).toFixed(0)} cm` : "";
      this.bilgeChip.textContent = t.sunk ? `AFUNDOU · ${t.bilgeL.toFixed(0)} L dentro`
        : t.capsized ? `VIRADO · ar preso ${t.airPocketL.toFixed(0)} L${t.airPocketL < 1000 ? " — afundando" : ""}`
        : t.swamped ? `ALAGADO — INAVEGÁVEL · ${t.bilgeL.toFixed(0)} L${fb}`
        : t.bilgePump ? `BOMBA DE PORÃO · ${t.bilgeL.toFixed(0)} L · ${t.bilgeFlowLps.toFixed(2)} L/s${fb}` : `ÁGUA NO PORÃO · ${t.bilgeL.toFixed(0)} L${fb}`;
    }
    // âncora: cabo lançado, profundidade, filame e estado
    const anc = t.anchorOut > 0.05 || t.anchorRelay;
    this.anchorChip.classList.toggle("show", anc);
    this.anchorChip.classList.toggle("warn", t.anchorState === "garrando" || t.anchorRelay);
    if (anc) this.anchorChip.textContent = t.anchorRelay ? "ÂNCORA · molinete sem força (bateria)"
      : `ÂNCORA ${t.anchorOut.toFixed(1)} m · fundo ${t.anchorDepth.toFixed(1)} m${t.anchorScope > 0 && t.anchorState !== "descendo" && t.anchorState !== "subindo" ? ` · ${t.anchorScope.toFixed(1)}:1` : ""} · ${t.anchorState.toUpperCase()}`;
    // indicador da âncora: corda descendo pela barra (cabo lançado ÷ cabo total) e a âncora na ponta
    {
      const f = Math.min(1, t.anchorOut / this.anchorRodeMax);
      this.ancRope.style.height = `${f * 100}%`;
      this.ancIcon.style.top = `${f * 100}%`;
      const rec = t.anchorDepth * 5;
      this.ancMin.style.display = t.anchorOut > 0.05 && t.anchorDepth > 0.1 ? "block" : "none";
      this.ancMin.style.top = `${Math.min(100, (rec / this.anchorRodeMax) * 100)}%`;
      this.ancTxt.textContent = `${t.anchorOut.toFixed(1)} m`;
      this.ancSt.textContent = t.anchorRelay ? "sem força" : t.anchorOut > 0.05 && t.anchorScope > 0 && (t.anchorState === "segurando" || t.anchorState === "no fundo" || t.anchorState === "garrando") ? `${t.anchorState} ${t.anchorScope.toFixed(1)}:1` : t.anchorState;
      this.ancBox.className = "vbar " + (t.anchorState === "garrando" || t.anchorRelay ? "drag" : t.anchorState === "segurando" ? "hold" : t.anchorState === "no fundo" ? "down" : "");
    }
    // barras de acelerador e trim (como antes)
    this.thrBar.style.height = `${t.throttle * 100}%`;
    this.thrBar.classList.toggle("rev", t.gear === "R");
    this.thrTxt.textContent = `${Math.round(t.throttle * 100)}%`;
    // indicador de marcha (lê a marcha REAL da simulação: passa por N durante a troca)
    if (t.gear !== this.shownGear) {
      this.shownGear = t.gear;
      const box = $("g-gear");
      $("h-gear").textContent = t.gear;
      for (const el of box.querySelectorAll<SVGElement | HTMLElement>("[data-g]")) el.classList.toggle("on", el.dataset.g === t.gear);
      if (this.gearStyle === "bar") {
        const m = $("h-gear-mark");
        m.style.bottom = t.gear === "F" ? "85%" : t.gear === "R" ? "15%" : "50%";
        m.className = t.gear === "R" ? "r" : t.gear === "N" ? "n" : "";
      } else {
        const lev = box.querySelector<SVGGElement>("#h-gear-lever")!;
        lev.style.transformOrigin = "32px 44px"; // gira em torno do pivô da alavanca (animação por CSS)
        lev.style.transform = `rotate(${t.gear === "F" ? 40 : t.gear === "R" ? -40 : 0}deg)`;
      }
    }
    this.trimMark.style.bottom = t.tiltDeg > 0.5 ? "100%" : `${((t.trim + 1) / 2) * 100}%`;
    this.trimMark.style.background = t.tiltDeg > 0.5 ? "#ff9d3d" : "";
    this.trimTxt.textContent = t.trimPin > this.pins ? `TILT ${t.tiltDeg.toFixed(0)}°` : t.tiltDeg > 0.5 ? `TILT ${t.tiltDeg.toFixed(0)}°`
      : this.pins > 0 ? `PINO ${t.trimPin}/${this.pins}` : `${t.trimDeg >= 0 ? "+" : ""}${t.trimDeg.toFixed(1)}°`;

    this.planing.classList.toggle("on", t.planing);
    this.engineChip.textContent = t.engine === "running" ? "MOTOR LIGADO" : t.engine === "cranking" ? "DANDO PARTIDA…" : "MOTOR DESLIGADO";
    this.engineChip.className = "chip " + (t.engine === "running" ? "on" : t.engine === "cranking" ? "crank" : "off");
    this.cav.classList.toggle("warn", t.cavitation > 0.25);
    this.vent.classList.toggle("warn", t.ventilation < 0.75 && t.throttle > 0.15 && t.propImmersion > 0.2);
    this.hotChip.classList.toggle("warn", t.overheatWarn);
    // reserva: aviso laranja ACESO (fixo); só pisca quando acaba
    const empty = t.fuelL <= 0.05;
    this.lowFuelChip.classList.toggle("warn", t.lowFuel || empty);
    this.lowFuelChip.classList.toggle("steady", t.lowFuel && !empty);
    if (t.lowFuel || empty) { const txt = empty ? "SEM COMBUSTÍVEL" : `RESERVA · ${t.fuelL.toFixed(1)} L`; if (this.lowFuelChip.textContent !== txt) this.lowFuelChip.textContent = txt; }
    this.chargeChip.classList.toggle("warn", t.chargeWarn && t.engine === "running");
    // profundímetro: escala de 0 a 5 m de cima para baixo; água até o fundo; marcas do calado (casco amarelo, motor vermelho)
    const D = 5, y = (m: number) => `${Math.min(100, (m / D) * 100)}%`;
    const depth = Math.max(0, t.depth);
    this.depthWater.style.height = y(depth);
    this.draftHull.style.top = y(t.draftHull);
    this.draftMark.style.top = y(t.draftMotor);
    this.depthTxt.textContent = depth > 9.95 ? `${depth.toFixed(0)} m` : `${depth.toFixed(1)} m`;
    this.draftTxt.textContent = `calado ${t.draftHull.toFixed(2)} · pé ${t.draftMotor.toFixed(2)}`;
    this.depthBox.classList.toggle("warn", depth < t.draftMotor + 0.25 && depth > 0.01);
    // avarias: aviso laranja fixo; acima de 80 % pisca rápido (crítico)
    this.dmgHull.classList.toggle("warn", t.hullDamage > 0.005);
    this.dmgEng.classList.toggle("warn", t.engineDamage > 0.005);
    this.dmgHull.classList.toggle("steady", t.hullDamage <= 0.8);
    this.dmgEng.classList.toggle("steady", t.engineDamage <= 0.8);
    this.dmgHull.classList.toggle("crit", t.hullDamage > 0.8);
    this.dmgEng.classList.toggle("crit", t.engineDamage > 0.8);
    if (t.hullDamage > 0.005) this.dmgHull.textContent = `AVARIA CASCO ${Math.round(t.hullDamage * 100)}%`;
    if (t.engineDamage > 0.005) this.dmgEng.textContent = t.engineDamage >= 0.95 ? "MOTOR QUEBRADO" : `AVARIA MOTOR ${Math.round(t.engineDamage * 100)}%`;

    if (this.debugOn) {
      const rows: [string, string][] = [
        ["FPS", fps.toFixed(0)],
        ["vel. água (m/s)", t.waterSpeed.toFixed(2)],
        ["empuxo (N)", t.thrustN.toFixed(0)],
        ["pitch / roll (°)", `${t.pitchDeg.toFixed(1)} / ${t.rollDeg.toFixed(1)}`],
        ["imersão média", t.wetFraction.toFixed(2)],
        ["pontos submersos", t.submergedPoints.map((s) => (s ? "●" : "○")).join(" ")],
        ["direção (°)", t.steerDeg.toFixed(1)],
        ["ventilação hélice", t.ventilation.toFixed(2)],
        ["cavitação", t.cavitation.toFixed(2)],
        ["imersão da hélice", t.propImmersion.toFixed(2)],
        ["limitador de giro", t.revLimiter ? "CORTANDO" : "-"],
        ["escorregamento hélice", t.propSlip.toFixed(2)],
        ["rotação hélice (rpm)", t.propRpm.toFixed(0)],
        ["consumo (L/h)", t.fuelLph.toFixed(1)],
        ["bomba do trim (A)", t.trimMotorA.toFixed(0)],
        ["bateria (V)", t.batteryV.toFixed(2)],
        ["carga da bateria", `${(t.batterySoc * 100).toFixed(1)} %`],
        ["porão (L · entra L/s)", `${t.bilgeL.toFixed(1)} · ${t.bilgeInflowLps.toFixed(2)}`],
        ["borda livre (cm)", (t.freeboard * 100).toFixed(0)],
        ["bolsa de ar (virado, L)", t.airPocketL.toFixed(0)],
        ["âncora (m · N)", `${t.anchorOut.toFixed(1)} · ${t.anchorTension.toFixed(0)}`],
        ["jump start", `${t.jumper ? "conectado · " : ""}${(t.jumpCharge * 100).toFixed(0)} %`],
        ["GPU (doca)", t.gpu ? "conectada" : "—"],
        ["arranque (rpm)", t.starterRpm.toFixed(0)],
        ["distância (m)", t.distanceM.toFixed(0)],
        ["profundidade (m)", t.depth.toFixed(1)],
        ["colisões", String(t.collisions)],
        ...Object.entries(extra),
      ];
      this.debug.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
    }
  }

  setCamera(name: string): void { this.cam.textContent = name === "cockpit" ? "COCKPIT" : "EXTERNA"; }
  /** Barco afundado: só o essencial na tela (sem chips de alerta nem avisos que já não importam). */
  private quiet = false;
  setQuiet(on: boolean): void { this.quiet = on; document.body.classList.toggle("sunk-quiet", on); }
  setWater(name: string): void { this.water.textContent = "ÁGUA: " + name.toUpperCase(); }
  private windChip = $("h-wind");
  private windName = "nenhum";
  setWind(name: string): void { this.windName = name; this.windChip.classList.toggle("on", name !== "nenhum"); this.windChip.textContent = "VENTO: " + name.toUpperCase(); }
  /** vento atual: nós e seta de onde ele vem, relativa à proa (↑ = vento de proa) */
  updateWind(knots: number, relFromRad: number): void {
    if (this.windName === "nenhum") return;
    this.windChip.innerHTML = `VENTO: ${this.windName.toUpperCase()} ${knots.toFixed(0)} nós <span style="display:inline-block;transform:rotate(${(relFromRad * 180) / Math.PI + 180}deg)">↑</span>`;
  }
  setOccupants(txt: string): void { this.occ.textContent = "OCUPANTES: " + txt.toUpperCase(); }
  setLights(on: boolean, label = "LUZES"): void { this.lights.classList.toggle("on", on); this.lights.textContent = label; }
  toggleDebug(): void { this.debugOn = !this.debugOn; this.debug.style.display = this.debugOn ? "block" : "none"; }
  toggleHelp(force?: boolean): void { this.help.classList.toggle("hidden", force === undefined ? undefined : !force); }

  showToast(msg: string, force = false): void {
    if (this.quiet && !force) return; // afundado: sem avisos que já não importam
    this.toast.textContent = msg;
    this.toast.classList.add("on");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("on"), 1800);
  }
}
