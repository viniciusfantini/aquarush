// Bootstrap da POC 1 (Babylon.js). Une Simulation (sim/), Gameplay (gameplay/),
// Presentation (presentation/) e Platform (platform/) com um laço de física em PASSO FIXO
// (120 Hz) e renderização interpolada.

import {
  Engine, WebGPUEngine, Scene, Vector3, Quaternion, Color3, Color4, HemisphericLight, DirectionalLight, ShadowGenerator,
  MeshBuilder, ReflectionProbe, RenderTargetTexture, ImageProcessingConfiguration, type AbstractEngine, type Mesh, type AbstractMesh,
} from "@babylonjs/core";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";

import { readUrlConfig, PHYSICS_DT, MAX_SUBSTEPS } from "./core/config.ts";
import { Speedboat } from "./sim/boat.ts";
import { SPEEDBOAT } from "./sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "./sim/water.ts";
import { buildWorld, RIVER_CURRENT } from "./sim/world.ts";
import { v3 } from "./sim/math.ts";
import { InputManager, attachTouchControls, type Action } from "./platform/input.ts";
import { WaterVisual } from "./presentation/waterMaterial.ts";
import { buildTerrain, buildRocks, buildTrees, buildPier } from "./presentation/environment.ts";
import { buildBoat, setNavLights, needleAngle } from "./presentation/boatMesh.ts";
import { WaterInteraction } from "./presentation/waterInteraction.ts";
import { BoatCamera } from "./presentation/cameras.ts";
import { Hud } from "./presentation/hud.ts";
import { EngineAudio } from "./presentation/audio.ts";

const BUILD = "poc-babylon 0.4.0";
/** Escala visual da rotação da hélice (proporcional ao RPM, abaixo do limite estroboscópico). */
const PROP_VISUAL_SCALE = 0.12;

/** Presets de água: amplitude das ondas de Gerstner (física + visual) e ondulação fina (visual). */
const WATER_PRESETS = [
  { key: "vidro", label: "Água: vidro (glass)", waves: 0, ripple: 0 },
  { key: "calma", label: "Água: calma", waves: 0.35, ripple: 0.45 },
  { key: "lago", label: "Água: lago", waves: 1, ripple: 1 },
  { key: "forte", label: "Água: ondas fortes", waves: 2.5, ripple: 1.4 },
] as const;

