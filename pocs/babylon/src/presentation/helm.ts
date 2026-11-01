// Posto de pilotagem (console de boreste): painel com instrumentos reais, volante, manete lateral
// de motor de popa (F/N/R + acelerador, botão de trim na manopla), chave de ignição e interruptores.
// Tudo lê a telemetria da simulação (BoatTelemetry) e o comando do piloto (VehicleInput).

import {
  type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, TransformNode, Vector3, DynamicTexture, Matrix,
} from "@babylonjs/core";
import type { BoatTelemetry } from "../sim/boat.ts";
import type { VehicleInput } from "../gameplay/vehicleInput.ts";
import { clamp } from "../sim/math.ts";

export const HELM_X = 0.5;
const FLOOR = 0.02;

const DEG = Math.PI / 180;

const pbr = (scene: Scene, name: string, c: Color3, metallic: number, roughness: number): PBRMaterial => {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = c; m.metallic = metallic; m.roughness = roughness; m.environmentIntensity = 0.9;
  return m;
};

const rrect = (w: number, h: number, r: number, seg = 4): Vector3[] => {
  const pts: Vector3[] = [];
  const rr = Math.min(r, w / 2, h / 2);
  const cs: [number, number, number][] = [[w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, Math.PI / 2], [-w / 2 + rr, -h / 2 + rr, Math.PI], [w / 2 - rr, -h / 2 + rr, 1.5 * Math.PI]];
  for (const [cx, cy, a0] of cs) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); pts.push(new Vector3(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0)); }
  pts.push(pts[0].clone());
  return pts;
};
const rbox = (name: string, scene: Scene, w: number, h: number, d: number, r: number): Mesh =>
  MeshBuilder.ExtrudeShape(name, { shape: rrect(w, h, r), path: [new Vector3(0, 0, -d / 2), new Vector3(0, 0, d / 2)], cap: Mesh.CAP_ALL, sideOrientation: Mesh.DOUBLESIDE }, scene);

// ---------------- mostradores ----------------
type Dial = { tex: DynamicTexture; redraw: (extra?: string) => void };

/** Mostrador grande (270°), opcionalmente com visor LCD (horímetro). */
const bigDial = (scene: Scene, name: string, max: number, step: number, label: string, redFrom: number, lcd: boolean): Dial => {
  const S = 512;
  const tex = new DynamicTexture(name, { width: S, height: S }, scene, true);
  const redraw = (extra?: string) => {
    const c = tex.getContext() as CanvasRenderingContext2D;
    c.clearRect(0, 0, S, S);
    const g = c.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.5);
    g.addColorStop(0, "#1c2128"); g.addColorStop(1, "#0a0c0f");
    c.beginPath(); c.arc(S / 2, S / 2, S * 0.49, 0, Math.PI * 2); c.fillStyle = g; c.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    // faixa vermelha
    c.beginPath(); c.arc(S / 2, S / 2, S * 0.43, a0 + (redFrom / max) * (a1 - a0), a1);
    c.lineWidth = S * 0.035; c.strokeStyle = "#d8262b"; c.stroke();
    for (let v = 0; v <= max + 1e-6; v += step / 4) {
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const mid = !major && Math.abs((v * 2) / step - Math.round((v * 2) / step)) < 1e-6;
      const a = a0 + (v / max) * (a1 - a0);
      const r0 = S * (major ? 0.36 : mid ? 0.39 : 0.41), r1 = S * 0.45;
      c.beginPath(); c.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0); c.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1);
      c.lineWidth = major ? 7 : mid ? 4 : 2; c.strokeStyle = "#f2f5f7"; c.stroke();
      if (major) {
        c.fillStyle = "#f2f5f7"; c.font = "bold 46px Arial, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(String(Math.round(v)), S / 2 + Math.cos(a) * S * 0.27, S / 2 + Math.sin(a) * S * 0.27);
      }
    }
    c.fillStyle = "#9fb0bd"; c.font = "28px Arial, sans-serif"; c.textAlign = "center"; c.fillText(label, S / 2, S * 0.36);
    if (lcd) {
      c.fillStyle = "#3a4a2a"; c.fillRect(S * 0.33, S * 0.66, S * 0.34, S * 0.11);
      c.strokeStyle = "#7a7f86"; c.lineWidth = 3; c.strokeRect(S * 0.33, S * 0.66, S * 0.34, S * 0.11);
      c.fillStyle = "#b9e07a"; c.font = "bold 40px 'Courier New', monospace"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(extra ?? "0000.0", S / 2, S * 0.717);
      c.fillStyle = "#9fb0bd"; c.font = "20px Arial, sans-serif"; c.fillText("HORAS", S / 2, S * 0.82);
    }
    // aro cromado
    c.beginPath(); c.arc(S / 2, S / 2, S * 0.49, 0, Math.PI * 2); c.lineWidth = S * 0.02; c.strokeStyle = "#c9d2da"; c.stroke();
    tex.update();
  };
  redraw();
  tex.hasAlpha = true;
  return { tex, redraw };
};

