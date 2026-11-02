// Platform/Services: adaptadores de entrada -> VehicleInput (contrato único).
// Teclado e gamepad no desktop; joystick/acelerador/botões virtuais no touch.
// Também expõe "ações" pontuais (câmera, luzes, reset, ondas, debug).

import { type VehicleInput, type GearCommand, emptyInput } from "../gameplay/vehicleInput.ts";
import { approach, clamp } from "../sim/math.ts";

export type Action = "camera" | "lights" | "reset" | "wind" | "unhitch" | "fuel" | "moor" | "car" | "horn" | "couple" | "debug" | "help" | "pause" | "ignition" | "occupants" | "jump" | "abandon" | "turbinePanel" | "water0" | "water1" | "water2" | "water3" | "waterNext";

/**
 * Manete única (como numa lancha real), com detentes  R ← N → F:
 *  - toque "para frente" (W/↑, RT, D-pad ↑): R → N → F (lenta engrenada). Segurar em F acelera.
 *  - toque "para trás"  (S/↓, LT, D-pad ↓): F → N → R (lenta engrenada). Segurar em R acelera em ré.
 *  - soltar: o acelerador volta à lenta, mas a marcha continua engatada (a lancha segue devagar).
 * Um toque que TROCOU de marcha só acelera se continuar segurado por mais de HOLD_TO_THROTTLE.
 */
const HOLD_TO_THROTTLE = 0.45; // s
const GEAR_STEP: Record<GearCommand, { up: GearCommand; down: GearCommand }> = {
  R: { up: "N", down: "R" },
  N: { up: "F", down: "R" },
  F: { up: "F", down: "N" },
};

export class InputManager {
  readonly state: VehicleInput = emptyInput();
  private keys = new Set<string>();
  private actions: Action[] = [];
  /** marcha atual da manete */
  gear: GearCommand = "N";
  private leverThrottle = 0; // acelerador acima da lenta, na marcha atual
  private kbSteer = 0;
  private prevUp = false;
  private prevDown = false;
  private holdTime = 0;
  private pressShifted = false;
  // touch
  touchSteer = 0;
  touchTrim = 0;
  touchAnchor = 0;
  /** alavanca touch (quando ativa, define marcha e acelerador diretamente) */
  touchLever: { gear: GearCommand; throttle: number; neutral?: boolean } | null = null;
  /** manetes do painel do Y com dois motores (AR-9): uma por motor; null = segue a manete principal */
  panelLevers: ({ gear: GearCommand; throttle: number; neutral?: boolean } | null)[] = [];
  /**
   * Manete do painel do Y: com um motor vira a alavanca principal (como a touch); com dois, cada uma comanda o seu
   * motor (`engineCmd`). Teclado/gamepad retomam o comando no próximo toque.
   */
  setPanelLever(i: number, cmd: { gear: GearCommand; throttle: number; neutral?: boolean }, engines: number): void {
    if (engines < 2) { this.touchLever = { ...cmd }; return; }
    const cur = this.touchLever ?? { gear: this.gear, throttle: this.state.throttle };
    while (this.panelLevers.length < engines) this.panelLevers.push(null);
    for (let k = 0; k < engines; k++) if (!this.panelLevers[k]) this.panelLevers[k] = { ...cur };
    this.panelLevers[i] = { ...cmd };
    this.lastDevice = "touch";
  }
  private lights = false;
  lastDevice: "teclado" | "gamepad" | "touch" = "teclado";
  private gpPrev: boolean[] = [];
  /** chamado quando a marcha da manete muda (HUD/toast) */
  onGearChange: ((g: GearCommand) => void) | null = null;

