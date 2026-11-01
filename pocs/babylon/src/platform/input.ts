// Platform/Services: adaptadores de entrada -> VehicleInput (contrato único).
// Teclado e gamepad no desktop; joystick/acelerador/botões virtuais no touch.
// Também expõe "ações" pontuais (câmera, luzes, reset, ondas, debug).

import { type VehicleInput, emptyInput } from "../gameplay/vehicleInput.ts";
import { approach, clamp } from "../sim/math.ts";

export type Action = "camera" | "lights" | "reset" | "debug" | "help" | "waves0" | "waves1" | "waves2" | "pause";

export class InputManager {
  readonly state: VehicleInput = emptyInput();
  private keys = new Set<string>();
  private actions: Action[] = [];
  private kbThrottle = 0;
  private kbBrake = 0;
  private kbSteer = 0;
  // touch
  touchSteer = 0;
  touchThrottle = 0;   // alavanca: permanece onde o dedo soltou
  touchBrake = 0;
  touchTrim = 0;
  private lights = false;
  lastDevice: "teclado" | "gamepad" | "touch" = "teclado";
  private gpPrev: boolean[] = [];

  constructor(target: Window) {
    target.addEventListener("keydown", (e) => {
      if (e.repeat) { this.keys.add(e.code); return; }
      this.keys.add(e.code);
      this.lastDevice = "teclado";
      const map: Record<string, Action> = {
        KeyC: "camera", KeyL: "lights", KeyR: "reset", F3: "debug", KeyH: "help", Digit1: "waves0", Digit2: "waves1", Digit3: "waves2", KeyP: "pause",
      };
      const a = map[e.code];
      if (a) { this.actions.push(a); e.preventDefault(); }
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    });
    target.addEventListener("keyup", (e) => this.keys.delete(e.code));
    target.addEventListener("blur", () => this.keys.clear());
  }

  pushAction(a: Action): void { this.actions.push(a); }
  consumeActions(): Action[] { const a = this.actions; this.actions = []; return a; }

  private k(...codes: string[]): boolean { return codes.some((c) => this.keys.has(c)); }

  update(dt: number): VehicleInput {
    // ---- teclado: acelerador progressivo (rampa) ----
    const up = this.k("KeyW", "ArrowUp"), down = this.k("KeyS", "ArrowDown");
    this.kbThrottle = approach(this.kbThrottle, up ? 1 : 0, (up ? 0.9 : 1.6) * dt);
    this.kbBrake = approach(this.kbBrake, down ? 1 : 0, (down ? 1.5 : 3) * dt);
    const steerT = (this.k("KeyD", "ArrowRight") ? 1 : 0) - (this.k("KeyA", "ArrowLeft") ? 1 : 0);
    this.kbSteer = approach(this.kbSteer, steerT, (steerT === 0 ? 4 : 2.8) * dt);
    const kbTrim = (this.k("KeyE") ? 1 : 0) - (this.k("KeyQ") ? 1 : 0);

    // ---- gamepad (mapeamento "standard") ----
    let gpThrottle = 0, gpBrake = 0, gpSteer = 0, gpTrim = 0;
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || gp.mapping !== "standard") continue;
      const b = (i: number) => gp.buttons[i]?.value ?? 0;
      const pressed = (i: number) => gp.buttons[i]?.pressed ?? false;
      gpThrottle = Math.max(gpThrottle, b(7));
      gpBrake = Math.max(gpBrake, b(6));
      const ax = gp.axes[0] ?? 0;
      gpSteer = Math.abs(ax) > 0.12 ? (ax - Math.sign(ax) * 0.12) / 0.88 : 0;
      gpTrim = (pressed(5) ? 1 : 0) - (pressed(4) ? 1 : 0);
      const edges: [number, Action][] = [[3, "camera"], [2, "lights"], [8, "reset"], [9, "pause"]];
      for (const [i, a] of edges) {
        const now = pressed(i);
        if (now && !this.gpPrev[i]) this.actions.push(a);
        this.gpPrev[i] = now;
      }
      if (gpThrottle + gpBrake + Math.abs(gpSteer) > 0.05) this.lastDevice = "gamepad";
      break;
    }

    const s = this.state;
    s.throttle = clamp(Math.max(this.kbThrottle, gpThrottle, this.touchThrottle), 0, 1);
    s.brake = clamp(Math.max(this.kbBrake, gpBrake, this.touchBrake), 0, 1);
    s.steering = clamp(this.kbSteer + gpSteer + this.touchSteer, -1, 1);
    s.trim = clamp(kbTrim + gpTrim + this.touchTrim, -1, 1);
    s.reverse = false;
    s.navigationLights = this.lights;
    return s;
  }

  toggleLights(): boolean { this.lights = !this.lights; return this.lights; }
}