/** Mostrador pequeno (90° na parte de cima): ex. combustível E–F, temperatura C–H. */
const smallDial = (scene: Scene, name: string, left: string, right: string, label: string, redLeft: boolean, redRight: boolean): DynamicTexture => {
  const S = 256;
  const tex = new DynamicTexture(name, { width: S, height: S }, scene, true);
  const c = tex.getContext() as CanvasRenderingContext2D;
  c.clearRect(0, 0, S, S);
  c.beginPath(); c.arc(S / 2, S / 2, S * 0.48, 0, Math.PI * 2); c.fillStyle = "#0c0f13"; c.fill();
  const a0 = Math.PI * 1.25, a1 = Math.PI * 1.75;
  if (redLeft) { c.beginPath(); c.arc(S / 2, S * 0.6, S * 0.36, a0, a0 + 0.12 * Math.PI); c.lineWidth = 12; c.strokeStyle = "#d8262b"; c.stroke(); }
  if (redRight) { c.beginPath(); c.arc(S / 2, S * 0.6, S * 0.36, a1 - 0.12 * Math.PI, a1); c.lineWidth = 12; c.strokeStyle = "#d8262b"; c.stroke(); }
  for (let i = 0; i <= 8; i++) {
    const a = a0 + (i / 8) * (a1 - a0);
    const r0 = S * (i % 2 === 0 ? 0.28 : 0.31);
    c.beginPath(); c.moveTo(S / 2 + Math.cos(a) * r0, S * 0.6 + Math.sin(a) * r0); c.lineTo(S / 2 + Math.cos(a) * S * 0.36, S * 0.6 + Math.sin(a) * S * 0.36);
    c.lineWidth = i % 2 === 0 ? 5 : 2; c.strokeStyle = "#f2f5f7"; c.stroke();
  }
  c.fillStyle = "#f2f5f7"; c.font = "bold 30px Arial, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(left, S * 0.2, S * 0.36); c.fillText(right, S * 0.8, S * 0.36);
  c.fillStyle = "#9fb0bd"; c.font = "24px Arial, sans-serif"; c.fillText(label, S / 2, S * 0.78);
  c.beginPath(); c.arc(S / 2, S / 2, S * 0.48, 0, Math.PI * 2); c.lineWidth = 8; c.strokeStyle = "#c9d2da"; c.stroke();
  tex.hasAlpha = true;
  tex.update();
  return tex;
};

/** Rotação Z do ponteiro para um ângulo do canvas (horário a partir de +x). */
const needleRot = (canvasAngle: number) => canvasAngle - Math.PI / 2;
const bigAngle = (f: number) => needleRot(Math.PI * 0.75 + clamp(f, 0, 1.02) * Math.PI * 1.5);
const smallAngle = (f: number) => needleRot(Math.PI * 1.25 + clamp(f, 0, 1) * Math.PI * 0.5);