  constructor(target: Window) {
    target.addEventListener("keydown", (e) => {
      if (e.repeat) { this.keys.add(e.code); return; }
      this.keys.add(e.code);
      this.lastDevice = "teclado";
      const map: Record<string, Action> = {
        KeyC: "camera", KeyL: "lights", KeyR: "reset", KeyT: "wind", KeyU: "unhitch", KeyF: "fuel", KeyM: "moor", KeyK: "car", KeyB: "horn", KeyI: "couple", F3: "debug", KeyH: "help", KeyP: "ignition", KeyY: "turbinePanel", Escape: "pause", KeyO: "occupants", KeyJ: "jump", Space: "abandon",
        Digit0: "water0", Digit1: "water1", Digit2: "water2", Digit3: "water3", KeyG: "water0", KeyV: "waterNext",
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

  /** Força uma marcha (reset, botão N, alavanca touch). */
  setGear(g: GearCommand): void {
    if (g !== this.gear) { this.gear = g; this.onGearChange?.(g); }
    this.leverThrottle = 0;
  }

  private k(...codes: string[]): boolean { return codes.some((c) => this.keys.has(c)); }

  update(dt: number): VehicleInput {
    // ---- gamepad (mapeamento "standard") ----
    let gpUp = 0, gpDown = 0, gpSteer = 0, gpTrim = 0;
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || gp.mapping !== "standard") continue;
      const b = (i: number) => gp.buttons[i]?.value ?? 0;
      const pressed = (i: number) => gp.buttons[i]?.pressed ?? false;
      gpUp = Math.max(b(7), pressed(12) ? 1 : 0);
      gpDown = Math.max(b(6), pressed(13) ? 1 : 0);
      const ax = gp.axes[0] ?? 0;
      gpSteer = Math.abs(ax) > 0.12 ? (ax - Math.sign(ax) * 0.12) / 0.88 : 0;
      gpTrim = (pressed(5) ? 1 : 0) - (pressed(4) ? 1 : 0);
      const edges: [number, Action][] = [[3, "camera"], [2, "lights"], [8, "reset"], [9, "pause"], [1, "ignition"]];
      for (const [i, a] of edges) {
        const now = pressed(i);
        if (now && !this.gpPrev[i]) this.actions.push(a);
        this.gpPrev[i] = now;
      }
      if (gpUp + gpDown + Math.abs(gpSteer) > 0.05) this.lastDevice = "gamepad";
      break;
    }

    // ---- manete: toques trocam a marcha, segurar acelera ----
    const upAmt = Math.max(this.k("KeyW", "ArrowUp") ? 1 : 0, gpUp);
    const downAmt = Math.max(this.k("KeyS", "ArrowDown") ? 1 : 0, gpDown);
    const up = upAmt > 0.3, down = downAmt > 0.3;
    // N segurado = botão de aceleração em neutro da manete: a manete fica em N e "para frente" só sobe o giro
    const nHeld = this.k("KeyN");
    if (nHeld && this.gear !== "N") { this.touchLever = null; this.panelLevers = []; this.setGear("N"); }
    if (!nHeld && up && !this.prevUp) this.press("up");
    if (!nHeld && down && !this.prevDown) this.press("down");
    if (!up && !down) { this.holdTime = 0; this.pressShifted = false; } else this.holdTime += dt;
    this.prevUp = up; this.prevDown = down;

    const holding = (this.gear === "F" && up) || (this.gear === "R" && down) || (nHeld && up);
    const amt = this.gear === "R" ? downAmt : upAmt;
    const canRamp = holding && (!this.pressShifted || this.holdTime > HOLD_TO_THROTTLE);
    this.leverThrottle = approach(this.leverThrottle, canRamp ? amt : 0, (canRamp ? 0.9 : 1.6) * dt);

    // ---- direção e trim ----
    const steerT = (this.k("KeyD", "ArrowRight") ? 1 : 0) - (this.k("KeyA", "ArrowLeft") ? 1 : 0);
    this.kbSteer = approach(this.kbSteer, steerT, (steerT === 0 ? 4 : 2.8) * dt);
    const kbTrim = (this.k("KeyE") ? 1 : 0) - (this.k("KeyQ") ? 1 : 0);

    const s = this.state;
    if (this.touchLever) {
      if (this.touchLever.gear !== this.gear) { this.gear = this.touchLever.gear; this.onGearChange?.(this.gear); }
      s.throttle = this.touchLever.throttle;
    } else {
      s.throttle = clamp(this.leverThrottle, 0, 1);
    }
    s.gear = this.gear;
    s.brake = 0;
    s.reverse = this.gear === "R";
    s.steering = clamp(this.kbSteer + gpSteer + this.touchSteer, -1, 1);
    s.trim = clamp(kbTrim + gpTrim + this.touchTrim, -1, 1);
    s.navigationLights = this.lights;
    // acelerar em neutro: N + W no teclado, ou a manete do painel em N com o botão de neutro / punho da cana
    s.neutralThrottle = (nHeld && this.gear === "N") || (!!this.touchLever?.neutral && this.gear === "N");
    // âncora de proa: "+" paga cabo, "−" recolhe (segurar) — teclado principal ou numérico, ou botões touch
    s.anchor = clamp((this.k("Equal", "NumpadAdd") ? 1 : 0) - (this.k("Minus", "NumpadSubtract") ? 1 : 0) + this.touchAnchor, -1, 1);
    // dois motores (AR-9): Z/X segurado = empuxo diferencial, um motor em ré e o outro à frente (motor 0 = bombordo).
    // Z gira a proa para bombordo (BB em ré, BE à frente); X para boreste. Soltar: os dois voltam à manete.
    const spin = (this.k("KeyX") ? 1 : 0) - (this.k("KeyZ") ? 1 : 0);
    s.engineCmd = spin === 0 ? undefined : spin < 0
      ? [{ gear: "R", throttle: 0.45 }, { gear: "F", throttle: 0.18 }]
      : [{ gear: "F", throttle: 0.18 }, { gear: "R", throttle: 0.45 }];
    // manetes independentes do painel (dois motores): cada uma no seu motor; a "principal" segue a de bombordo
    if (spin === 0 && this.panelLevers.length) {
      s.engineCmd = this.panelLevers.map((c) => c ?? { gear: s.gear, throttle: s.throttle });
      s.gear = s.engineCmd[0].gear; s.throttle = s.engineCmd[0].throttle; s.reverse = s.gear === "R";
      if (this.panelLevers.some((c) => c?.neutral)) s.neutralThrottle = true;
    }
    return s;
  }

  private press(dir: "up" | "down"): void {
    this.touchLever = null; this.panelLevers = []; // teclado/gamepad assumem a manete
    const next = GEAR_STEP[this.gear][dir];
    this.pressShifted = next !== this.gear;
    this.holdTime = 0;
    if (this.pressShifted) this.setGear(next);
  }

  /**
   * Comando simples do veículo de reboque (frente, freio/ré, direita, esquerda) — sem manete com marchas.
   * Teclado W/↑ frente, S/↓ freio e, parado, ré; A/D direção. Gamepad: RT/LT + analógico.
   * Touch: alavanca acima do N = frente, abaixo = freio/ré; joystick = direção.
   */
  drive(dt: number): { up: number; down: number; steer: number; trim: number } {
    let gpUp = 0, gpDown = 0, gpSteer = 0, gpTrim = 0;
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || gp.mapping !== "standard") continue;
      gpTrim = (gp.buttons[5]?.pressed ? 1 : 0) - (gp.buttons[4]?.pressed ? 1 : 0);
      gpUp = Math.max(gp.buttons[7]?.value ?? 0, gp.buttons[12]?.pressed ? 1 : 0);
      gpDown = Math.max(gp.buttons[6]?.value ?? 0, gp.buttons[13]?.pressed ? 1 : 0);
      const ax = gp.axes[0] ?? 0;
      gpSteer = Math.abs(ax) > 0.12 ? (ax - Math.sign(ax) * 0.12) / 0.88 : 0;
      break;
    }
    const steerT = (this.k("KeyD", "ArrowRight") ? 1 : 0) - (this.k("KeyA", "ArrowLeft") ? 1 : 0);
    this.kbSteer = approach(this.kbSteer, steerT, (steerT === 0 ? 4 : 2.8) * dt);
    const tl = this.touchLever;
    const tUp = tl && tl.gear === "F" ? Math.max(0.35, tl.throttle) : 0;
    const tDown = tl && tl.gear === "R" ? Math.max(0.35, tl.throttle) : 0;
    return {
      up: Math.max(this.k("KeyW", "ArrowUp") ? 1 : 0, gpUp, tUp),
      down: Math.max(this.k("KeyS", "ArrowDown") ? 1 : 0, gpDown, tDown),
      steer: clamp(this.kbSteer + gpSteer + this.touchSteer, -1, 1),
      // trim/tilt do motor do barco continuam funcionando com ele na carretinha (E/Q, RB/LB, TRIM±)
      trim: clamp((this.k("KeyE") ? 1 : 0) - (this.k("KeyQ") ? 1 : 0) + this.touchTrim + gpTrim, -1, 1),
    };
  }

