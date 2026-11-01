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
import { WakeField, WaterWithWake } from "./sim/wake.ts";
import { v3 } from "./sim/math.ts";
import { InputManager, attachTouchControls, type Action } from "./platform/input.ts";
import { WaterVisual } from "./presentation/waterMaterial.ts";
import { buildTerrain, buildRocks, buildTrees, buildPier } from "./presentation/environment.ts";
import { buildBoat, setNavLights } from "./presentation/boatMesh.ts";
import { buildHelm, toRootLocal } from "./presentation/helm.ts";
import { buildPilot, buildPassenger } from "./presentation/pilot.ts";
import { PERSON_KG, type SeatId } from "./sim/params.ts";
import { WaterInteraction } from "./presentation/waterInteraction.ts";
import { BoatCamera } from "./presentation/cameras.ts";
import { Hud } from "./presentation/hud.ts";
import { EngineAudio } from "./presentation/audio.ts";

const BUILD = "poc-babylon 0.12.0";
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
  // Resolução: usa a densidade real da tela (retina do iPhone = 3×) até o teto do perfil. Antes o celular
  // renderizava a 1/1,5 do pixel CSS — no iPhone isso dava 1/4,5 da resolução nativa (imagem borrada).
  const dprMax = Math.min(devicePixelRatio || 1, cfg.quality.maxPixelRatio);
  const dprMin = Math.min(dprMax, cfg.quality.minPixelRatio);
  let pixelRatio = dprMax;
  engine.setHardwareScalingLevel(1 / pixelRatio);
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
  // a física enxerga a água + as marolas da esteira (a lancha sente a esteira ao cruzá-la)
  const wakeField = new WakeField();
  const physWater = new WaterWithWake(water, wakeField);

  // ---------------- cena ----------------
  const terrain = buildTerrain(scene, { terrainSubdiv: cfg.quality.terrainSubdiv, trees: cfg.quality.trees });
  const rocks = buildRocks(scene, world.rockList);
  const trees = buildTrees(scene, cfg.quality.trees);
  const pierMeshes = buildPier(scene, world.pier);
  const buoys = pierMeshes.filter((m) => m.name === "buoy");
  const boatVis = buildBoat(scene);
  const helm = buildHelm(scene, boatVis.root);
  const pilot = buildPilot(scene, boatVis.root);
  boatVis.meshes.push(...helm.meshes, ...pilot.meshes);
  // passageiros (aparecem conforme a lotação escolhida; o peso de cada um entra na física)
  const paxVis: Record<Exclude<SeatId, "helm">, ReturnType<typeof buildPassenger>> = {
    passenger: buildPassenger(scene, boatVis.root, -0.5, -0.22, "paxA", 0),
    rearLeft: buildPassenger(scene, boatVis.root, -0.45, -2.15, "paxB", 1),
    rearRight: buildPassenger(scene, boatVis.root, 0.45, -2.15, "paxC", 2),
  };
  for (const p of Object.values(paxVis)) boatVis.meshes.push(...p.meshes);
  const OCC_PRESETS: { label: string; seats: SeatId[] }[] = [
    { label: "só o piloto", seats: ["helm"] },
    { label: "piloto + carona", seats: ["helm", "passenger"] },
    { label: "piloto + 2 na popa", seats: ["helm", "rearLeft", "rearRight"] },
    { label: "lotada (4)", seats: ["helm", "passenger", "rearLeft", "rearRight"] },
  ];
  let occIdx = 0;
  const START_FUEL_L = 3; // pedido do usuário: começa na reserva (luz de combustível baixo acesa)
  boat.systems.fuelL = START_FUEL_L;
  const boatMeshes = boatVis.meshes.filter((m) => m.name !== "propDisc");
  // horímetro persistente (por navegador)
  const HOURS_KEY = "aquarush.engineHours";
  try { const h = Number(localStorage.getItem(HOURS_KEY)); boat.systems.engineHours = Number.isFinite(h) && h > 0 ? h : 37.2; } catch { boat.systems.engineHours = 37.2; }
  let hoursSaveT = 0;

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

  const fx = new WaterInteraction(scene, wakeField, { particles: cfg.quality.particles, wakeTexture: cfg.quality.wakeTexture });
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

  const applyOccupants = (i: number) => {
    occIdx = (i + OCC_PRESETS.length) % OCC_PRESETS.length;
    const pr = OCC_PRESETS[occIdx];
    boat.occupants = pr.seats.map((seat) => ({ seat, mass: PERSON_KG }));
    for (const [seat, p] of Object.entries(paxVis)) for (const m of p.meshes) m.setEnabled(pr.seats.includes(seat as SeatId));
    hud.setOccupants(`${pr.seats.length} · ${pr.label}`);
    hud.showToast(`Ocupantes: ${pr.label} (+${pr.seats.length * PERSON_KG} kg)`);
  };
  applyOccupants(0);
  document.getElementById("h-occ")!.addEventListener("click", () => input.pushAction("occupants"));

  let waterPreset = 2;
  const applyWater = (i: number) => {
    waterPreset = (i + WATER_PRESETS.length) % WATER_PRESETS.length;
    const p = WATER_PRESETS[waterPreset];
    water.intensity = p.waves;
    waterVis.ripple = p.ripple;
    hud.setWater(p.key);
    hud.showToast(p.label);
  };
  applyWater(1); // sempre começa em "1 — calma"
  document.getElementById("h-water")!.addEventListener("click", () => input.pushAction("waterNext"));

  // ---------------- laço: física em passo fixo + render interpolado ----------------
  let acc = 0;
  let paused = false;
  let lights = false;
  const prevPos = new Vector3(), curPos = new Vector3();
  const prevRot = new Quaternion(), curRot = new Quaternion();
  const snap = (dst: Vector3, q: Quaternion) => { dst.set(boat.pos.x, boat.pos.y, boat.pos.z); q.set(boat.rot.x, boat.rot.y, boat.rot.z, boat.rot.w); };
  snap(curPos, curRot); snap(prevPos, prevRot);
  let fpsSmooth = 60, resT = 0;
  let lastStartFail = "", lowFuelWarned = false;
  const qTilt = new Quaternion(), qSteer = new Quaternion();
  let lastGear = boat.telemetry.gear;
  let tiltWarned = false, intakeWarned = false;
  let lastStall = "";
  const skegMesh = boatVis.meshes.find((m) => m.name === "skeg")!;
  let physMs = 0;

  document.getElementById("h-build")!.textContent = `${BUILD} · ${engine.isWebGPU ? "WebGPU" : "WebGL" + (engine as Engine).webGLVersion} · q=${cfg.quality.name}`;

  const handle = (a: Action) => {
    if (a === "camera") {
      const mode = cam.toggle();
      hud.setCamera(mode);
      // no cockpit a câmera fica na cabeça do piloto: esconde cabeça/tronco (mãos e pernas continuam visíveis)
      for (const m of boatVis.meshes) if (/^pilot(Head|Jaw|Nose|Ear|Hair|Cap|Glasses|Neck)/.test(m.name)) m.setEnabled(mode !== "cockpit");
    }
    else if (a === "lights") { lights = input.toggleLights(); setNavLights(boatVis, lights); hud.setLights(lights); }
    else if (a === "reset") { input.setGear("N"); wakeField.reset(); boat.engine = "running"; boat.systems.fuelL = START_FUEL_L; boat.systems.coolantC = Math.min(boat.systems.coolantC, 60); boat.reset(spawnPos(), world.spawn.heading); snap(curPos, curRot); snap(prevPos, prevRot); hud.showToast(`Reposicionado no píer — ${START_FUEL_L} L no tanque`); }
    else if (a === "occupants") applyOccupants(occIdx + 1);
    else if (a === "debug") hud.toggleDebug();
    else if (a === "help") hud.toggleHelp();
    else if (a === "ignition") {
      const r = boat.toggleIgnition();
      const msg: Record<string, string> = { stopped: "Motor desligado", starting: "Chave ligada — autoteste…", busy: "Dando partida…", needNeutral: "Coloque em N para dar partida", noFuel: "Sem combustível — R para voltar ao píer e abastecer", lowBattery: "Bateria descarregada: nem o relé de partida arma", hot: "Motor quente demais — espere esfriar" };
      hud.showToast(msg[r]);
    }
    else if (a === "pause") { paused = !paused; hud.showToast(paused ? "Pausado" : "Continuando"); }
    else if (a === "waterNext") applyWater(waterPreset + 1);
    else if (a.startsWith("water")) applyWater(Number(a.slice(5)));
  };

  scene.onBeforeRenderObservable.add(() => {
    const dtReal = Math.min(engine.getDeltaTime() / 1000, 0.1);
    fpsSmooth += (1 / Math.max(dtReal, 1e-3) - fpsSmooth) * 0.05;
    // resolução dinâmica: baixa se o FPS cair abaixo de ~40, sobe de volta acima de ~57 (passos de 10 %)
    if ((resT += dtReal) > 1.5 && !paused) {
      const next = fpsSmooth < 40 ? Math.max(dprMin, pixelRatio * 0.9) : fpsSmooth > 57 ? Math.min(dprMax, pixelRatio * 1.1) : pixelRatio;
      if (Math.abs(next - pixelRatio) > 0.01) { pixelRatio = next; engine.setHardwareScalingLevel(1 / pixelRatio); resT = 0; }
      else resT = 1.5;
    }
    for (const a of input.consumeActions()) handle(a);

    const vin = input.update(dtReal);
    if (!paused) {
      const tp = performance.now();
      acc += dtReal;
      let n = 0;
      while (acc >= PHYSICS_DT && n < MAX_SUBSTEPS) {
        prevPos.copyFrom(curPos); prevRot.copyFrom(curRot);
        water.time += PHYSICS_DT;
        boat.step(PHYSICS_DT, vin, physWater, world);
        wakeField.update(PHYSICS_DT, boat);
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
    // tilt/trim por fora (tubo no espelho), direção por dentro (eixo do motor) — mesma ordem da física.
    // (rotation.x/y da Babylon aplica o yaw por fora: com o motor recolhido ele varria o pé para os lados)
    Quaternion.RotationAxisToRef(Vector3.Right(), (T.trimDeg + T.tiltDeg) * Math.PI / 180, qTilt);
    Quaternion.RotationAxisToRef(Vector3.Up(), -T.steerDeg * Math.PI / 180, qSteer);
    boatVis.engine.rotationQuaternion = qTilt.multiply(qSteer);
    helm.update(dtReal, T, input.state, SPEEDBOAT.maxSteerLow * 180 / Math.PI);
    pilot.update(toRootLocal(helm.wheelGrip, boatVis.root), toRootLocal(helm.leverGrip, boatVis.root));
    if (T.startFail && T.startFail !== lastStartFail) hud.showToast(T.startFail === "dead" ? "Só estalou: bateria sem força para girar o arranque" : "Não pegou: o arranque girou fraco (bateria baixa)");
    lastStartFail = T.startFail;
    if (T.lowFuel && !lowFuelWarned && T.engine === "running") { hud.showToast(`Combustível na reserva: ${T.fuelL.toFixed(1)} L`); lowFuelWarned = true; }
    if (!T.lowFuel) lowFuelWarned = false;
    if (T.stall && T.stall !== lastStall) hud.showToast(T.stall === "fuel" ? "O motor morreu: acabou o combustível" : "O motor desligou: superaquecimento");
    lastStall = T.stall;
    if ((hoursSaveT += dtReal) > 10) { hoursSaveT = 0; try { localStorage.setItem(HOURS_KEY, String(boat.systems.engineHours)); } catch { /* sem storage */ } }
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
    fx.updateTelltale(boatVis.telltale.getAbsolutePosition().clone(), Vector3.TransformNormal(new Vector3(1, -0.15, -0.35), ew), T.rpm, new Vector3(boat.vel.x, boat.vel.y, boat.vel.z),
      T.engine === "running" && T.intakeSubmerged); // sem água na entrada do pé = sem esguicho
    if (T.tiltBlocked && !tiltWarned) { hud.showToast("Tilt bloqueado: o empuxo da hélice segura o motor — reduza a rotação"); tiltWarned = true; }
    if (!T.tiltBlocked) tiltWarned = false;
    if (T.engine === "running" && !T.intakeSubmerged && T.tiltDeg > 5 && !intakeWarned) { hud.showToast("Motor recolhido: sem água de refrigeração!"); intakeWarned = true; }
    if (T.intakeSubmerged) intakeWarned = false;

    fx.updateDrips(dtReal, skegMesh.getAbsolutePosition().clone(), T.propImmersion);
    if (T.gear !== lastGear) { audio.clunk(T.gear !== "N"); lastGear = T.gear; }
    audio.update({
      rpm: T.rpm, throttle: T.throttle, speed: Math.hypot(boat.vel.x, boat.vel.z), boil: Math.max(T.cavitation, 1 - T.ventilation),
      inGear: T.gear !== "N", propInWater: T.propImmersion > 0.5, revLimiter: T.revLimiter, cockpit: cam.mode === "cockpit", engine: T.engine, trimMotorA: T.trimMotorA, buzzer: T.buzzer, starterRpm: T.starterRpm,
    });
    hud.update(T, fpsSmooth, {
      "física (ms/frame)": physMs.toFixed(2),
      "resolução": `${engine.getRenderWidth()}×${engine.getRenderHeight()} (${pixelRatio.toFixed(2)}×)`,
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
