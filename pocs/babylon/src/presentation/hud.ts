// HUD (DOM): lê SOMENTE a telemetria real da simulação (BoatTelemetry).

import type { BoatTelemetry } from "../sim/boat.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private speed = $("h-speed");
  private rpmBar = $("h-rpm-bar");
  private rpmTxt = $("h-rpm");
  private thrBar = $("h-thr-bar");
  private thrTxt = $("h-thr");
  private trimMark = $("h-trim-mark");
  private trimTxt = $("h-trim");
  private gear = $("h-gear");
  private planing = $("h-planing");
  private cav = $("h-cav");
  private vent = $("h-vent");
  private water = $("h-water");
  private cam = $("h-cam");
  private lights = $("h-lights");
  private debug = $("h-debug");
  private help = $("h-help");
  private toast = $("h-toast");
  private toastTimer = 0;
  debugOn = false;

  update(t: BoatTelemetry, fps: number, extra: Record<string, string>): void {
    this.speed.textContent = Math.round(t.speedKmh).toString();
    const rpmF = Math.min(t.rpm / 6000, 1);
    this.rpmBar.style.width = `${rpmF * 100}%`;
    this.rpmBar.classList.toggle("red", t.rpm > 5600);
    this.rpmTxt.textContent = `${Math.round(t.rpm / 10) * 10}`;
    this.thrBar.style.height = `${t.throttle * 100}%`;
    this.thrBar.classList.toggle("rev", t.gear === "R");
    this.thrTxt.textContent = `${Math.round(t.throttle * 100)}%`;
    this.trimMark.style.bottom = `${((t.trim + 1) / 2) * 100}%`;
    this.trimTxt.textContent = `${t.trimDeg >= 0 ? "+" : ""}${t.trimDeg.toFixed(1)}°`;
    this.gear.textContent = t.gear;
    this.gear.className = "gear g-" + t.gear;
    this.planing.classList.toggle("on", t.planing);
    this.cav.classList.toggle("warn", t.cavitation > 0.25);
    this.vent.classList.toggle("warn", t.ventilation < 0.75 && t.throttle > 0.15);
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
        ["escorregamento hélice", t.propSlip.toFixed(2)],
        ["rotação hélice (rpm)", t.propRpm.toFixed(0)],
        ["consumo (L/h)", t.fuelLph.toFixed(1)],
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
  setLights(on: boolean): void { this.lights.classList.toggle("on", on); }
  toggleDebug(): void { this.debugOn = !this.debugOn; this.debug.style.display = this.debugOn ? "block" : "none"; }
  toggleHelp(force?: boolean): void { this.help.classList.toggle("hidden", force === undefined ? undefined : !force); }

  showToast(msg: string): void {
    this.toast.textContent = msg;
    this.toast.classList.add("on");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("on"), 1600);
  }
}