  toggleLights(): boolean { this.lights = !this.lights; return this.lights; }
  setLights(on: boolean): void { this.lights = on; }
  /** buzina: segurando B */
  /** botão de buzina/apito do painel do Y segurado */
  panelHorn = false;
  get hornHeld(): boolean { return this.keys.has("KeyB") || this.panelHorn; }
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

  // alavanca com detentes: topo = frente a toda, faixa central = N, base = ré.
  // Logo acima/abaixo do N fica a marcha lenta engrenada (anda devagar).
  const lever = root.querySelector<HTMLElement>("#t-lever")!;
  const handle = root.querySelector<HTMLElement>("#t-handle")!;
  const NEUTRAL = 0.62, DEAD = 0.035, IDLE = 0.07; // posições (0 topo .. 1 base)
  let leverId: number | null = null;
  const setLever = (pos: number) => {
    pos = clamp(pos, 0, 1);
    const d = pos - NEUTRAL;
    if (Math.abs(d) < DEAD) { input.touchLever = { gear: "N", throttle: 0 }; pos = NEUTRAL; }
    else if (d < 0) input.touchLever = { gear: "F", throttle: clamp((-d - IDLE) / (NEUTRAL - IDLE - 0.03), 0, 1) };
    else input.touchLever = { gear: "R", throttle: clamp((d - IDLE) / (1 - NEUTRAL - IDLE - 0.03), 0, 1) };
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
  hold("#t-anc-out", () => (input.touchAnchor = 1), () => (input.touchAnchor = 0));
  hold("#t-anc-in", () => (input.touchAnchor = -1), () => (input.touchAnchor = 0));
  const tap = (id: string, a: Action) => root.querySelector<HTMLElement>(id)!.addEventListener("click", () => input.pushAction(a));
  tap("#t-cam", "camera");
  tap("#t-lights", "lights");
  tap("#t-reset", "reset");
  tap("#t-ign", "ignition");
  root.querySelector<HTMLElement>("#t-neutral")!.addEventListener("click", () => setLever(NEUTRAL));
};