export interface Helm {
  wheel: TransformNode;
  /** ponto da manopla da manete (para a mão direita do piloto) */
  leverGrip: TransformNode;
  /** ponto no aro do volante (para a mão esquerda) */
  wheelGrip: TransformNode;
  meshes: Mesh[];
  update(dt: number, t: BoatTelemetry, input: VehicleInput, maxSteerDeg: number): void;
}

export const buildHelm = (scene: Scene, root: TransformNode): Helm => {
  const meshes: Mesh[] = [];
  const add = <M extends Mesh>(m: M, mat: StandardMaterial | PBRMaterial, parent: TransformNode = root): M => { m.material = mat; m.parent = parent; m.isPickable = false; meshes.push(m); return m; };

  const gel = pbr(scene, "helmGel", new Color3(0.95, 0.96, 0.97), 0, 0.22);
  gel.clearCoat.isEnabled = true; gel.clearCoat.intensity = 0.8;
  const black = pbr(scene, "helmBlack", new Color3(0.025, 0.028, 0.032), 0, 0.35);
  const blackGloss = pbr(scene, "helmBlackGloss", new Color3(0.02, 0.022, 0.025), 0, 0.12);
  const steel = pbr(scene, "helmSteel", new Color3(0.92, 0.93, 0.95), 0.9, 0.2);
  const rubber = pbr(scene, "helmRubber", new Color3(0.04, 0.04, 0.045), 0, 0.75);
  const red = pbr(scene, "helmRed", new Color3(0.75, 0.05, 0.05), 0, 0.4);

  // ---------- console ----------
  const console_ = add(rbox("helmConsole", scene, 0.62, 0.72, 0.55, 0.08), gel);
  console_.position.set(HELM_X, FLOOR + 0.36, 0.8);
  const dash = new TransformNode("dash", scene);
  dash.parent = root;
  dash.position.set(HELM_X, FLOOR + 0.84, 0.58);
  dash.rotation.x = 0.55; // topo afastado do piloto: face voltada para cima/trás
  add(rbox("dashHousing", scene, 0.66, 0.36, 0.14, 0.05), gel, dash).position.z = 0.075;
  const panel = add(rbox("dashPanel", scene, 0.62, 0.32, 0.012, 0.03), blackGloss, dash);
  panel.position.z = 0.0;
  const visor = add(rbox("dashVisor", scene, 0.66, 0.03, 0.12, 0.012), gel, dash);
  visor.position.set(0, 0.17, -0.045);
  // pé do console até o painel (carenagem)
  const fair = add(rbox("dashFairing", scene, 0.64, 0.16, 0.22, 0.05), gel);
  fair.position.set(HELM_X, FLOOR + 0.74, 0.68);

  const face = (name: string, tex: DynamicTexture, size: number, x: number, y: number) => {
    const p = MeshBuilder.CreatePlane(name, { size }, scene);
    const m = new StandardMaterial(name + "Mat", scene);
    m.diffuseTexture = tex; m.emissiveTexture = tex; m.emissiveColor = new Color3(0.55, 0.55, 0.55);
    m.useAlphaFromDiffuseTexture = true; m.specularColor = new Color3(0.5, 0.5, 0.5);
    add(p, m, dash).position.set(x, y, -0.008);
    const bez = add(MeshBuilder.CreateTorus(name + "Bezel", { diameter: size * 1.0, thickness: size * 0.07, tessellation: 32 }, scene), steel, dash);
    bez.rotation.x = Math.PI / 2; bez.position.set(x, y, -0.01);
    // vidro do instrumento
    const g = MeshBuilder.CreateDisc(name + "Glass", { radius: size * 0.48, tessellation: 32 }, scene);
    const gm = pbr(scene, name + "GlassMat", new Color3(0.6, 0.65, 0.7), 0, 0.02); gm.alpha = 0.12;
    add(g, gm, dash).position.set(x, y, -0.02);
    const pivot = new TransformNode(name + "Pivot", scene);
    pivot.parent = dash; pivot.position.set(x, y, -0.014);
    const needleMat = pbr(scene, name + "Needle", new Color3(1, 0.32, 0.08), 0, 0.4); needleMat.emissiveColor = new Color3(0.9, 0.25, 0.05);
    const n = add(MeshBuilder.CreateBox(name + "NeedleM", { width: size * 0.035, height: size * 0.4, depth: 0.002 }, scene), needleMat, pivot);
    n.position.y = size * 0.16;
    add(MeshBuilder.CreateCylinder(name + "Cap", { height: 0.006, diameter: size * 0.1 }, scene), black, pivot).rotation.x = Math.PI / 2;
    return pivot;
  };
  const speedo = bigDial(scene, "speedoTex", 100, 20, "km/h", 85, false);
  const tacho = bigDial(scene, "tachoTex", 7, 1, "RPM x1000", 6, true);
  const speedNeedle = face("speedo", speedo.tex, 0.15, -0.15, 0.045);
  const rpmNeedle = face("tacho", tacho.tex, 0.15, 0.15, 0.045);
  const fuelNeedle = face("fuelG", smallDial(scene, "fuelTex", "E", "F", "COMBUST.", true, false), 0.07, -0.225, -0.105);
  const tempNeedle = face("tempG", smallDial(scene, "tempTex", "C", "H", "TEMP °C", false, true), 0.07, -0.075, -0.105);
  const voltNeedle = face("voltG", smallDial(scene, "voltTex", "8", "16", "VOLTS", true, false), 0.07, 0.075, -0.105);
  const trimNeedle = face("trimG", smallDial(scene, "trimTex", "▼", "▲", "TRIM", false, false), 0.07, 0.225, -0.105);

  // luzes de alarme (entre os relógios grandes)
  const led = (name: string, c: Color3, y: number) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = c.scale(0.25); m.emissiveColor = Color3.Black(); m.specularColor = new Color3(0.6, 0.6, 0.6);
    add(MeshBuilder.CreateSphere(name + "M", { diameter: 0.018, segments: 8 }, scene), m, dash).position.set(0, y, -0.008);
    return { m, c };
  };
  const ledHot = led("ledHot", new Color3(1, 0.1, 0.05), 0.09);
  const ledFuel = led("ledFuel", new Color3(1, 0.65, 0.05), 0.055);
  const ledChg = led("ledChg", new Color3(1, 0.1, 0.05), 0.02);
  const ledNeutral = led("ledN", new Color3(0.1, 1, 0.3), -0.015);

  // ---------- chave de ignição e interruptores (face do console voltada ao piloto) ----------
  const keyPanel = add(rbox("switchPanel", scene, 0.5, 0.12, 0.01, 0.02), blackGloss);
  keyPanel.position.set(HELM_X, FLOOR + 0.6, 0.522);
  const keyBase = add(MeshBuilder.CreateCylinder("keyBase", { height: 0.012, diameter: 0.045, tessellation: 24 }, scene), steel);
  keyBase.rotation.x = Math.PI / 2; keyBase.position.set(HELM_X + 0.17, FLOOR + 0.6, 0.512);
  const key = new TransformNode("ignKey", scene);
  key.parent = root; key.position.set(HELM_X + 0.17, FLOOR + 0.6, 0.505);
  add(MeshBuilder.CreateBox("keyBlade", { width: 0.008, height: 0.03, depth: 0.02 }, scene), steel, key).position.z = -0.01;
  add(rbox("keyHead", scene, 0.032, 0.026, 0.008, 0.008), black, key).position.set(0, 0, -0.026);
  for (let i = 0; i < 3; i++) {
    add(rbox("rocker", scene, 0.028, 0.05, 0.016, 0.005), i === 0 ? red : black).position.set(HELM_X - 0.18 + i * 0.05, FLOOR + 0.6, 0.512);
  }

  // ---------- volante ----------
  const wheelMount = new TransformNode("wheelMount", scene);
  wheelMount.parent = root;
  wheelMount.position.set(HELM_X, FLOOR + 0.83, 0.42);
  wheelMount.rotation.x = 0.5;
  const col = add(MeshBuilder.CreateCylinder("column", { height: 0.2, diameterTop: 0.05, diameterBottom: 0.07, tessellation: 16 }, scene), black, wheelMount);
  col.rotation.x = Math.PI / 2; col.position.z = 0.1;
  const wheel = new TransformNode("wheel", scene);
  wheel.parent = wheelMount;
  const R = 0.17;
  const rim = add(MeshBuilder.CreateTorus("wheelRim", { diameter: R * 2, thickness: 0.032, tessellation: 40 }, scene), rubber, wheel);
  rim.rotation.x = Math.PI / 2;
  add(MeshBuilder.CreateCylinder("wheelHub", { height: 0.05, diameter: 0.075, tessellation: 20 }, scene), steel, wheel).rotation.x = Math.PI / 2;
  const cap = add(MeshBuilder.CreateCylinder("wheelCap", { height: 0.012, diameter: 0.06, tessellation: 20 }, scene), black, wheel);
  cap.rotation.x = Math.PI / 2; cap.position.z = -0.03;
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const sp = add(MeshBuilder.CreateBox("spoke", { width: R - 0.03, height: 0.016, depth: 0.01 }, scene), steel, wheel);
    sp.position.set(Math.cos(a) * (R / 2), Math.sin(a) * (R / 2), -0.005);
    sp.rotation.z = a;
  }
  // "pião" (manopla giratória) no aro
  const knob = add(MeshBuilder.CreateCylinder("wheelKnob", { height: 0.06, diameter: 0.025, tessellation: 12 }, scene), black, wheel);
  knob.rotation.x = Math.PI / 2; knob.position.set(Math.cos(0.6) * R, Math.sin(0.6) * R, -0.035);
  const wheelGrip = new TransformNode("wheelGrip", scene);
  wheelGrip.parent = wheel; wheelGrip.position.set(Math.cos(Math.PI * 0.82) * R, Math.sin(Math.PI * 0.82) * R, -0.01);

  // ---------- manete lateral (F / N / R + acelerador) ----------
  const binnacle = add(rbox("binnacle", scene, 0.09, 0.11, 0.2, 0.035), black);
  binnacle.position.set(HELM_X + 0.36, FLOOR + 0.66, 0.66);
  const pivotL = new TransformNode("leverPivot", scene);
  pivotL.parent = root; pivotL.position.set(HELM_X + 0.36, FLOOR + 0.7, 0.66);
  const arm = add(MeshBuilder.CreateCylinder("leverArm", { height: 0.24, diameter: 0.022, tessellation: 12 }, scene), steel, pivotL);
  arm.position.y = 0.12;
  const grip = add(MeshBuilder.CreateCapsule("leverGrip", { radius: 0.022, height: 0.12, orientation: new Vector3(1, 0, 0) }, scene), black, pivotL);
  grip.position.set(-0.045, 0.24, 0);
  const trimBtnMat = new StandardMaterial("trimBtn", scene);
  trimBtnMat.diffuseColor = new Color3(0.15, 0.15, 0.17); trimBtnMat.emissiveColor = Color3.Black();
  add(MeshBuilder.CreateBox("trimButton", { width: 0.014, height: 0.03, depth: 0.012 }, scene), trimBtnMat, pivotL).position.set(-0.085, 0.255, -0.012);
  const leverGrip = new TransformNode("leverGripPt", scene);
  leverGrip.parent = pivotL; leverGrip.position.set(-0.06, 0.235, 0);
  // indicador F/N/R no corpo da manete
  const fnr = new DynamicTexture("fnrTex", { width: 128, height: 64 }, scene, true);
  { const c = fnr.getContext() as CanvasRenderingContext2D; c.fillStyle = "#111"; c.fillRect(0, 0, 128, 64); c.fillStyle = "#ddd"; c.font = "bold 34px Arial"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("R N F", 64, 34); fnr.update(); }
  const fnrMat = new StandardMaterial("fnrMat", scene); fnrMat.diffuseTexture = fnr; fnrMat.emissiveTexture = fnr; fnrMat.emissiveColor = new Color3(0.3, 0.3, 0.3);
  const fnrPlate = add(MeshBuilder.CreatePlane("fnrPlate", { width: 0.12, height: 0.06 }, scene), fnrMat);
  fnrPlate.position.set(HELM_X + 0.36 - 0.047, FLOOR + 0.67, 0.66); fnrPlate.rotation.y = Math.PI / 2;

  // ---------- atualização ----------
  let leverAng = 0, keyAng = 0, lastHours = -1, blink = 0;
  const setLed = (l: { m: StandardMaterial; c: Color3 }, on: boolean) => { l.m.emissiveColor = on ? l.c : Color3.Black(); };
  return {
    wheel, leverGrip, wheelGrip, meshes,
    update(dt, t, input, maxSteerDeg) {
      blink += dt;
      speedNeedle.rotation.z = bigAngle(t.speedKmh / 100);
      rpmNeedle.rotation.z = bigAngle(t.rpm / 7000);
      fuelNeedle.rotation.z = smallAngle(t.fuelFrac);
      tempNeedle.rotation.z = smallAngle((t.coolantC - 40) / 80);
      voltNeedle.rotation.z = smallAngle((t.batteryV - 8) / 8);
      trimNeedle.rotation.z = smallAngle(t.tiltDeg > 0.5 ? 1 : (t.trim + 1) / 2);
      const hours = Math.floor(t.engineHours * 10);
      if (hours !== lastHours) { lastHours = hours; tacho.redraw((hours / 10).toFixed(1).padStart(6, "0")); }
      const flash = Math.floor(blink * 3) % 2 === 0;
      setLed(ledHot, t.overheatWarn && (!t.protectMode || flash));
      setLed(ledFuel, t.lowFuel);
      setLed(ledChg, t.chargeWarn || (t.engine !== "running"));
      setLed(ledNeutral, t.gear === "N");
      // chave: desligada 0°, ligada 35°, partida 70°
      const keyT = t.engine === "cranking" ? 70 : t.engine === "running" ? 35 : 0;
      keyAng += (keyT - keyAng) * (1 - Math.exp(-dt / 0.06));
      key.rotation.z = -keyAng * DEG;
      // volante: ¾ de volta para cada lado no batente
      wheel.rotation.z = -(t.steerDeg / maxSteerDeg) * 1.5 * Math.PI;
      // manete: N vertical; F 18° (lenta engrenada) → 70° (toda); R −18° → −55°
      const lt = input.gear === "F" ? 18 + 52 * input.throttle : input.gear === "R" ? -(18 + 37 * input.throttle) : 0;
      leverAng += (lt - leverAng) * (1 - Math.exp(-dt / 0.08));
      pivotL.rotation.x = leverAng * DEG;
      trimBtnMat.emissiveColor = input.trim > 0.1 ? new Color3(0.1, 0.6, 0.2) : input.trim < -0.1 ? new Color3(0.6, 0.4, 0.05) : Color3.Black();
    },
  };
};

/** Converte a posição mundial de um nó para o espaço local de `root`. */
export const toRootLocal = (node: TransformNode, root: TransformNode): Vector3 => {
  const inv = new Matrix();
  root.computeWorldMatrix(true).invertToRef(inv);
  return Vector3.TransformCoordinates(node.getAbsolutePosition(), inv);
};