/** Controles touch: joystick de direção (esquerda), alavanca de acelerador (direita), botões. */
export const attachTouchControls = (root: HTMLElement, input: InputManager): void => {
  const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  if (!isTouch && !location.search.includes("touch=1")) return;
  root.classList.add("touch-on");

  const stick = root.querySelector<HTMLElement>("#t-stick")!;
  const knob = root.querySelector<HTMLElement>("#t-knob")!;
  let stickId: number | null = null;
  const stickMove = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    const dx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
    input.touchSteer = Math.abs(dx) < 0.08 ? 0 : dx;
    knob.style.transform = `translateX(${dx * r.width * 0.35}px)`;
  };
  stick.addEventListener("pointerdown", (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); input.lastDevice = "touch"; });
  stick.addEventListener("pointermove", (e) => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = (e: PointerEvent) => { if (e.pointerId !== stickId) return; stickId = null; input.touchSteer = 0; knob.style.transform = ""; };
  stick.addEventListener("pointerup", stickEnd);
  stick.addEventListener("pointercancel", stickEnd);

  // alavanca: metade superior = frente (0..1), faixa inferior = ré/freio
  const lever = root.querySelector<HTMLElement>("#t-lever")!;
  const handle = root.querySelector<HTMLElement>("#t-handle")!;
  const NEUTRAL = 0.78; // posição (0 topo .. 1 base) do neutro
  let leverId: number | null = null;
  const setLever = (pos: number) => {
    pos = clamp(pos, 0, 1);
    if (pos <= NEUTRAL) { input.touchThrottle = clamp((NEUTRAL - pos) / (NEUTRAL - 0.04), 0, 1); input.touchBrake = 0; }
    else { input.touchThrottle = 0; input.touchBrake = clamp((pos - NEUTRAL) / (1 - NEUTRAL - 0.03), 0, 1); }
    if (Math.abs(pos - NEUTRAL) < 0.03) { input.touchThrottle = 0; input.touchBrake = 0; }
    handle.style.top = `${pos * 100}%`;
  };
  setLever(NEUTRAL);
  const leverMove = (e: PointerEvent) => {
    const r = lever.getBoundingClientRect();
    setLever((e.clientY - r.top) / r.height);
  };
  lever.addEventListener("pointerdown", (e) => { leverId = e.pointerId; lever.setPointerCapture(e.pointerId); leverMove(e); input.lastDevice = "touch"; });
  lever.addEventListener("pointermove", (e) => { if (e.pointerId === leverId) leverMove(e); });
  lever.addEventListener("pointerup", (e) => { if (e.pointerId === leverId) leverId = null; });
  lever.addEventListener("dblclick", () => setLever(NEUTRAL));

  const hold = (id: string, on: () => void, off: () => void) => {
    const el = root.querySelector<HTMLElement>(id)!;
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); on(); el.classList.add("on"); });
    const end = () => { off(); el.classList.remove("on"); };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };
  hold("#t-trim-up", () => (input.touchTrim = 1), () => (input.touchTrim = 0));
  hold("#t-trim-down", () => (input.touchTrim = -1), () => (input.touchTrim = 0));
  const tap = (id: string, a: Action) => root.querySelector<HTMLElement>(id)!.addEventListener("click", () => input.pushAction(a));
  tap("#t-cam", "camera");
  tap("#t-lights", "lights");
  tap("#t-reset", "reset");
  root.querySelector<HTMLElement>("#t-neutral")!.addEventListener("click", () => setLever(NEUTRAL));
};