const boot = async () => {
  const cfg = readUrlConfig();
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const t0 = performance.now();

  let engine: AbstractEngine;
  if (cfg.webgpu && (await WebGPUEngine.IsSupportedAsync)) {
    const e = new WebGPUEngine(canvas, { antialias: true, stencil: false });
    await e.initAsync();
    engine = e;
  } else {
    engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance" }, true);
  }
  engine.setHardwareScalingLevel(cfg.quality.hardwareScaling * (cfg.isMobile ? Math.max(1, 2 / devicePixelRatio) : 1));
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.72, 0.8, 0.86, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0009;
  scene.fogColor = new Color3(0.72, 0.8, 0.86);
  scene.skipPointerMovePicking = true;
  // grupo 1 = spray (desenhado depois da água, mas respeitando a profundidade da cena)
  scene.setRenderingAutoClearDepthStencil(1, false, false, false);
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
  scene.imageProcessingConfiguration.exposure = 1.05;

  // ---------------- luz e céu ----------------
  const sunDir = new Vector3(-0.45, 0.62, 0.55).normalize(); // direção PARA o sol
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  hemi.groundColor = new Color3(0.32, 0.33, 0.3);
  const sun = new DirectionalLight("sun", sunDir.scale(-1), scene);
  sun.position = sunDir.scale(200);
  sun.intensity = 1.6;
  sun.diffuse = new Color3(1, 0.96, 0.88);

  const skyMat = new SkyMaterial("sky", scene);
  skyMat.backFaceCulling = false;
  skyMat.useSunPosition = true;
  skyMat.sunPosition = sunDir.scale(100);
  skyMat.turbidity = 4;
  skyMat.luminance = 1;
  skyMat.rayleigh = 1.6;
  skyMat.mieCoefficient = 0.004;
  skyMat.mieDirectionalG = 0.85;
  skyMat.fogEnabled = false;
  const skybox = MeshBuilder.CreateBox("skyBox", { size: 3000 }, scene);
  skybox.material = skyMat;
  skybox.infiniteDistance = true;
  skybox.isPickable = false;

  // ---------------- simulação ----------------
  const world = buildWorld();
  const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: world.groundHeight, currents: [RIVER_CURRENT] });
  const spawnPos = () => v3(world.spawn.x, 0.25, world.spawn.z);
  const boat = new Speedboat(SPEEDBOAT, spawnPos(), world.spawn.heading);

  // ---------------- cena ----------------
  const terrain = buildTerrain(scene, { terrainSubdiv: cfg.quality.terrainSubdiv, trees: cfg.quality.trees });
  const rocks = buildRocks(scene, world.rockList);
  const trees = buildTrees(scene, cfg.quality.trees);
  const pierMeshes = buildPier(scene, world.pier);
  const buoys = pierMeshes.filter((m) => m.name === "buoy");
  const boatVis = buildBoat(scene);
  const boatMeshes = boatVis.meshes.filter((m) => m.name !== "propDisc");

  // ambiente para os materiais PBR (céu + margens, renderizado uma vez)
  const probe = new ReflectionProbe("envProbe", 128, scene);
  probe.position = new Vector3(0, 6, 0);
  probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  probe.renderList!.push(skybox, terrain, trees);
  scene.environmentTexture = probe.cubeTexture;

  const cam = new BoatCamera(scene, canvas);
  scene.activeCamera = cam.cam;

  let depth = null;
  if (cfg.quality.depthEffects) {
    depth = scene.enableDepthRenderer(cam.cam, false, true);
    const list: Mesh[] = [terrain, rocks, ...pierMeshes, ...boatMeshes];
    depth.getDepthMap().renderList = list;
  }

  const fx = new WaterInteraction(scene, { particles: cfg.quality.particles, wakeTexture: cfg.quality.wakeTexture });
  const waterVis = new WaterVisual(scene, {
    resolution: cfg.quality.waterResolution, innerExtent: 80, outerExtent: 2600, depth, wake: fx.wake, reflectionSize: cfg.quality.reflection,
  });
  waterVis.sunDir = sunDir;
  waterVis.fogDensity = scene.fogDensity;
  const reflList: AbstractMesh[] = [skybox, terrain, rocks, trees, ...pierMeshes, ...boatMeshes];
  waterVis.setReflectionList(reflList);

  if (cfg.quality.shadows > 0) {
    const sg = new ShadowGenerator(cfg.quality.shadows, sun);
    sg.usePercentageCloserFiltering = true;
    sg.bias = 0.002;
    for (const m of boatMeshes) { if (m.name !== "windshield") sg.addShadowCaster(m); m.receiveShadows = true; }
    for (const m of pierMeshes) sg.addShadowCaster(m);
    sg.addShadowCaster(trees);
    trees.receiveShadows = true;
    for (const m of pierMeshes) m.receiveShadows = true;
    sun.autoUpdateExtends = false;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 400;
    sun.orthoLeft = -40; sun.orthoRight = 40; sun.orthoTop = 40; sun.orthoBottom = -40;
  }

  const input = new InputManager(window);
  const ui = document.getElementById("ui")!;
  attachTouchControls(ui, input);
  const hud = new Hud();
  const audio = new EngineAudio();
  const startAudio = () => audio.start();
  window.addEventListener("keydown", startAudio);
  window.addEventListener("pointerdown", startAudio);

  const GEAR_MSG = { F: "F — frente engatada (lenta)", N: "N — neutro (sem empuxo)", R: "R — ré engatada (lenta)" } as const;
  input.onGearChange = (g) => hud.showToast(GEAR_MSG[g]);

  let waterPreset = 2;
  const applyWater = (i: number) => {
    waterPreset = (i + WATER_PRESETS.length) % WATER_PRESETS.length;
    const p = WATER_PRESETS[waterPreset];
    water.intensity = p.waves;
    waterVis.ripple = p.ripple;
    hud.setWater(p.key);
    hud.showToast(p.label);
  };
  applyWater(2);
  document.getElementById("h-water")!.addEventListener("click", () => input.pushAction("waterNext"));

  // ---------------- laço: física em passo fixo + render interpolado ----------------
  let acc = 0;
  let paused = false;
  let lights = false;
  const prevPos = new Vector3(), curPos = new Vector3();
  const prevRot = new Quaternion(), curRot = new Quaternion();
  const snap = (dst: Vector3, q: Quaternion) => { dst.set(boat.pos.x, boat.pos.y, boat.pos.z); q.set(boat.rot.x, boat.rot.y, boat.rot.z, boat.rot.w); };
  snap(curPos, curRot); snap(prevPos, prevRot);
  let fpsSmooth = 60;
  let lastGear = boat.telemetry.gear;
  let physMs = 0;

  document.getElementById("h-build")!.textContent = `${BUILD} · ${engine.isWebGPU ? "WebGPU" : "WebGL" + (engine as Engine).webGLVersion} · q=${cfg.quality.name}`;

  const handle = (a: Action) => {
    if (a === "camera") {
      const mode = cam.toggle();
      hud.setCamera(mode);
      // no cockpit a câmera fica na cabeça do piloto: esconde cabeça/tronco (mãos e pernas continuam visíveis)
      for (const m of boatVis.meshes) if (/^pilot|^capBrim/.test(m.name)) m.setEnabled(mode !== "cockpit");
    }
    else if (a === "lights") { lights = input.toggleLights(); setNavLights(boatVis, lights); hud.setLights(lights); }
    else if (a === "reset") { input.setGear("N"); boat.reset(spawnPos(), world.spawn.heading); snap(curPos, curRot); snap(prevPos, prevRot); hud.showToast("Reposicionado no píer"); }
    else if (a === "debug") hud.toggleDebug();
    else if (a === "help") hud.toggleHelp();
    else if (a === "pause") { paused = !paused; hud.showToast(paused ? "Pausado" : "Continuando"); }
    else if (a === "waterNext") applyWater(waterPreset + 1);
    else if (a.startsWith("water")) applyWater(Number(a.slice(5)));
  };

  scene.onBeforeRenderObservable.add(() => {
    const dtReal = Math.min(engine.getDeltaTime() / 1000, 0.1);
    fpsSmooth += (1 / Math.max(dtReal, 1e-3) - fpsSmooth) * 0.05;
    for (const a of input.consumeActions()) handle(a);

    const vin = input.update(dtReal);
    if (!paused) {
      const tp = performance.now();
      acc += dtReal;
      let n = 0;
      while (acc >= PHYSICS_DT && n < MAX_SUBSTEPS) {
        prevPos.copyFrom(curPos); prevRot.copyFrom(curRot);
        water.time += PHYSICS_DT;
        boat.step(PHYSICS_DT, vin, water, world);
        snap(curPos, curRot);
        acc -= PHYSICS_DT;
        n++;
      }
      if (n === MAX_SUBSTEPS) acc = 0;
      physMs += (performance.now() - tp - physMs) * 0.05;
    }
    const alpha = paused ? 1 : acc / PHYSICS_DT;
    const rPos = Vector3.Lerp(prevPos, curPos, alpha);
    const rRot = Quaternion.Slerp(prevRot, curRot, alpha);

    // barco visual = estado físico interpolado
    boatVis.root.position.copyFrom(rPos);
    boatVis.root.rotationQuaternion = rRot;
    const T = boat.telemetry;
    boatVis.engine.rotation.y = -T.steerDeg * Math.PI / 180;
    boatVis.engine.rotation.x = T.trimDeg * Math.PI / 180;
    boatVis.wheel.rotation.z = -T.steerDeg * Math.PI / 180 * 5;
    boatVis.speedNeedle.rotation.z = needleAngle(T.speedKmh, 100);
    boatVis.rpmNeedle.rotation.z = needleAngle(T.rpm / 1000, 7);
    // hélice: velocidade visual PROPORCIONAL ao RPM real (escala fixa de 0,12). A rotação real (até ~48 voltas/s)
    // daria efeito estroboscópico a 60 FPS (a hélice pareceria parada ou girando ao contrário).
    if (!paused) boatVis.propeller.rotation.z += (T.propRpm / 60) * PROP_VISUAL_SCALE * 2 * Math.PI * dtReal;
    boatVis.propBlur.alpha = Math.min(0.3, Math.max(0, (Math.abs(T.propRpm) - 1200) / 4000));
    for (const b of buoys) b.position.y = water.getHeight(b.position.x, b.position.z) - 0.05;

    cam.update(dtReal, rPos, rRot, Math.hypot(boat.vel.x, boat.vel.z));
    if (!paused) fx.update(dtReal, boat, water);
    waterVis.update(water, cam.cam, engine.getRenderWidth(), engine.getRenderHeight());
    if (cfg.quality.shadows > 0) sun.position = rPos.add(sunDir.scale(150));

    // esguicho de refrigeração: bico no capô, jato para fora (+X local do motor, levemente para trás e para baixo)
    const ew = boatVis.engine.getWorldMatrix();
    fx.updateTelltale(boatVis.telltale.getAbsolutePosition().clone(), Vector3.TransformNormal(new Vector3(1, -0.15, -0.35), ew), T.rpm, new Vector3(boat.vel.x, boat.vel.y, boat.vel.z));

    if (T.gear !== lastGear) { audio.clunk(T.gear !== "N"); lastGear = T.gear; }
    audio.update({
      rpm: T.rpm, throttle: T.throttle, speed: Math.hypot(boat.vel.x, boat.vel.z), boil: Math.max(T.cavitation, 1 - T.ventilation),
      inGear: T.gear !== "N", propInWater: T.ventilation > 0.5, cockpit: cam.mode === "cockpit",
    });
    hud.update(T, fpsSmooth, {
      "física (ms/frame)": physMs.toFixed(2),
      "malhas ativas": String(scene.getActiveMeshes().length),
      "input": input.lastDevice,
      "ondas": water.intensity.toFixed(2),
      "correnteza (m/s)": Math.hypot(water.getCurrent(boat.pos.x, boat.pos.z).x, water.getCurrent(boat.pos.x, boat.pos.z).z).toFixed(2),
    });
  });

  // diagnóstico: se a cena demorar a ficar pronta, lista o que está pendente
  const readyWatch = window.setTimeout(() => {
    const pend = scene.meshes.filter((m) => m.isEnabled() && !m.isReady(true)).map((m) => `${m.name}:${m.material?.name ?? "-"}`);
    const rtts = scene.customRenderTargets.filter((t) => !t.isReady()).map((t) => t.name);
    console.warn("[AquaRush] cena ainda não pronta " + JSON.stringify({ pend, rtts, env: scene.environmentTexture?.isReady() }));
  }, 4000);
  await scene.whenReadyAsync();
  clearTimeout(readyWatch);
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
  document.getElementById("loading")?.classList.add("done");
  const loadMs = performance.now() - t0;
  console.info(`[AquaRush] pronto em ${loadMs.toFixed(0)} ms — ${BUILD} — ${engine.description}`);

  // exposto para testes manuais/automatizados no console
  (window as unknown as Record<string, unknown>).__aqua = { boat, water, waterVis, fx, audio, world, scene, engine, cam, input, boatVis, loadMs, checkConvention: () => {
    const f = boat.forward;
    const bf = boatVis.root.forward;
    return { sim: f, babylon: { x: bf.x, y: bf.y, z: bf.z } };
  } };
};

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById("loading");
  if (el) el.textContent = "Erro ao iniciar: " + (e as Error).message;
});
