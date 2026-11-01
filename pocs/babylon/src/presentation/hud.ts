// HUD (DOM/SVG): relógios redondos com ponteiro + leitura digital dentro.
// Lê SOMENTE a telemetria real da simulação (BoatTelemetry).

import type { BoatTelemetry } from "../sim/boat.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SVG = "http://www.w3.org/2000/svg";

interface GaugeOpts {
  title: string;
  min: number;
  max: number;
  labels: number[];          // valores com número
  minor?: number;            // passo das marcas menores
  redFrom?: number; redTo?: number;
  labelFmt?: (v: number) => string;
  big?: boolean;
}

/** Relógio redondo (SVG): arco de 270°, ponteiro animado e 2 linhas digitais no centro. */
class RoundGauge {
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

export class Hud {
  private speedG: RoundGauge;
  private rpmG: RoundGauge;
  private fuelG: RoundGauge;
  private tempG: RoundGauge;
  private voltG: RoundGauge;
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
  private fuelAut = $("g-aut");
  private cam = $("h-cam");
  private lights = $("h-lights");
  private debug = $("h-debug");
  private help = $("h-help");
  private toast = $("h-toast");
  private toastTimer = 0;
  debugOn = false;

  constructor() {
    const big = $("g-big"), small = $("g-small");
    this.speedG = new RoundGauge(big, { title: "km/h", min: 0, max: 100, labels: [0, 20, 40, 60, 80, 100], minor: 5, big: true });
    this.rpmG = new RoundGauge(big, { title: "RPM x1000", min: 0, max: 7000, labels: [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000], minor: 250, redFrom: 6000, big: true, labelFmt: (v) => String(v / 1000) });
    this.fuelG = new RoundGauge(small, { title: "COMBUST.", min: 0, max: 1, labels: [0, 0.5, 1], minor: 0.125, redFrom: 0, redTo: 0.12, labelFmt: (v) => (v === 0 ? "E" : v === 1 ? "F" : "½") });
    this.tempG = new RoundGauge(small, { title: "TEMP", min: 40, max: 120, labels: [40, 80, 120], minor: 10, redFrom: 90 });
    this.voltG = new RoundGauge(small, { title: "BATERIA", min: 8, max: 16, labels: [8, 12, 16], minor: 1, redFrom: 8, redTo: 11.5 });
  }

  update(t: BoatTelemetry, fps: number, extra: Record<string, string>): void {
    this.speedG.set(t.speedKmh, `${Math.round(t.speedKmh)}`, `marcha ${t.gear}`);
    this.rpmG.set(t.rpm, `${Math.round(t.rpm / 10) * 10}`, `${t.engineHours.toFixed(1).padStart(6, "0")} h`, t.revLimiter);
    const autonomy = t.fuelLph > 0.1 ? t.fuelL / t.fuelLph : 0;
    const autTxt = t.engine === "running" && autonomy > 0 ? ` · ${Math.floor(autonomy)}h${String(Math.floor((autonomy % 1) * 60)).padStart(2, "0")}` : "";
    this.fuelG.set(t.fuelFrac, `${t.fuelL.toFixed(1)} L`, `${t.fuelLph.toFixed(1)} L/h`, t.lowFuel);
    this.fuelAut.textContent = autTxt ? `autonomia${autTxt.replace(" ·", "")}` : "";
    this.tempG.set(t.coolantC, `${t.coolantC.toFixed(0)}°C`, t.protectMode ? "PROTEÇÃO" : t.overheatWarn ? "QUENTE" : "", t.overheatWarn);
    this.voltG.set(t.batteryV, `${t.batteryV.toFixed(1)} V`, t.engine === "running" && t.batteryV > 13.2 ? "carga" : `${Math.round(t.batterySoc * 100)}%`, t.chargeWarn);
    // barras de acelerador e trim (como antes)
    this.thrBar.style.height = `${t.throttle * 100}%`;
    this.thrBar.classList.toggle("rev", t.gear === "R");
    this.thrTxt.textContent = `${Math.round(t.throttle * 100)}%`;
    this.trimMark.style.bottom = t.tiltDeg > 0.5 ? "100%" : `${((t.trim + 1) / 2) * 100}%`;
    this.trimMark.style.background = t.tiltDeg > 0.5 ? "#ff9d3d" : "";
    this.trimTxt.textContent = t.tiltDeg > 0.5 ? `TILT ${t.tiltDeg.toFixed(0)}°` : `${t.trimDeg >= 0 ? "+" : ""}${t.trimDeg.toFixed(1)}°`;

    this.planing.classList.toggle("on", t.planing);
    this.engineChip.textContent = t.engine === "running" ? "MOTOR LIGADO" : t.engine === "cranking" ? "DANDO PARTIDA…" : "MOTOR DESLIGADO";
    this.engineChip.className = "chip " + (t.engine === "running" ? "on" : t.engine === "cranking" ? "crank" : "off");
    this.cav.classList.toggle("warn", t.cavitation > 0.25);
    this.vent.classList.toggle("warn", t.ventilation < 0.75 && t.throttle > 0.15 && t.propImmersion > 0.2);
    this.hotChip.classList.toggle("warn", t.overheatWarn);
    this.lowFuelChip.classList.toggle("warn", t.lowFuel);
    if (t.lowFuel) this.lowFuelChip.textContent = `COMBUSTÍVEL BAIXO · ${t.fuelL.toFixed(1)} L`;
    this.chargeChip.classList.toggle("warn", t.chargeWarn && t.engine === "running");

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
  setWater(name: string): void { this.water.textContent = "ÁGUA: " + name.toUpperCase(); }
  setOccupants(txt: string): void { this.occ.textContent = "OCUPANTES: " + txt.toUpperCase(); }
  setLights(on: boolean): void { this.lights.classList.toggle("on", on); }
  toggleDebug(): void { this.debugOn = !this.debugOn; this.debug.style.display = this.debugOn ? "block" : "none"; }
  toggleHelp(force?: boolean): void { this.help.classList.toggle("hidden", force === undefined ? undefined : !force); }

  showToast(msg: string): void {
    this.toast.textContent = msg;
    this.toast.classList.add("on");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("on"), 1800);
  }
}
