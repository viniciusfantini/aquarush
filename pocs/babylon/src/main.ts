// Bootstrap da POC 1 (Babylon.js). Une Simulation (sim/), Gameplay (gameplay/),
// Presentation (presentation/) e Platform (platform/) com um laço de física em PASSO FIXO
// (120 Hz) e renderização interpolada.
// Fluxo: carrega o lago → MENU (o barco escolhido boia no píer, câmera girando = prévia real) → JOGO.

import {
  Engine, WebGPUEngine, Scene, Vector3, Quaternion, Color3, Color4, HemisphericLight, DirectionalLight, ShadowGenerator,
  MeshBuilder, ReflectionProbe, RenderTargetTexture, ImageProcessingConfiguration, Matrix, type AbstractEngine, type Mesh, type AbstractMesh, TransformNode,
} from "@babylonjs/core";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";

import { readUrlConfig, PHYSICS_DT, MAX_SUBSTEPS } from "./core/config.ts";
import { Speedboat, NEUTRAL_REV_LIMIT } from "./sim/boat.ts";
import { JUMP_AH, JUMP_MAX_A, GPU_V } from "./sim/engineSystems.ts";
import { Wind, MS_TO_KNOTS } from "./sim/wind.ts";
import { VESSELS, PERSON_KG, type VesselKind, type SeatId, type SpeedboatParams } from "./sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "./sim/water.ts";
import { buildWorld, RIVER_CURRENT, RAMP, fromFrame } from "./sim/world.ts";
import { buildTrailer, trailerLoadState, attachWinch, seatedBoatLocal, type TrailerLayout } from "./sim/trailer.ts";
import { TowRig, TOW_SPECS, type Pose } from "./sim/towVehicle.ts";
import { buildRamp, buildTrailerMesh, buildTowVehicle, type WheelNode } from "./presentation/ramp.ts";
import { buildRoadAndLot, buildStation } from "./presentation/station.ts";
import { buildFleet } from "./presentation/fleet.ts";
import { buildMoorings, Ropes } from "./presentation/mooring.ts";
import { pierBerthState, tieToPier, BuoyField, CANYON_END, berthStartPose, pierWaitSpots, pierBerth } from "./sim/mooring.ts";
import { STATION, stationObstacles, fuelBayState, parkedStall } from "./sim/station.ts";
import { WakeField, WaterWithWake } from "./sim/wake.ts";
import { v3 } from "./sim/math.ts";
import { emptyInput } from "./gameplay/vehicleInput.ts";
import { InputManager, attachTouchControls, type Action } from "./platform/input.ts";
import { WaterVisual } from "./presentation/waterMaterial.ts";
import { buildTerrain, buildTrees, buildPier } from "./presentation/environment.ts";
import { buildBoat, setNavLights, type BoatVisual } from "./presentation/boatMesh.ts";
import { BoatGearVis } from "./presentation/boatGear.ts";
import { buildHelm, toRootLocal, HELM_X } from "./presentation/helm.ts";
import { buildPilot, buildPassenger, buildPerson, type Pilot } from "./presentation/pilot.ts";
import { buildDinghy, DINGHY_FLOOR, type DinghyControls } from "./presentation/dinghyMesh.ts";
import { buildRapida } from "./presentation/rapidaMesh.ts";
import { buildTurbina } from "./presentation/turbineMesh.ts";
import { WaterInteraction } from "./presentation/waterInteraction.ts";
import { TurbineExhaustFx } from "./presentation/exhaustFx.ts";
import { GpuCart } from "./presentation/gpuCart.ts";
import { TurbinePanel } from "./presentation/turbinePanel.ts";
import { SystemsPanel } from "./presentation/systemsPanel.ts";
import { BoatCamera } from "./presentation/cameras.ts";
import { Hud } from "./presentation/hud.ts";
import { EngineAudio } from "./presentation/audio.ts";

const BUILD = "poc-babylon 0.60.0";
/** Escala visual da rotação da hélice (proporcional ao RPM, abaixo do limite estroboscópico). */
const PROP_VISUAL_SCALE = 0.12;

/** Presets de água: amplitude das ondas de Gerstner (física + visual) e ondulação fina (visual). */
const WATER_PRESETS = [
  { key: "vidro", label: "Água: vidro (glass)", waves: 0, ripple: 0 },
  { key: "calma", label: "Água: calma", waves: 0.35, ripple: 0.45 },
  { key: "lago", label: "Água: lago", waves: 1, ripple: 1 },
  { key: "forte", label: "Água: ondas fortes", waves: 2.5, ripple: 1.4 },
] as const;

/**
 * Combustível ao começar / reposicionar: dá para chegar pelo menos à ENTRADA do cânion, mas de propósito NÃO ao
 * fim dele (≈1 km, metade rio acima) — o melhor consumo medido é 0,28 L/km (lancha a 38 km/h) e 0,06 L/km (bote a 22 km/h). É preciso
 * abastecer no posto (estrada da rampa). Pedido do usuário.
 */
/** Carga da bateria na largada (a lancha começa desligada, com a bateria a 60 %). */
const START_BATTERY = 0.6;
// TEMPORÁRIO (pedido do usuário, v0.35): 5 L na lancha e no bote para os testes de bateria/âncora/porão.
// A regra de jogo (não chegar ao fim do cânion) volta com { lancha: 0.25, bote: 0.05 }.
// A AR-9 (dois V8, ~210 L/h a pleno) começa com 20 L e a AR-10 (turbina, ~85 L/h só em marcha lenta, ~400 L/h a
// toda) com 120 L — também temporários.
const START_FUEL: Record<VesselKind, number> = { lancha: 5, bote: 5, rapida: 20, turbina: 120 };

/** Tudo o que pertence a uma embarcação: física, visual, comandos, pessoas. */
interface Vessel {
  kind: VesselKind;
  /** âncora + cabo e jato da bomba de porão (visual) */
  gear: BoatGearVis;
  P: SpeedboatParams;
  boat: Speedboat;
  vis: BoatVisual;
  helm: { meshes: Mesh[]; wheelGrip: import("@babylonjs/core").TransformNode; leverGrip: import("@babylonjs/core").TransformNode; update: DinghyControls["update"] };
  dinghy: DinghyControls | null;
  pilot: Pilot;
  pax: Partial<Record<Exclude<SeatId, "helm">, Pilot>>;
  presets: { label: string; seats: SeatId[] }[];
  skeg: Mesh;
  hoursKey: string;
  /** carretinha estacionada na rampa (física) + visual (carretinha e veículo de reboque) */
  trailer: TrailerLayout;
  trailerNodes: TransformNode[];
  trailerMeshes: Mesh[];
  /** veículo + carretinha articulada (dirigível quando o barco está preso na carretinha) */
  rig: TowRig;
  trailerRoot: TransformNode;
  carRoot: TransformNode;
  carBody: TransformNode;
  carWheels: WheelNode[];
  trailerWheels: WheelNode[];
}

const boot = async () => {
  const urlKind = new URLSearchParams(location.search).get("barco");
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
  // câmera embaixo d'água (neblina/cor do ar × da água)
  const AIR_FOG = new Color3(0.72, 0.8, 0.86), AIR_FOG_DENSITY = 0.0009;
  const UNDER_FOG = new Color3(0.04, 0.2, 0.21);
  let underwater = false;
  const underOverlay = document.createElement("div");
  underOverlay.id = "underwater";
  document.body.appendChild(underOverlay);
  skybox.material = skyMat;
  skybox.infiniteDistance = true;
  skybox.isPickable = false;

  // ---------------- simulação ----------------
  const world = buildWorld();
  const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: world.groundHeight, currents: [RIVER_CURRENT] });
  const spawnPos = () => v3(world.spawn.x, 0.25, world.spawn.z);
  const waitSpots = pierWaitSpots(world.pier);
  // GPU (fonte de solo de 28 V) parada no píer, à ré da vaga, com a saída do cabo virada para a água
  const berthB = pierBerth(world.pier);
  const gpuCart = new GpuCart(scene, berthB.edgeX - 1.3, berthB.deckY, berthB.z - 4.6, 0);
  // assistente de pátio (colete amarelo de alta visibilidade) ao lado da GPU — só com a lancha de turbina
  const gpuCrewRoot = new TransformNode("gpuCrewRoot", scene);
  const gpuCrew = buildPerson(scene, gpuCrewRoot, {
    x: 0, zc: 0, prefix: "gpuCrew", skin: new Color3(0.62, 0.43, 0.3), shirt: new Color3(0.08, 0.12, 0.22),
    vest: new Color3(0.98, 0.88, 0.05), shorts: new Color3(0.14, 0.15, 0.17), cap: new Color3(0.98, 0.88, 0.05), hair: new Color3(0.1, 0.07, 0.05),
  });
  const gpuCrewSpot = new Vector3(berthB.edgeX - 0.7, berthB.deckY, berthB.z - 3.55);
  // a física enxerga a água + as marolas da esteira (o barco sente a esteira ao cruzá-la)
  const wakeField = new WakeField();
  const physWater = new WaterWithWake(water, wakeField);

  // ---------------- cena ----------------
  const terrain = buildTerrain(scene, { terrainSubdiv: cfg.quality.terrainSubdiv, trees: cfg.quality.trees });
  const riverStrip = terrain.metadata.riverStrip as Mesh; // faixa detalhada do rio/cânion (2 m)
  const trees = buildTrees(scene, cfg.quality.trees);
  const pierMeshes = buildPier(scene, world.pier);
  const buoys = pierMeshes.filter((m) => m.name === "buoy");
  const moorVis = buildMoorings(scene, world.pier);
  const ropes = new Ropes(scene);
  const buoyField = new BuoyField(); // poitas com física (boia + corrente; o casco as afasta)
  const rampMeshes = [...buildRamp(scene), ...buildRoadAndLot(scene, cfg.quality.terrainSubdiv)];
  const stationMeshes = [...buildStation(scene), ...buildFleet(scene)];

  /** Rabetas/motores visuais (a AR-9 tem duas; as outras, uma). */
  const drivesOf = (vis: BoatVisual) => vis.drives ?? [{ engine: vis.engine, propeller: vis.propeller, propBlur: vis.propBlur }];
  // ---------------- as embarcações (as duas ficam prontas; só a escolhida aparece) ----------------
  const makeVessel = (kind: VesselKind): Vessel => {
    const P = VESSELS[kind];
    const S = P.seats;
    const boat = new Speedboat(P, spawnPos(), world.spawn.heading);
    // lancha: volante + manete no console (helm.ts); bote: cana do leme no motor (dinghyMesh.ts)
    const d = kind === "bote" ? buildDinghy(scene) : null;
    // AR-9 (dois V8) e AR-10 (turbina): visuais com piso próprio (`floor`) e o painel deslocado para o piloto
    const rap = kind === "rapida" ? buildRapida(scene) : kind === "turbina" ? buildTurbina(scene) : null;
    const vis: BoatVisual = d ?? rap ?? buildBoat(scene);
    // AR-9: o mesmo painel da AR-6 (volante, manete, chave), num nó deslocado para a frente do banco do piloto
    let helmRoot = vis.root;
    if (rap) {
      helmRoot = new TransformNode("rapHelm", scene); helmRoot.parent = vis.root;
      helmRoot.position.set(S.helm.x - HELM_X, rap.floor - 0.02, S.helm.z + 0.08);
    }
    const helm = d ? d.controls : buildHelm(scene, helmRoot);
    const pilot = d ? buildPilot(scene, vis.root, { x: S.helm.x, zc: S.helm.z, floor: DINGHY_FLOOR })
      : rap ? buildPilot(scene, vis.root, { x: S.helm.x, zc: S.helm.z, floor: rap.floor }) : buildPilot(scene, vis.root);
    const pax: Vessel["pax"] = kind === "turbina" ? {} : rap ? {
      passenger: buildPassenger(scene, vis.root, S.passenger.x, S.passenger.z, "paxA", 0, rap.floor),
    } : d ? {
      passenger: buildPassenger(scene, vis.root, S.passenger.x, S.passenger.z, "paxA", 0, DINGHY_FLOOR),
      rearLeft: buildPassenger(scene, vis.root, S.rearLeft.x, S.rearLeft.z, "paxB", 1, DINGHY_FLOOR),
    } : {
      passenger: buildPassenger(scene, vis.root, -0.5, -0.22, "paxA", 0),
      rearLeft: buildPassenger(scene, vis.root, -0.45, -2.15, "paxB", 1),
      rearRight: buildPassenger(scene, vis.root, 0.45, -2.15, "paxC", 2),
    };
    const gear = new BoatGearVis(scene, vis.root, P, kind);
    vis.meshes.push(...helm.meshes, ...pilot.meshes, ...gear.meshes);
    for (const p of Object.values(pax)) vis.meshes.push(...p.meshes);
    const presets = kind === "turbina" ? [
      { label: "piloto único", seats: ["helm"] as SeatId[] },
    ] : rap ? [
      { label: "só o piloto", seats: ["helm"] as SeatId[] },
      { label: "piloto + navegador", seats: ["helm", "passenger"] as SeatId[] },
    ] : d ? [
      { label: "só o piloto", seats: ["helm"] as SeatId[] },
      { label: "piloto + 1 no meio", seats: ["helm", "passenger"] as SeatId[] },
      { label: "piloto + 1 na popa", seats: ["helm", "rearLeft"] as SeatId[] },
      { label: "lotado (3)", seats: ["helm", "passenger", "rearLeft"] as SeatId[] },
    ] : [
      { label: "só o piloto", seats: ["helm"] as SeatId[] },
      { label: "piloto + carona", seats: ["helm", "passenger"] as SeatId[] },
      { label: "piloto + 2 na popa", seats: ["helm", "rearLeft", "rearRight"] as SeatId[] },
      { label: "lotada (4)", seats: ["helm", "passenger", "rearLeft", "rearRight"] as SeatId[] },
    ];
    // horímetro persistente (por navegador e por barco)
    const hoursKey = kind === "lancha" ? "aquarush.engineHours" : "aquarush.engineHours." + kind;
    try { const h = Number(localStorage.getItem(hoursKey)); boat.systems.engineHours = Number.isFinite(h) && h > 0 ? h : kind === "bote" ? 112.4 : kind === "rapida" ? 8.6 : kind === "turbina" ? 214.0 : 37.2; } catch { boat.systems.engineHours = 37.2; }
    boat.systems.fuelL = START_FUEL[kind];
    vis.root.setEnabled(false);
    // carretinha do tamanho do barco + veículo (bote: carro comum; lancha: caminhonete)
    const trailer = buildTrailer(P);
    const tm = buildTrailerMesh(scene, trailer);
    const tv = buildTowVehicle(scene, trailer);
    tm.root.setEnabled(false); tv.root.setEnabled(false);
    return { kind, gear, P, boat, vis, helm, dinghy: d ? d.controls : null, pilot, pax, presets, skeg: vis.meshes.find((m) => m.name === "skeg")!, hoursKey,
      trailer, trailerNodes: [tm.root, tv.root], trailerMeshes: [...tm.meshes, ...tv.meshes],
      rig: new TowRig(trailer, TOW_SPECS[kind !== "bote" ? "pickup" : "car"], world.groundHeight), trailerRoot: tm.root, carRoot: tv.root,
      carBody: tv.body, carWheels: tv.wheels, trailerWheels: tm.wheels };
  };
  const vessels: Record<VesselKind, Vessel> = { lancha: makeVessel("lancha"), bote: makeVessel("bote"), rapida: makeVessel("rapida"), turbina: makeVessel("turbina") };
  const allVessels = Object.values(vessels);
  const isKind = (k: string | null): k is VesselKind => k === "lancha" || k === "bote" || k === "rapida" || k === "turbina";
  let V = vessels[isKind(urlKind) ? urlKind : "lancha"];
  const allBoatMeshes = allVessels.flatMap((x) => x.vis.meshes).filter((m) => m.name !== "propDisc");
  const staticExtras = [...rampMeshes, ...stationMeshes, ...moorVis.meshes, ...gpuCart.meshes, ...allVessels.flatMap((x) => x.trailerMeshes)];

  // ambiente para os materiais PBR (céu + margens, renderizado uma vez)
  const probe = new ReflectionProbe("envProbe", 128, scene);
  probe.position = new Vector3(0, 6, 0);
  probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  probe.renderList!.push(skybox, terrain, riverStrip, trees);
  scene.environmentTexture = probe.cubeTexture;

  const cam = new BoatCamera(scene, canvas);
  cam.ground = (x, z) => world.groundHeight(x, z);
  scene.activeCamera = cam.cam;

  let depth = null;
  if (cfg.quality.depthEffects) {
    depth = scene.enableDepthRenderer(cam.cam, false, true);
    const list: Mesh[] = [terrain, riverStrip, ...pierMeshes, ...staticExtras, ...allBoatMeshes];
    depth.getDepthMap().renderList = list;
  }

  const fx = new WaterInteraction(scene, wakeField, { particles: cfg.quality.particles, wakeTexture: cfg.quality.wakeTexture });
  const exhaustFx = new TurbineExhaustFx(scene); // fumaça e fogo do escape da turbina (AR-10)
  const waterVis = new WaterVisual(scene, {
    resolution: cfg.quality.waterResolution, innerExtent: 80, outerExtent: 2600, depth, wake: fx.wake, reflectionSize: cfg.quality.reflection,
  });
  waterVis.sunDir = sunDir;
  waterVis.fogDensity = scene.fogDensity;
  const reflList: AbstractMesh[] = [skybox, terrain, riverStrip, trees, ...pierMeshes, ...staticExtras, ...allBoatMeshes];
  waterVis.setReflectionList(reflList);

  if (cfg.quality.shadows > 0) {
    const sg = new ShadowGenerator(cfg.quality.shadows, sun);
    sg.usePercentageCloserFiltering = true;
    sg.bias = 0.002;
    for (const m of allBoatMeshes) { if (m.name !== "windshield") sg.addShadowCaster(m); m.receiveShadows = true; }
    for (const m of pierMeshes) sg.addShadowCaster(m);
    for (const m of staticExtras) { sg.addShadowCaster(m); m.receiveShadows = true; }
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
  const audio = new EngineAudio(V.P.cylinders);
  const startAudio = () => audio.start();
  window.addEventListener("keydown", startAudio);
  window.addEventListener("pointerdown", startAudio);

  const GEAR_MSG = { F: "F — frente engatada (lenta)", N: "N — neutro (sem empuxo)", R: "R — ré engatada (lenta)" } as const;
  input.onGearChange = (g) => hud.showToast(GEAR_MSG[g]);

  let occIdx = 0;
  const applyOccupants = (i: number, toast = true) => {
    occIdx = (i + V.presets.length) % V.presets.length;
    const pr = V.presets[occIdx];
    if (V.boat.capsized) { hud.showToast("Com o barco virado não dá — R para recomeçar"); return; }
    // quem não embarca fica em pé no píer, ao lado da vaga, esperando (ver o laço das pessoas no quadro)
    V.boat.occupants = pr.seats.map((seat) => ({ seat, mass: PERSON_KG }));
    hud.setOccupants(`${pr.seats.length} · ${pr.label}`);
    const waiting = Object.keys(V.pax).length + 1 - pr.seats.length;
    if (toast) hud.showToast(`Embarcaram: ${pr.label} (${pr.seats.length * PERSON_KG} kg a bordo)${waiting ? ` — ${waiting} ${waiting > 1 ? "ficam" : "fica"} no píer` : ""}`);
  };
  document.getElementById("h-occ")!.addEventListener("click", () => input.pushAction("occupants"));

  // vento (T): 5 níveis — no lago só deriva e carneirinhos; as ondas ficam no preset de água (0/G/1/2/3/V)
  const wind = new Wind();
  let waterPreset = 2;
  const applyEnv = () => {
    const p = WATER_PRESETS[waterPreset];
    water.intensity = p.waves;
    waterVis.ripple = p.ripple;
    waterVis.whitecaps = wind.def.whitecaps;
  };
  const applyWater = (i: number, toast = true) => {
    waterPreset = (i + WATER_PRESETS.length) % WATER_PRESETS.length;
    const p = WATER_PRESETS[waterPreset];
    applyEnv();
    hud.setWater(p.key);
    if (toast) hud.showToast(p.label);
  };
  const applyWind = (i: number, toast = true) => {
    wind.setLevel(i);
    applyEnv();
    hud.setWind(wind.def.key);
    if (toast) hud.showToast(`Vento: ${wind.def.label}${wind.def.speed > 0 ? ` — o barco deriva e adorna${wind.def.whitecaps > 0 ? "; carneirinhos na água" : ""}` : ""} · T muda`);
  };
  applyWater(1, false); // sempre começa em "1 — calma"
  applyWind(0, false);  // e sem vento
  document.getElementById("h-water")!.addEventListener("click", () => input.pushAction("waterNext"));
  document.getElementById("h-wind")!.addEventListener("click", () => input.pushAction("wind"));

  // ---------------- estado do laço ----------------
  let acc = 0;
  let paused = false;
  let lights = false;
  let mode: "menu" | "game" = "menu";
  const prevPos = new Vector3(), curPos = new Vector3();
  const prevRot = new Quaternion(), curRot = new Quaternion();
  const snap = (dst: Vector3, q: Quaternion) => { const b = V.boat; dst.set(b.pos.x, b.pos.y, b.pos.z); q.set(b.rot.x, b.rot.y, b.rot.z, b.rot.w); };
  let fpsSmooth = 60, resT = 0;
  let lastStartFail = "", lowFuelWarned = false, trimRelayWarned = false, neutralRevWarned = false, lastJumperOff = 0, lastJumperTrips = 0, lastGpuOff = 0, lastGpuState = "off", lastAnchorState = "recolhida", lastBilgeAlarm = false, lastSwamped = false, lastSunk = false, windHudT = 0;
  const qTilt = new Quaternion(), qSteer = new Quaternion();
  let lastGear = V.boat.telemetry.gear;
  let tiltWarned = false, intakeWarned = false, capsizeWarned = false;
  let lastPin = 0;
  let lastStall = "";
  let hoursSaveT = 0;
  let physMs = 0;
  let simTime = 0;
  let trailerDone = false;
  let lastDamage = 0;
  // amarração (vaga do píer / poitas): amarra sozinho na posição certa; M solta; só rearma longe do ponto
  let moorArmed = true, moorWhere = "";
  // no carro com o barco amarrado (píer/poita): o barco continua na física; o comando vai para o veículo
  let carOnly = false, lastStall2 = -1;
  let hornPulse = 0, reachedEnd = false;
  const enterCar = () => {
    carOnly = true; setPeopleVisible(false);
    if (cam.mode === "cockpit") { cam.toggle(); hud.setCamera(cam.mode); setCockpitHead(false); }
    cam.resetOrbit();
    hud.showToast(`Barco amarrado. Você está ${V.kind !== "bote" ? "na caminhonete" : "no carro"} (carretinha vazia): W/S/A/D · estacione numa vaga do pátio · K volta ao barco`);
  };
  const leaveCar = (toast = true) => { carOnly = false; setPeopleVisible(true); cam.resetOrbit(); if (toast) hud.showToast("De volta ao barco"); };
  let ctxKey = "";
  /** A barra de atalhos ocupa só o espaço à esquerda dos relógios do HUD; com muitos botões ela cresce para cima. */
  const fitCtxBar = () => {
    const g = document.getElementById("gauges")?.getBoundingClientRect();
    if (g && g.width > 0 && innerWidth > 900) ctxBar.style.maxWidth = `${Math.max(240, g.left - 36)}px`;
    else ctxBar.style.maxWidth = "";
  };
  window.addEventListener("resize", fitCtxBar);
  const ctxBar = document.getElementById("ctx-keys")!;
  ctxBar.addEventListener("click", (e) => { const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a; if (a) input.pushAction(a as Action); });
  // ---- dirigindo o veículo de reboque (barco preso na carretinha pela cinta) ----
  let driving = false;
  let manualBoat = false; // o jogador trouxe o comando para o barco com a cinta presa
  let strapT = 0;
  const boatOnTrailer = new Matrix(); // pose do barco no referencial da carretinha (fixa enquanto preso)
  const poseMatrix = (p: Pose) => Matrix.Compose(Vector3.One(), Quaternion.FromEulerAngles(p.pitch, p.yaw, 0), new Vector3(p.x, p.y, p.z));
  const placeRigOf = (X: Vessel) => {
    const c = X.rig.carPose(), t = X.rig.trailerPose();
    X.carRoot.position.set(c.x, c.y, c.z); X.carRoot.rotationQuaternion = Quaternion.FromEulerAngles(c.pitch, c.yaw, c.roll ?? 0); // roll > 0 = lado direito (+X local) mais alto
    // rodas: giram com a velocidade, as da frente esterçam; carroceria inclina com a transferência de carga
    for (const w of X.carWheels) { w.spin.rotation.x = X.rig.wheelSpin; if (w.front) w.steer.rotation.y = X.rig.steer; }
    for (const w of X.trailerWheels) w.spin.rotation.x = X.rig.trailerWheelSpin;
    const k = X.kind !== "bote" ? 0.007 : 0.009;
    X.carBody.rotation.x += (Math.max(-0.05, Math.min(0.05, -X.rig.accLong * k)) - X.carBody.rotation.x) * 0.15;
    X.carBody.rotation.z += (Math.max(-0.06, Math.min(0.06, X.rig.accLat * k * 1.4)) - X.carBody.rotation.z) * 0.15;
    X.trailerRoot.position.set(t.x, t.y, t.z); X.trailerRoot.rotationQuaternion = Quaternion.FromEulerAngles(t.pitch, t.yaw, 0);
    X.trailer.collider.pose = t; // os colisores da carretinha acompanham o veículo
  };
  const placeRig = () => placeRigOf(V);
  /**
   * O OUTRO barco fica estacionado no pátio, na carretinha, engatado no veículo dele (só visual + obstáculo).
   * Pessoas escondidas (estão no bar/loja); motor levantado para o transporte.
   */
  const parkInLot = (X: Vessel, spot = 0) => {
    const pk = STATION.parking[spot];
    X.rig.placeAt(pk.x, pk.z, pk.yaw);
    placeRigOf(X);
    for (const n of X.trailerNodes) n.setEnabled(true);
    X.vis.root.setEnabled(true);
    for (const p of [X.pilot, ...Object.values(X.pax)]) { p.board(X.vis.root); p.group.setEnabled(false); }
    const seat = seatedBoatLocal(X.P, X.trailer, 0);
    const m = Matrix.Compose(Vector3.One(), Quaternion.RotationYawPitchRoll(Math.PI, 0, 0), new Vector3(0, seat.y, seat.z)).multiply(poseMatrix(X.rig.trailerPose()));
    const sc = new Vector3(), q = new Quaternion(), tr = new Vector3();
    m.decompose(sc, q, tr);
    X.vis.root.position.copyFrom(tr); X.vis.root.rotationQuaternion = q;
    for (const dr of drivesOf(X.vis)) { // motor(es) levantado(s)
      dr.engine.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), X.P.tiltMax * 0.85);
      dr.propBlur.alpha = 0;
    }
  };
  /** Obstáculos do veículo ativo: prédios, ilhas, colunas e o conjunto estacionado do outro barco. */
  const setObstacles = () => {
    const pr = world.pier;
    V.rig.obstacles = [...stationObstacles(), ...allVessels.filter((o) => o !== V).flatMap((o) => [o.rig.carObb(), o.rig.trailerObb()]),
      { x: pr.shoreX + 0.6, z: pr.shoreZ - 12.9, hw: 7.2, hl: 6.2, yaw: 0 }, // restaurante + varanda + balcão
      { x: pr.shoreX + 15, z: pr.shoreZ - 15, hw: 6.5, hl: 4.5, yaw: 0 },   // piscina
      { x: pr.shoreX, z: pr.shoreZ - 3, hw: pr.width / 2, hl: 3, yaw: 0 }]; // começo do píer
  };
  /** Atracado (amarrado) na vaga do píer: é onde fica a GPU. */
  const docked = () => moorWhere === "píer" && V.boat.mooringLines.length > 0;
  /** Componente lateral (X local do barco) de um vetor do mundo no plano XZ: > 0 = boreste. */
  const rotInvXZ = (dx: number, dz: number) => { const r = V.boat.right; return dx * r.x + dz * r.z; };
  const setPeopleVisible = (on: boolean) => { for (const p of [V.pilot, ...Object.values(V.pax)]) p.group.setEnabled(on); };
  // ---- abastecimento no posto ----
  let fueling = false, fuelAdded = 0;
  const FUEL_RATE: Record<VesselKind, number> = { lancha: 1.5, bote: 0.4, rapida: 1.5, turbina: 2.0 }; // L/s (bomba de posto ~ 40 L/min; galão portátil mais devagar)
  /** Passa o comando para o veículo: o barco fica preso na carretinha (cinta + bunks) e as pessoas vão para o carro. */
  const startDriving = () => {
    const b = V.boat;
    // (o motor do barco fica como estava: P, E/Q e luzes continuam; acelerador e direção passam ao veículo)
    // o guincho puxa o barco até a proa encostar e ele assenta centralizado no berço (mesmo se entrou
    // flutuando numa carretinha funda): pose fixa no referencial da carretinha durante o reboque
    const seat = seatedBoatLocal(b.params, V.trailer, 0);
    Matrix.ComposeToRef(Vector3.One(), Quaternion.RotationYawPitchRoll(Math.PI, 0, 0), new Vector3(0, seat.y, seat.z), boatOnTrailer);
    driving = true;
    setPeopleVisible(false);
    if (cam.mode === "cockpit") { cam.toggle(); hud.setCamera(cam.mode); setCockpitHead(false); }
    cam.resetOrbit();
    hud.showToast(`Barco preso. Acelerador e direção agora são ${V.kind !== "bote" ? "da caminhonete" : "do carro"} (W/S/A/D); o motor do barco continua no P e no E/Q. U passa o comando ao barco`);
  };
  /** Desengata: solta a cinta; se estiver dirigindo, o comando volta para o barco (a carretinha fica onde está). */
  /** A carretinha está na água o suficiente para o barco sair flutuando (água sobre a traseira do berço)? */
  const trailerInWater = () => trailerLoadState(V.boat, V.trailer).bunkDepth > 0.25;
  /** Comando do carro → barco, com a cinta ainda presa (ex.: ligar o motor do barco no seco). */
  const toBoatKeepStrap = () => {
    const b = V.boat;
    driving = false; manualBoat = true; strapT = 0;
    b.vel = v3(); b.angVel = v3();
    setPeopleVisible(true);
    snap(curPos, curRot); snap(prevPos, prevRot);
    hud.showToast(trailerInWater() ? "Comando no barco (cinta ainda presa). U de novo solta a cinta" : "Comando no barco (cinta presa, no seco). U volta ao carro");
  };
  /**
   * U: no carro → passa o comando ao barco (cinta presa). No barco preso: com a carretinha na água solta a
   * cinta; no seco só volta o comando ao carro.
   */
  const uKey = () => {
    if (carOnly) { leaveCar(); return; }
    if (driving) { toBoatKeepStrap(); return; }
    if (V.boat.winchStrap) { if (trailerInWater()) unhitch(); else { manualBoat = false; startDriving(); } return; }
    hud.showToast("O barco não está preso na carretinha");
  };
  const unhitch = () => {
    const b = V.boat;
    if (!b.winchStrap && !driving) { hud.showToast("O barco não está preso na carretinha"); return; }
    manualBoat = false;
    b.winchStrap = null;
    trailerDone = true; // não prende de novo até o barco sair do berço
    strapT = 0;
    if (driving) {
      driving = false;
      b.vel = v3(); b.angVel = v3();
      setPeopleVisible(true);
      snap(curPos, curRot); snap(prevPos, prevRot);
    }
    hud.showToast("Cinta solta: barco desengatado. Na água, dê ré com o motor (baixe o motor antes: E/Q) para sair da carretinha");
  };
  const stopDriving = () => {
    driving = false; strapT = 0;
    V.rig.reset(); placeRig();
    setPeopleVisible(true);
  };
  const trailerChip = document.getElementById("h-trailer")!;

  document.getElementById("h-build")!.textContent = `${BUILD} · ${engine.isWebGPU ? "WebGPU" : "WebGL" + (engine as Engine).webGLVersion} · q=${cfg.quality.name}`;

  const setCockpitHead = (hidden: boolean) => {
    // no cockpit a câmera fica na cabeça do piloto: esconde cabeça/tronco (mãos e pernas continuam visíveis)
    for (const m of V.vis.meshes) if (/^pilot(Head|Jaw|Nose|Ear|Hair|Cap|Glasses|Neck)/.test(m.name)) m.setEnabled(!hidden);
  };

  /** Ativa uma embarcação (mostra, configura HUD/câmera/som/ajuda) e a põe no píer. */
  const activate = (kind: VesselKind) => {
    if (V.kind !== kind) {
      try { localStorage.setItem(V.hoursKey, String(V.boat.systems.engineHours)); } catch { /* sem storage */ }
      for (const p of [V.pilot, ...Object.values(V.pax)]) p.board(V.vis.root);
    }
    V = vessels[kind];
    allVessels.filter((o) => o !== V).forEach((o, i) => parkInLot(o, i)); // os outros conjuntos ficam no pátio do posto
    V.vis.root.setEnabled(true);
    // carretinha deste barco na rampa (visual + colisores do berço, postes-guia e batente)
    for (const n of V.trailerNodes) n.setEnabled(true);
    world.trailers = [V.trailer.collider];
    trailerDone = false;
    if (driving) { for (const p of allVessels) for (const q of [p.pilot, ...Object.values(p.pax)]) q.group.setEnabled(true); }
    driving = false; strapT = 0; V.rig.reset(); placeRig(); setObstacles();
    fueling = false;
    for (const p of [V.pilot, ...Object.values(V.pax)]) p.group.setEnabled(true);
    const isBote = kind === "bote";
    hud.anchorRodeMax = V.P.anchor.rodeMax;
    const twin = V.boat.units.length > 1;
    const turbine = !!V.P.turbine;
    hud.configure(isBote ? { speedMax: 60, temp: true, battery: false, trimPins: V.P.trimPins.length, gear: "dial" }
      : turbine ? { speedMax: 180, temp: true, battery: true, trimPins: 0, gear: "bar", turbine }
      : { speedMax: twin ? 140 : 100, temp: true, battery: true, trimPins: 0, gear: "bar", twin });
    document.getElementById("help-twin")!.style.display = twin ? "" : "none";
    document.getElementById("help-trim")!.innerHTML = isBote
      ? "<kbd>E</kbd><kbd>Q</kbd> trim manual (pinos 1–3, depois tilt)"
      : "<kbd>E</kbd><kbd>Q</kbd> trim + / −";
    document.getElementById("help-occ")!.innerHTML = turbine ? "piloto único (habitáculo fechado)" : "<kbd>O</kbd> embarque (só na vaga do píer)";
    document.getElementById("help-ign")!.innerHTML = isBote ? "<kbd>P</kbd> corda (em N) · <kbd>Y</kbd> sistemas (afogador)"
      : turbine ? "<kbd>P</kbd> partida FADEC / corte · <kbd>Y</kbd> painel de partida (manual) · <kbd>J</kbd> GPU (na doca)"
      : "<kbd>P</kbd> liga/desliga (em N) · <kbd>N</kbd>+<kbd>W</kbd> neutro · <kbd>J</kbd> jump start · <kbd>Y</kbd> sistemas";
    document.getElementById("help-lights")!.innerHTML = isBote ? "<kbd>L</kbd> lanterna" : "<kbd>L</kbd> luzes";
    document.getElementById("help-reset")!.textContent = `píer (${START_FUEL[kind]} L)`;
    document.getElementById("h-charge")!.style.display = isBote ? "none" : "";
    const rapFloor = (V.vis as BoatVisual & { floor?: number }).floor ?? 0.02;
    cam.headLocal = isBote ? new Vector3(V.P.seats.helm.x, DINGHY_FLOOR + 1.22, V.P.seats.helm.z + 0.02)
      : kind === "rapida" || turbine ? new Vector3(V.P.seats.helm.x, rapFloor + (turbine ? 1.12 : 1.22), V.P.seats.helm.z + 0.02) : new Vector3(0.5, 1.24, -0.06);
    cam.distScale = isBote ? 0.62 : kind === "rapida" ? 1.3 : turbine ? 1.45 : 1;
    if (cam.mode === "cockpit") { cam.toggle(); hud.setCamera(cam.mode); }
    setCockpitHead(false);
    audio.cylinders = V.P.cylinders;
    tpanel.setOpen(false); spanel.setOpen(false);
    spanel.configure({ title: V.P.name, banks: !V.P.electricStart ? 0 : V.boat.systems2 ? 2 : 1,
      keys: !V.P.electricStart || V.P.turbine ? [] : V.boat.units.length > 1 ? ["IGNIÇÃO BB", "IGNIÇÃO BE"] : ["IGNIÇÃO"],
      levers: isBote ? "tiller" : V.boat.units.length > 1 ? "twin" : "binnacle", display: isBote ? "grey" : V.boat.units.length > 1 ? "vfd" : "lcd", choke: !!V.P.carbureted, bilgePump: V.P.bilge.pumpLph > 0, lights: isBote ? "LANTERNA" : "LUZES" });
    lights = false; input.setLights(false);
    setNavLights(V.vis, false); V.dinghy?.setLantern(false);
    hud.setLights(false, isBote ? "LANTERNA" : "LUZES");
    resetBoat(false);
  };

  /** Reposiciona no píer: barco de pé, ocupantes a bordo, combustível inicial. */
  const resetBoat = (toast = true) => {
    const b = V.boat;
    if (driving) stopDriving();
    strapT = 0; moorArmed = true; moorWhere = ""; buoyField.reset(); manualBoat = false;
    if (carOnly) leaveCar(false);
    input.setGear("N"); wakeField.reset();
    // largada amarrada na vaga do píer: é onde os passageiros esperam para embarcar
    const bs = berthStartPose(world.pier, V.P);
    b.reset(v3(bs.pos.x, bs.pos.y, bs.pos.z), bs.heading);
    tieToPier(b, world.pier, bs.side); moorWhere = "píer";
    b.repair();
    b.systems.jumper = false; b.systems.jumpCharge = 1; lastJumperOff = b.systems.jumperAutoOff; lastJumperTrips = b.systems.jumperTrips;
    b.systems.gpu = false; lastGpuOff = b.systems.gpuAutoOff;
    for (const bk of b.banks) if (bk.p.hasBattery) bk.batterySoc = START_BATTERY; // bateria(s) a 60 %
    b.engine = "off"; // começa desligado: dê a partida (P)
    for (const x of b.units) { x.key = "off"; x.manualCrank = false; x.testT = 0; }
    b.batterySel = b.params.turbine ? "both" : "ind"; b.bilgeMode = "auto"; b.choke = false; b.systems.fuelValveOpen = true;
    if (b.params.carbureted) b.systems.coolantC = 24; // bote carburado: motor frio, pede o afogador
    b.coldEngines(); // (turbina parada e fria, N1 = 0)
    b.systems.fuelL = START_FUEL[V.kind];
    for (const bk of b.banks) bk.coolantC = Math.min(bk.coolantC, 60);
    for (const p of [V.pilot, ...Object.values(V.pax)]) p.board(V.vis.root);
    if (V.dinghy) V.dinghy.pilotAboard = true;
    applyOccupants(occIdx, false);
    capsizeWarned = false; lastPin = 0; lastStall = "";
    snap(curPos, curRot); snap(prevPos, prevRot);
    if (toast) hud.showToast(`Reposicionado no píer — ${START_FUEL[V.kind]} L no tanque`);
  };

  // ---------------- painel de partida da turbina (Y) ----------------
  const tpanel = new TurbinePanel({
    setFadec: (on) => {
      const tb = V.boat.units[0].turb; if (!tb) return;
      tb.setFadec(on);
      hud.showToast(on ? "FADEC: a partida é automática (P ou PARTIDA no painel)" : "MANUAL: você aciona cada chave — ninguém protege a turbina (vigie a EGT)");
    },
    setSwitch: (sw, on) => {
      const tb = V.boat.units[0].turb; if (!tb) return;
      if (sw === "extPwr") {
        if (tb.fadec) { hud.showToast("No FADEC o EXT PWR é automático: fecha com a GPU estável e abre na marcha lenta"); return; }
        if (on && !V.boat.systems.gpuOnline) hud.showToast(V.boat.systems.gpu ? "EXT PWR fechado: a GPU entra no barramento quando estabilizar" : "EXT PWR: o cabo da GPU não está conectado (J, na doca)");
        V.boat.systems.extPwr = on && V.boat.systems.gpu;
        return;
      }
      tb.setSwitch(sw, on);
      if (sw === "master") hud.showToast(on ? "Chave geral BAT ligada: bateria de 24 V no barramento" : "Chave geral BAT desligada: a bateria saiu do barramento");
    },
    fadecStart: () => { const tb = V.boat.units[0].turb; if (tb && !tb.running && !tb.starting) input.pushAction("ignition"); },
    fadecCut: () => { const tb = V.boat.units[0].turb; if (tb && (tb.running || tb.starting)) input.pushAction("ignition"); },
    gpu: () => input.pushAction("jump"),
    setFuelTank: (open) => setFuelValve(open),
    setBattery: (sel) => {
      V.boat.batterySel = sel;
      hud.showToast(sel === "off" ? "Baterias em OFF: barramento isolado (nem as baterias nem a GPU chegam a ele)"
        : sel === "bus" ? "Baterias em BUS: baterias fora — o barramento fica só com a GPU (EXT PWR) ou o gerador"
        : "Baterias em BOTH: as duas de 12 V em série = 24 V no barramento");
    },
    setLever: (cmd) => input.setPanelLever(0, cmd, 1),
    setBilge: (mode) => setBilgeMode(mode),
    close: () => tpanel.setOpen(false),
  });
  // ---------------- painel de sistemas (Y nos barcos a pistão) ----------------
  const setFuelValve = (open: boolean) => {
    V.boat.systems.fuelValveOpen = open;
    hud.showToast(open ? "Registro do tanque ABERTO" : "Registro do tanque FECHADO — o motor roda até acabar o combustível da linha");
  };
  const setBilgeMode = (mode: "off" | "auto" | "on") => {
    V.boat.bilgeMode = mode;
    hud.showToast(mode === "auto" ? "Bomba de porão em AUTO (boia)" : mode === "on" ? "Bomba de porão LIGADA (manual)" : "Bomba de porão DESLIGADA — a água no porão não sai");
  };
  const spanel = new SystemsPanel({
    setBattery: (sel) => {
      V.boat.batterySel = sel;
      const txt: Record<string, string> = { off: "Chave de baterias em OFF", ind: V.boat.systems2 ? "Baterias em IND.: cada motor no seu banco" : "Bateria LIGADA",
        bb: "Baterias em BB: o banco de bombordo alimenta os dois motores e a casa", be: "Baterias em BE: o banco de boreste alimenta os dois motores e a casa", both: "Baterias em AMBAS: bancos em paralelo" };
      hud.showToast(txt[sel]);
    },
    setFuelValve,
    setChoke: (on) => { V.boat.choke = on; hud.showToast(on ? "Afogador PUXADO (partida a frio)" : "Afogador EMPURRADO"); },
    setBilge: setBilgeMode,
    toggleLights: () => input.pushAction("lights"),
    setKey: (i, pos) => {
      const b = V.boat, before = b.units[i]?.key;
      const r = b.setKey(i, pos);
      const name = b.units.length > 1 ? (i === 0 ? " de bombordo" : " de boreste") : "";
      if (r === "needNeutral") hud.showToast("Coloque em N para dar partida");
      else if (r === "noPilot") hud.showToast("Ninguém no comando — o piloto está na água");
      else if (r === "broken") hud.showToast("Motor avariado: não liga — R leva à oficina do píer");
      else if (pos === "off" && before !== "off") hud.showToast(`Chave${name} em OFF: ignição desligada`);
      else if (pos === "on" && before === "off") hud.showToast(b.units[i].testT > 0 ? `Chave${name} em ON — autoteste… segure START para dar partida` : `Chave${name} em ON — sem tensão: nem o autoteste apita`);
    },
    setLever: (i, cmd) => input.setPanelLever(i, cmd, V.boat.units.length),
    pullStart: () => { if (V.boat.engine !== "running") input.pushAction("ignition"); },
    stopEngine: () => { if (V.boat.engine === "running") input.pushAction("ignition"); },
    close: () => spanel.setOpen(false),
  });

  // ---------------- menu: escolha do barco com prévia no lago ----------------
  const menu = document.getElementById("menu")!;
  const cards = [...menu.querySelectorAll<HTMLButtonElement>(".pick-b")];
  const showMenu = () => {
    mode = "menu";
    paused = false;
    document.body.classList.add("menu-mode");
    menu.classList.remove("hidden");
    for (const c of cards) c.classList.toggle("sel", c.dataset.kind === V.kind);
    resetBoat(false);
  };
  const startGame = () => {
    mode = "game";
    document.body.classList.remove("menu-mode");
    menu.classList.add("hidden");
    occIdx = 0;
    resetBoat(false);
    cam.resetOrbit();
    hud.showToast(`${V.kind === "bote" ? "Bote de apoio AR-3" : V.kind === "rapida" ? "Lancha rápida AR-9" : V.kind === "turbina" ? "Lancha de turbina AR-10" : "Lancha AR-6"} atracado na vaga do píer — O escolhe quantos embarcam, M solta as amarras. O combustível não dá até o fim do cânion: abasteça no posto`);
  };
  // ---------------- splash: marca, idioma, embarcações e esportes (sobre a cena do lago) ----------------
  const splash = document.getElementById("splash")!;
  const showSplash = () => {
    mode = "menu";
    document.body.classList.add("menu-mode");
    menu.classList.add("hidden");
    splash.classList.remove("hidden");
    resetBoat(false);
  };
  const leaveSplash = () => { splash.classList.add("hidden"); showMenu(); };
  document.getElementById("splash-play")!.addEventListener("click", leaveSplash);
  document.getElementById("splash-ver")!.textContent = BUILD;
  // idioma: só português por enquanto (o inglês aparece com o selo SOON e não faz nada ainda)
  try { localStorage.setItem("aquarush.lang", "pt-BR"); } catch { /* sem storage */ }
  for (const b of splash.querySelectorAll<HTMLButtonElement>(".sp-lang button")) b.addEventListener("click", () => {
    if (b.classList.contains("soon")) { b.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 260 }); return; }
  });
  for (const c of cards) c.addEventListener("click", () => {
    const k = c.dataset.kind as VesselKind;
    if (k !== V.kind) activate(k);
    for (const o of cards) o.classList.toggle("sel", o === c);
  });
  document.getElementById("menu-play")!.addEventListener("click", startGame);
  document.getElementById("h-vessel")!.addEventListener("click", showMenu);

  const handle = (a: Action) => {
    if (mode === "menu") return; // no menu os atalhos do jogo ficam desligados
    const boat = V.boat;
    if (a === "horn") { hornPulse = 0.22; return; } // toque curto (2 toques = 2 cliques/apertos)
    if (a === "unhitch") { uKey(); return; } // U: carro → barco; barco preso: solta a cinta (na água) ou volta ao carro (no seco)
    if (a === "couple") {
      if (!driving && !carOnly) { hud.showToast("I acopla/desacopla a carretinha quando você está no carro"); return; }
      const r = V.rig.toggleCoupling();
      if (r === "uncoupled") hud.showToast("Carretinha desacoplada (apoiada no macaquinho). Para acoplar: encoste a bola do engate de ré e aperte I");
      else if (r === "coupled") hud.showToast("Carretinha acoplada ✓");
      else if (r === "moving") hud.showToast("Pare o carro para acoplar");
      else if (r === "align") hud.showToast("Alinhe o carro com a carretinha para acoplar");
      else hud.showToast(`Encoste mais: a bola do engate está a ${r.far.toFixed(1)} m do acoplador`);
      return;
    }
    if (a === "moor") {
      if (carOnly) { hud.showToast("Você está no carro — K volta ao barco"); return; }
      if (boat.mooringLines.length) { boat.mooringLines = []; buoyField.release(); moorArmed = false; hud.showToast("Amarras soltas — afaste o barco"); moorWhere = ""; }
      else hud.showToast("Para amarrar: entre devagar na vaga do píer (faixa amarela) ou encoste a proa numa poita (P1–P3)");
      return;
    }
    if (a === "fuel") {
      if (!driving) { hud.showToast("Para abastecer: leve o barco na carretinha até o posto e pare o carro ao lado da bomba"); return; }
      if (fueling) { fueling = false; hud.showToast(`Abastecimento interrompido: +${fuelAdded.toFixed(1)} L`); return; }
      const bay = fuelBayState(V.rig.carPose(), Math.abs(V.rig.v));
      if (!bay.near) { hud.showToast("Nenhuma bomba aqui — o posto fica no fim da estrada"); return; }
      if (!bay.ok) { hud.showToast(`Bomba: ${bay.why}`); return; }
      if (boat.engine !== "off") { hud.showToast("Desligue o motor do barco (P) para abastecer"); return; }
      if (boat.systems.fuelL >= boat.systems.p.tankLiters - 0.05) { hud.showToast("O tanque já está cheio"); return; }
      fueling = true; fuelAdded = 0;
      hud.showToast("Abastecendo…");
      return;
    }
    if (a === "occupants" && !(boat.mooringLines.length && moorWhere === "píer")) {
      hud.showToast(driving ? "Com o barco na carretinha não dá para trocar a lotação" : "Embarque e desembarque só no píer: atraque na vaga (as pessoas esperam lá) e aperte O");
      return;
    }
    if (a === "car") {
      if (carOnly) leaveCar();
      else if (driving) hud.showToast("Você já está no veículo");
      else if (boat.mooringLines.length) enterCar();
      else hud.showToast("Para ir ao carro, amarre o barco: vaga do píer ou numa poita");
      return;
    }
    if (carOnly && (a === "ignition" || a === "lights" || a === "occupants" || a === "camera")) { hud.showToast("Você está no carro — K volta ao barco"); return; }
    if (driving && a === "camera") return;
    if (a === "camera") {
      if (V.pilot.group.parent !== V.vis.root) { hud.showToast("O piloto está na água"); return; }
      const m = cam.toggle();
      hud.setCamera(m);
      setCockpitHead(m === "cockpit");
    }
    else if (a === "lights") {
      lights = input.toggleLights();
      setNavLights(V.vis, lights, boat.telemetry.houseV * 12 / boat.telemetry.nominalV); V.dinghy?.setLantern(lights);
      hud.setLights(lights, V.dinghy ? "LANTERNA" : "LUZES");
    }
    else if (a === "reset") resetBoat();
    else if (a === "wind") applyWind(wind.level + 1);
    else if (a === "occupants") applyOccupants(occIdx + 1);
    else if (a === "jump" && boat.params.turbine) {
      // AR-10: sem jump start — a partida externa é a GPU da doca (28 V), só com o barco atracado na vaga do píer
      const sys = boat.systems;
      if (!sys.gpu && !docked()) { hud.showToast("A GPU fica na doca: atraque na vaga do píer (amarrado) para conectar o cabo"); return; }
      sys.gpu = !sys.gpu;
      hud.showToast(sys.gpu ? `Cabo da GPU conectado: o diesel da GPU está partindo — a luz pisca até ele estabilizar (depois o EXT PWR põe os ${GPU_V} V no barramento)`
        : "Cabo da GPU retirado e recolhido no carretel — o diesel roda mais alguns segundos sem carga e desliga");
    }
    else if (a === "jump") {
      const sys = boat.systems;
      if (!sys.p.hasBattery) { hud.showToast("O bote não tem bateria — a partida é na corda (P)"); return; }
      sys.jumper = !sys.jumper;
      hud.showToast(!sys.jumper ? `Jump start desconectado (${sys.jumpAh.toFixed(1)} Ah)`
        : sys.jumpCharge <= 0.005 ? "Jump start conectado, mas está descarregado (0 Ah) — ele recarrega com o motor em cruzeiro"
        : `Jump start conectado: ${sys.jumpAh.toFixed(1)} de ${JUMP_AH} Ah, até ${JUMP_MAX_A} A (~${sys.jumpStartsLeft} partidas) — alimenta partida, âncora, trim e luzes; ao pegar o motor ele é desconectado`);
    }
    else if (a === "turbinePanel") {
      // AR-10: painel de partida da turbina (com os sistemas); os outros barcos: painel de sistemas
      if (boat.params.turbine) tpanel.setOpen(!tpanel.isOpen);
      else spanel.setOpen(!spanel.isOpen);
    }
    else if (a === "debug") hud.toggleDebug();
    else if (a === "help") hud.toggleHelp();
    else if (a === "ignition") {
      if (boat.capsized) { hud.showToast("Barco virado — R para recomeçar"); return; }
      const r = boat.toggleIgnition();
      if (r === "noPilot") { hud.showToast("Ninguém no comando — o piloto está na água"); return; }
      if (r === "broken") { hud.showToast("Motor avariado: não liga — R leva à oficina do píer"); return; }
      if (r === "pulling") audio.ropePull();
      if (r === "manual") { hud.showToast("Partida MANUAL: use as chaves do painel de partida (Y) — ou volte ao FADEC nele"); tpanel.setOpen(true); return; }
      if (boat.params.turbine) {
        const tb = boat.telemetry.turbine;
        const tm: Record<string, string> = { stopped: tb && tb.phase === "running" ? "Combustível cortado" : "Partida abortada", starting: "Partida da turbina: arranque girando o gerador de gás…",
          busy: `Turbina ainda girando (N1 ${tb ? tb.n1.toFixed(0) : 0} %) — espere passar de 8 % para nova partida`, needNeutral: "Coloque em N para dar partida", lowBattery: "Bateria descarregada: o arranque não gira — atraque na doca e conecte a GPU (J)",
          noPower: "Sem energia no barramento: chave BAT ligada e baterias em BOTH (ou BUS com a GPU da doca, J) — painel Y" };
        if (tm[r]) { hud.showToast(tm[r]); return; }
      }
      const msg: Record<string, string> = { stopped: "Motor desligado", pulling: "Puxando a corda…", starting: "Chave ligada — autoteste…", busy: "Dando partida…", needNeutral: "Coloque em N para dar partida", noFuel: "Sem combustível — R para voltar ao píer e abastecer", lowBattery: "Bateria descarregada: nem o relé de partida arma — J conecta o jump start", hot: "Motor quente demais — espere esfriar" };
      hud.showToast(msg[r]);
    }
    else if (a === "pause") { paused = !paused; hud.showToast(paused ? "Pausado" : "Continuando"); }
    else if (a === "waterNext") applyWater(waterPreset + 1);
    else if (a.startsWith("water")) applyWater(Number(a.slice(5)));
  };

  // ---------------- laço: física em passo fixo + render interpolado ----------------
  const idleInput = emptyInput();
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
    const boat = V.boat, vis = V.vis, P = V.P;
    const isBote = V.kind === "bote";

    const vin = mode === "game" && !driving && !carOnly ? input.update(dtReal) : idleInput;
    if (boat.units.length < 2) vin.engineCmd = undefined; // Z/X (empuxo diferencial) só nos barcos de dois motores
    const carCmd = carOnly ? input.drive(dtReal) : null;
    if (!paused && driving) {
      // dirigindo: o veículo puxa a carretinha; o barco vai preso nela (pose fixa no referencial da carretinha)
      acc += dtReal;
      const cmd = input.drive(dtReal);
      while (acc >= PHYSICS_DT) {
        prevPos.copyFrom(curPos); prevRot.copyFrom(curRot);
        water.time += PHYSICS_DT; simTime += PHYSICS_DT;
        V.rig.update(PHYSICS_DT, cmd);
        boat.carriedStep(PHYSICS_DT, cmd.trim, physWater, world);
        const mb = boatOnTrailer.multiply(poseMatrix(V.rig.trailerPose()));
        const sc = new Vector3(), q = new Quaternion(), tr = new Vector3();
        mb.decompose(sc, q, tr);
        const vx = (tr.x - boat.pos.x) / PHYSICS_DT, vz = (tr.z - boat.pos.z) / PHYSICS_DT;
        boat.pos = v3(tr.x, tr.y, tr.z); boat.rot = { x: q.x, y: q.y, z: q.z, w: q.w }; boat.vel = v3(vx, 0, vz); boat.angVel = v3();
        // rebocando: pé do motor arrastando no chão ou barco batendo no veículo → avaria
        boat.carriedDamage(PHYSICS_DT, world, (p) => V.rig.insideCar(p));
        snap(curPos, curRot);
        acc -= PHYSICS_DT;
      }
      placeRig();
      // a cinta do guincho anda com a carretinha (âncora no guincho)
      if (boat.winchStrap) boat.winchStrap.anchor = fromFrame(V.trailer.collider.pose, V.trailer.winchLocal);
    } else if (!paused) {
      const tp = performance.now();
      acc += dtReal;
      let n = 0;
      while (acc >= PHYSICS_DT && n < MAX_SUBSTEPS) {
        prevPos.copyFrom(curPos); prevRot.copyFrom(curRot);
        water.time += PHYSICS_DT;
        simTime += PHYSICS_DT;
        wind.update(PHYSICS_DT); world.wind = wind.v;
        if (wind.speed > 0.1) waterVis.windDir.set(wind.v.x / wind.speed, wind.v.z / wind.speed);
        boat.step(PHYSICS_DT, vin, physWater, world);
        buoyField.step(PHYSICS_DT, boat);
        if (carCmd) V.rig.update(PHYSICS_DT, carCmd);
        wakeField.update(PHYSICS_DT, boat);
        snap(curPos, curRot);
        acc -= PHYSICS_DT;
        n++;
      }
      if (n === MAX_SUBSTEPS) acc = 0;
      if (carOnly) placeRig();
      boat.obstacleDamage((p) => V.rig.insideCar(p)); // barco batendo no carro/caminhonete estacionado
      physMs += (performance.now() - tp - physMs) * 0.05;
    }
    const alpha = paused ? 1 : acc / PHYSICS_DT;
    const rPos = Vector3.Lerp(prevPos, curPos, alpha);
    const rRot = Quaternion.Slerp(prevRot, curRot, alpha);

    // barco visual = estado físico interpolado
    vis.root.position.copyFrom(rPos);
    vis.root.rotationQuaternion = rRot;
    const T = boat.telemetry;
    // tilt/trim por fora (tubo no espelho), direção por dentro (eixo do motor) — mesma ordem da física.
    // (rotation.x/y da Babylon aplica o yaw por fora: com o motor recolhido ele varria o pé para os lados)
    Quaternion.RotationAxisToRef(Vector3.Right(), (T.trimDeg + T.tiltDeg) * Math.PI / 180, qTilt);
    Quaternion.RotationAxisToRef(Vector3.Up(), -T.steerDeg * Math.PI / 180, qSteer);
    for (const dr of drivesOf(vis)) dr.engine.rotationQuaternion = qTilt.multiply(qSteer); // as rabetas giram juntas (barra de ligação)
    V.helm.update(dtReal, T, input.state, P.maxSteerLow * 180 / Math.PI);

    // pessoas: sentadas nos bancos, em pé na água com o colete (barco virado) ou em pé no píer esperando
    const persons: [SeatId, Pilot][] = [["helm", V.pilot], ...(Object.entries(V.pax) as [SeatId, Pilot][])];
    let spot = 0;
    for (const [seat, person] of persons) {
      const sw = boat.swimmers.find((s) => s.seat === seat);
      if (sw) person.float(new Vector3(sw.pos.x, sw.pos.y, sw.pos.z), sw.yaw, simTime + (seat.length * 0.7), sw.swim);
      else if (boat.occupants.some((o) => o.seat === seat)) { if (person.group.parent !== vis.root) person.board(vis.root); }
      else if (!boat.capsized) { const w = waitSpots[spot++ % waitSpots.length]; person.stand(new Vector3(w.x, w.y, w.z), w.yaw, simTime + spot * 1.7); }
    }
    const pilotAboard = !boat.swimmers.some((s) => s.seat === "helm");
    if (V.dinghy) V.dinghy.pilotAboard = pilotAboard;
    if (pilotAboard) V.pilot.update(toRootLocal(V.helm.wheelGrip, vis.root), toRootLocal(V.helm.leverGrip, vis.root));
    else if (cam.mode === "cockpit") { cam.toggle(); hud.setCamera(cam.mode); setCockpitHead(false); }
    if (T.capsized && !capsizeWarned && mode === "game") {
      hud.showToast(V.P.enclosedCockpit ? "O barco virou! A turbina apagou; o piloto está preso no cinto, dentro do habitáculo fechado (célula de segurança com ar) — R para recomeçar"
        : "O barco virou! O corta-circuito desligou o motor e todos caíram na água (de colete) — R para recomeçar");
      capsizeWarned = true;
      audio.siren(2); // o alarme da bomba para; duas sirenes de emergência e silêncio
    }

    // manobra da carretinha: guia de alinhamento perto dela; aviso quando o barco está carregado
    const ld = trailerLoadState(boat, V.trailer);
    trailerChip.classList.toggle("show", mode === "game" && (ld.near || ld.loaded || !!boat.winchStrap));
    trailerChip.classList.toggle("ok", ld.loaded || (!!boat.winchStrap && ld.onBunks));
    if (ld.loaded || (boat.winchStrap && ld.onBunks)) trailerChip.textContent = boat.winchStrap ? "NA CARRETINHA ✓ · cinta presa" : "NA CARRETINHA · cinta solta — dê ré com o motor para sair";
    else if (ld.near) {
      const side = Math.abs(ld.lateral) < 0.15 ? "centro" : `${Math.abs(ld.lateral).toFixed(1)} m ${ld.lateral > 0 ? "→ vá p/ direita" : "→ vá p/ esquerda"}`;
      const motorDown = T.tiltDeg < 3 && T.trimDeg < (V.kind !== "bote" ? 9 : 3.5);
      trailerChip.textContent = `CARRETINHA · ${side} · ${Math.abs(ld.angleDeg).toFixed(0)}° · falta ${Math.max(0, ld.bowGap).toFixed(1)} m${motorDown && ld.bowGap < 12 ? " · LEVANTE O MOTOR (E)" : ""}`;
    }
    if (ld.loaded && !trailerDone && mode === "game") {
      trailerDone = true;
      attachWinch(boat, V.trailer);
      hud.showToast(`Barco na carretinha! Desvio ${(Math.abs(ld.lateral) * 100).toFixed(0)} cm, ${Math.abs(ld.angleDeg).toFixed(1)}° — cinta do guincho presa. Pode desligar o motor (P)`);
    }
    // só libera um novo engate depois que o barco SAIR de cima da carretinha (flutuando sobre ela ainda conta)
    if (!ld.overBunks && !boat.winchStrap) trailerDone = false;
    // cinta presa por ~1,5 s com o barco no berço → o comando passa para o veículo
    // (automático só na 1ª vez que a cinta prende; depois de U para o barco, o comando fica no barco)
    if (!driving && !manualBoat && mode === "game" && boat.winchStrap && ld.overBunks) { strapT += dtReal; if (strapT > 1.5) startDriving(); } else if (!driving) strapT = 0;
    // posto: guia para parar ao lado da bomba e abastecimento (só com o carro parado e o motor do barco desligado)
    const bay = driving ? fuelBayState(V.rig.carPose(), Math.abs(V.rig.v)) : { near: false, ok: false, pump: null, why: "" };
    if (fueling) {
      const sysF = boat.systems, room = sysF.p.tankLiters - sysF.fuelL;
      if (!bay.ok || boat.engine !== "off" || !driving) { fueling = false; hud.showToast(`Abastecimento interrompido: +${fuelAdded.toFixed(1)} L`); }
      else if (room <= 0.01) { fueling = false; hud.showToast(`Tanque cheio! +${fuelAdded.toFixed(1)} L — ${sysF.fuelL.toFixed(0)} L no tanque`); }
      else { const d = Math.min(room, FUEL_RATE[V.kind] * dtReal); sysF.fuelL += d; fuelAdded += d; T.fuelL = sysF.fuelL; T.fuelFrac = sysF.fuelFrac; }
    }
    // amarração: na posição certa o barco é amarrado sozinho (vaga do píer: proa e popa; poita: proa)
    if (mode === "game" && !driving && !boat.winchStrap && !boat.capsized) {
      const berth = pierBerthState(boat, world.pier), bst = buoyField.nearest(boat);
      if (!boat.mooringLines.length && moorArmed) {
        if (berth.ok) { tieToPier(boat, world.pier, berth.side); moorWhere = "píer"; hud.showToast("Atracado na vaga do píer: cabos de proa e popa amarrados (M solta)"); }
        else if (bst.ok && bst.buoy) { buoyField.tie(boat, bst.buoy.id); moorWhere = "poita " + bst.buoy.id; hud.showToast(`Amarrado na poita ${bst.buoy.id} pela proa (M solta)`); }
      }
      if (!moorArmed && !boat.mooringLines.length && !berth.near && bst.dist > 6) moorArmed = true;
      if (!(ld.near || ld.loaded || boat.winchStrap)) {
        const moored = boat.mooringLines.length > 0;
        const showB = !moored && moorArmed && berth.near, showP = !moored && moorArmed && bst.dist < 12;
        trailerChip.classList.toggle("show", moored || showB || showP);
        trailerChip.classList.toggle("ok", moored);
        if (moored) trailerChip.textContent = moorWhere === "píer" ? "ATRACADO NA VAGA ✓ · M solta as amarras" : `AMARRADO NA ${moorWhere.toUpperCase()} ✓ · M solta`;
        else if (showB) trailerChip.textContent = `VAGA DO PÍER · ${berth.why || "ok"}`;
        else if (showP && bst.buoy) trailerChip.textContent = `POITA ${bst.buoy.id} · encoste a proa devagar (${bst.dist.toFixed(1)} m)`;
      }
    }
    if (carOnly) {
      // no carro com a carretinha vazia: velocidade e vaga
      const stall = parkedStall(V.rig.carObb(), V.rig.trailerObb(), Math.abs(V.rig.v));
      trailerChip.classList.add("show"); trailerChip.classList.toggle("ok", stall >= 0);
      trailerChip.textContent = !V.rig.coupled ? `CARRETINHA SOLTA · bola a ${V.rig.couplerGap.toFixed(1)} m do acoplador — encoste de ré e aperte I` : stall >= 0 ? `ESTACIONADO NA VAGA ${stall} ✓ · K volta ao barco`
        : `${V.kind !== "bote" ? "CAMINHONETE" : "CARRO"} (carretinha vazia) · ${(Math.abs(V.rig.v) * 3.6).toFixed(0)} km/h${V.rig.v < -0.05 ? " (ré)" : ""}${V.rig.blocked ? " · BATEU!" : ""} · vagas ao sul do pátio do posto`;
      if (stall >= 0 && stall !== lastStall2) hud.showToast(`Estacionado na vaga ${stall}! O barco continua amarrado (${moorWhere}).`);
      lastStall2 = stall;
    }
    if (driving) {
      trailerChip.classList.add("show", "ok");
      const art = Math.abs(V.rig.articulation) * 180 / Math.PI;
      if (!V.rig.coupled) trailerChip.textContent = `CARRETINHA SOLTA · bola do engate a ${V.rig.couplerGap.toFixed(1)} m do acoplador — encoste de ré e aperte I${V.rig.blocked ? " · BATEU!" : ""}`;
      else trailerChip.textContent = fueling ? `ABASTECENDO · +${fuelAdded.toFixed(1)} L · ${boat.systems.fuelL.toFixed(1)}/${boat.systems.p.tankLiters} L`
        : bay.near ? (bay.ok ? (boat.engine !== "off" ? "BOMBA: desligue o motor do barco (P) e abasteça (F)" : "BOMBA: parado certo — F abastece o barco") : `BOMBA: ${bay.why}`)
        : `${V.kind !== "bote" ? "CAMINHONETE" : "CARRO"} · ${(Math.abs(V.rig.v) * 3.6).toFixed(0)} km/h${V.rig.v < -0.05 ? " (ré)" : ""} · carretinha ${art.toFixed(0)}°${art > 60 ? " — CANIVETE!" : ""}${V.rig.wheelsInWater ? " · RODAS NA ÁGUA: pare e solte o barco (U)" : ""}${V.rig.blocked ? " · BATEU!" : ""}${T.tiltDeg < 25 && !V.rig.wheelsInWater ? " · LEVANTE O MOTOR (E) — o pé arrasta no chão!" : ""}`;
    }
    // barra de atalhos do momento (teclas + botões tocáveis)
    {
      const K: [string, string, Action | null][] = [];
      if (mode !== "game") { /* menu: sem barra */ }
      else if (driving && bay.ok) K.push(["F", fueling ? "PARAR de abastecer" : "ABASTECER o barco", "fuel"], ["P", T.engine === "running" ? "desligar motor" : "motor desligado ✓", T.engine === "running" ? "ignition" : null], ["W", "sair", null], ["U", "comando ao barco", "unhitch"]);
      else if (driving && !V.rig.coupled) K.push(["W", "frente", null], ["S", "freio / ré", null], ["A D", "direção", null], ["I", "ACOPLAR a carretinha", "couple"], ["U", "voltar ao barco", "unhitch"], ["B", "buzina", "horn"]);
      else if (driving) K.push(["I", "desacoplar carretinha", "couple"], ["W", "frente", null], ["S", "freio / ré", null], ["A D", "direção", null], ["E Q", "motor (tilt)", null], ["P", T.engine === "running" ? "desligar motor" : V.kind === "bote" ? "corda" : "ligar motor", "ignition"], ["U", "COMANDO ao barco", "unhitch"], ["R", "píer", "reset"]);
      else if (T.capsized || boat.swimmers.length) K.push(["R", "recomeçar no píer", "reset"]);
      else if (carOnly) K.push(["W", "frente", null], ["S", "freio / ré", null], ["A D", "direção", null], ["I", V.rig.coupled ? "desacoplar carretinha" : "ACOPLAR carretinha", "couple"], ["U", "VOLTAR ao barco", "unhitch"], ["B", "buzina", "horn"], ["R", "píer", "reset"]);
      else if (boat.mooringLines.length) K.push(["M", "SOLTAR as amarras", "moor"], ...(moorWhere === "píer" ? [["O", "embarque", "occupants"] as [string, string, Action]] : []), ["K", "ir para o carro", "car"], ["P", T.engine === "running" ? "desligar motor" : V.kind === "bote" ? "corda" : "ligar motor", "ignition"], ["C", "câmera", "camera"]);
      else if (boat.winchStrap) K.push(["U", trailerInWater() ? "SOLTAR a cinta" : "comando ao carro", "unhitch"], ["P", T.engine === "running" ? "desligar motor" : V.kind === "bote" ? "corda" : "ligar motor", "ignition"], ["E Q", "motor (tilt)", null]);
      else if (ld.near) K.push(["E", V.kind !== "bote" ? "levantar o motor" : "pino / tilt", null], ["W S", "marcha / acelerar", null], ["A D", "direção", null], ["T", `vento: ${wind.def.key}`, "wind"]);
      else if (T.anchorOut > 0) K.push(["+", "pagar cabo", null], ["−", "recolher âncora", null], ["P", T.engine === "running" ? "desligar motor" : V.kind === "bote" ? "corda" : "ligar motor", "ignition"], ["C", "câmera", "camera"]);
      else K.push(["T", `vento: ${wind.def.key}`, "wind"], ["P", V.kind === "bote" ? "corda (partida)" : "liga/desliga", "ignition"], ["+ −", "âncora", null], ["C", "câmera", "camera"], ["H", "ajuda", "help"]);
      // bateria zerada (lancha): botão para conectar o booster de partida
      if (mode === "game" && !T.capsized && !driving && !carOnly) K.unshift(["Y", boat.params.turbine ? (tpanel.isOpen ? "fechar painel" : "painel de partida") : spanel.isOpen ? "fechar sistemas" : "sistemas", "turbinePanel"]);
      if (mode === "game" && boat.params.turbine && !T.capsized && !driving && !carOnly && (T.gpu || (docked() && T.engine !== "running")))
        K.unshift(["J", T.gpu ? "desconectar GPU" : "conectar GPU (doca)", "jump"]);
      else if (mode === "game" && !boat.params.turbine && boat.systems.p.hasBattery && !T.capsized && !driving && !carOnly && (T.jumper || T.engine !== "running" || T.batterySoc < 0.3))
        K.unshift(["J", T.jumper ? `desconectar jump start (${(T.jumpCharge * JUMP_AH).toFixed(1)} Ah)` : `${T.batterySoc < 0.08 ? "CONECTAR" : "conectar"} jump start (${(T.jumpCharge * JUMP_AH).toFixed(1)} Ah)`, "jump"]);
      const key = K.map((k) => k[0] + k[1]).join("|");
      if (key !== ctxKey) {
        ctxKey = key;
        fitCtxBar(); // não invadir os relógios (o HUD muda de largura conforme o barco)
        ctxBar.innerHTML = K.map(([k, label, act]) => `<button class="ctx${act === "unhitch" || act === "moor" || act === "car" || (act === "jump" && !T.jumper && T.batterySoc < 0.08) || (act === "couple" && !V.rig.coupled) ? " hot" : ""}"${act ? ` data-a="${act}"` : " disabled"}>${k.split(" ").map((x) => `<kbd>${x}</kbd>`).join("")} ${label}</button>`).join("");
      }
    }
    if (T.damageCount !== lastDamage) { if (mode === "game") hud.showToast(T.damageEvent + (T.engineDamage >= 0.95 ? " — MOTOR QUEBRADO" : "")); lastDamage = T.damageCount; }
    for (const e of boat.units[0].turb?.drainEvents() ?? []) {
      const tb = T.turbine;
      if (!tb) continue;
      if (e === "lightoff") audio.lightOff();
      const tmsg: Partial<Record<string, string>> = {
        ignition: `N1 ${tb.n1.toFixed(0)} %: ignição e combustível abertos (velas estalando)…`,
        lightoff: "Acendeu (light-off): a EGT sobe e o gerador de gás acelera",
        starterOff: `N1 ${tb.n1.toFixed(0)} %: autossustentável — arranque e ignição desligados`,
        idle: `Marcha lenta: N1 ${tb.n1.toFixed(0)} %, EGT ${tb.egt.toFixed(0)} °C, óleo ${tb.oilPsi.toFixed(0)} psi — engate e acelere`,
        hotStart: `PARTIDA QUENTE: EGT ${tb.egt.toFixed(0)} °C (limite ${V.P.turbine!.egtStartLimit}) — combustível cortado. Arranque lento (bateria fraca): espere o N1 cair e tente de novo, de preferência com a GPU da doca (J, atracado)`,
        hungStart: `Partida pendurada: o arranque não levou o N1 a ${V.P.turbine!.lightOffN1} % (bateria fraca) — atraque e conecte a GPU da doca (J)`,
        noLightOff: "Não acendeu: sem combustível chegando — abasteça no posto",
        flameout: "A turbina apagou (flameout): desacelerando",
        shutdown: "Combustível cortado: a turbina desacelera (spool-down ~40 s)",
        overtemp: `SOBRETEMPERATURA: EGT ${tb.egt.toFixed(0)} °C (limite ${V.P.turbine!.egtStartLimit}) — corte o COMBUSTÍVEL! No manual nada protege: a turbina desgasta`,
        wetStart: "Partida MOLHADA: o combustível acumulado na câmara queimou de uma vez (labareda) — abra o combustível só com a ignição ligada e N1 em 12 %",
        starterOverspeed: "Starter ainda ligado acima de 60 % N1 — desligue: no manual ninguém corta, e ele esquenta rápido",
        earlyFuel: `Combustível aberto CEDO (acendeu com N1 em ${tb.n1.toFixed(0)} %): pouco ar para o combustível — a EGT dispara (partida quente)`,
        starterHot: "STARTER SUPERAQUECIDO: mais de 40 s ligado — o térmico desarmou; espere ~60 s para usar de novo",
        starterLocked: "Starter ainda quente (térmico desarmado) — aguarde esfriar",
        seized: "TURBINA DESTRUÍDA (sobretemperatura do escape ou do óleo): travou. R leva à oficina do píer (reparo)",
        oilHot: `ÓLEO QUENTE: ${tb.oilC.toFixed(0)} °C — a turbina NÃO corta sozinha. Sem água no trocador (tomada fora d'água?) ela esquenta: reduza ou corte`,
        oilDamage: `ÓLEO ACIMA DE ${V.P.turbine!.oilRedC} °C: os mancais estão se desgastando — corte a turbina (P / CORTE) antes que ela trave`,
      };
      if (mode === "game" && tmsg[e]) hud.showToast(tmsg[e]!);
    }
    if (T.startFail && T.startFail !== lastStartFail) hud.showToast(T.startFail === "fuel" ? "O motor gira mas não pega: sem combustível — abasteça no posto" : T.startFail === "pull" ? "Não pegou — puxe de novo (P)" : T.startFail === "dead" ? "Só estalou: bateria sem força para girar o arranque" : "Não pegou: o arranque girou fraco (bateria baixa)");
    lastStartFail = T.startFail;
    // âncora: avisos nas mudanças de estado
    if (T.anchorState !== lastAnchorState && mode === "game") {
      const st = T.anchorState;
      if (st === "no fundo" && lastAnchorState === "descendo") hud.showToast(`Âncora no fundo a ${T.anchorDepth.toFixed(1)} m — pague cabo (+) até ~5× a profundidade (${(T.anchorDepth * 5).toFixed(0)} m) e dê ré devagar para unhar`);
      else if (st === "segurando" && lastAnchorState !== "garrando") hud.showToast(`Âncora unhada e segurando: ${T.anchorOut.toFixed(1)} m de cabo (${T.anchorScope.toFixed(1)}:1)`);
      else if (st === "garrando") hud.showToast("A âncora está garrando (arando o fundo) — pague mais cabo (+) ou alivie o motor");
      else if (st === "recolhida" && lastAnchorState === "subindo") hud.showToast("Âncora recolhida na proa");
      lastAnchorState = st;
    }
    if (T.bilgeAlarm && !lastBilgeAlarm && mode === "game") hud.showToast(T.bilgePump ? `Bomba de porão ligada: entrando ${T.bilgeInflowLps.toFixed(1)} L/s — ${T.bilgeInflowLps > T.bilgeFlowLps ? "a bomba não vence, volte ao píer!" : "a bomba dá conta"}` : `Água no porão: ${T.bilgeL.toFixed(0)} L`);
    lastBilgeAlarm = T.bilgeAlarm;
    if (T.swamped && !lastSwamped && mode === "game" && !T.sunk) hud.showToast(`Barco ALAGADO: ${T.bilgeL.toFixed(0)} L dentro e a borda na linha d'água — inavegável; se entrar mais água ele afunda`);
    lastSwamped = T.swamped;
    if (T.sunk && !lastSunk && mode === "game") hud.showToast(`O barco AFUNDOU com ${T.bilgeL.toFixed(0)} L de água dentro — todos na água de colete. R para recomeçar`, true);
    // afundou: silêncio total e sem alertas na tela (combustível, bateria… já não importam); R volta tudo
    if (T.sunk !== lastSunk) { audio.silenceAll(T.sunk); hud.setQuiet(T.sunk); }
    lastSunk = T.sunk;
    if (boat.systems.jumperTrips !== lastJumperTrips) { if (mode === "game") hud.showToast(`Proteção do jump start desarmou: mais de ${JUMP_MAX_A} A (ex.: partida + molinete juntos) — J para religar`); lastJumperTrips = boat.systems.jumperTrips; }
    if (boat.systems.gpu && !docked()) { boat.systems.gpu = false; if (mode === "game") hud.showToast("GPU desconectada: o cabo foi solto ao sair da doca"); }
    if (T.gpuState !== lastGpuState) {
      if (T.gpuState === "online" && mode === "game") hud.showToast(boat.units[0].turb?.fadec ? `GPU estável (1500 rpm) — FADEC fechou o EXT PWR: ${GPU_V} V no barramento. Pode dar a partida`
        : `GPU estável (1500 rpm) — feche o EXT PWR no painel (Y) para pôr os ${GPU_V} V no barramento`);
      lastGpuState = T.gpuState;
    }
    if (boat.systems.gpuAutoOff !== lastGpuOff) { if (mode === "game") hud.showToast("Turbina em marcha lenta — FADEC abriu o EXT PWR: a GPU saiu do barramento (o gerador assume). J recolhe o cabo"); lastGpuOff = boat.systems.gpuAutoOff; }
    {
      // cabo da GPU até a tomada do costado do lado do píer (AR-10)
      let socket: Vector3 | null = null;
      if (boat.systems.gpu && V.P.turbine) {
        const toCart = rotInvXZ(gpuCart.root.position.x - boat.pos.x, gpuCart.root.position.z - boat.pos.z);
        const p = boat.toWorld(v3(Math.sign(toCart) * (V.P.beam / 2 - 0.02), 0.4, -2.8));
        socket = new Vector3(p.x, p.y, p.z);
      }
      const isTurb = !!V.P.turbine;
      gpuCart.root.setEnabled(isTurb); gpuCrew.group.setEnabled(isTurb);
      gpuCart.update(socket, isTurb ? T.gpuState : "off", socket ? new Vector3(berthB.edgeX + 0.03, berthB.deckY + 0.03, socket.z) : undefined);
      if (isTurb) {
        // o assistente olha para a lancha; com a GPU ligando/ligada, vira para o painel do carrinho
        gpuCrew.stand(gpuCrewSpot, T.gpuState !== "off" ? Math.PI : Math.PI / 2, simTime);
      }
      const cpos = scene.activeCamera?.globalPosition ?? Vector3.Zero();
      audio.updateGpu(isTurb ? T.gpuState : "off", T.gpuT, Vector3.Distance(cpos, gpuCart.root.position), cam.mode === "cockpit", T.gpuKw);
      gpuCart.updateDiesel(isTurb ? T.gpuState : "off", T.gpuT, T.gpuKw, paused ? 0 : dtReal);
      tpanel.update(T);
      { const ec = vin.engineCmd, cm = ec && ec.length ? ec : [{ gear: vin.gear, throttle: vin.throttle, neutral: !!vin.neutralThrottle }];
        tpanel.updateLevers(cm); spanel.updateLevers(cm.length >= boat.units.length ? cm : [cm[0], cm[0]]); }
      spanel.update(T, lights);
    }
    if (boat.systems.jumperAutoOff !== lastJumperOff) { if (mode === "game") hud.showToast(`O motor pegou — jump start desconectado (carga ${Math.round(T.jumpCharge * 100)} %, recarrega em cruzeiro)`); lastJumperOff = boat.systems.jumperAutoOff; }
    if (T.trimRelay && !trimRelayWarned && mode === "game") { hud.showToast("Trim sem força: bateria zerada — só o relé estala (J conecta o jump start)"); trimRelayWarned = true; }
    if (!T.trimRelay && input.state.trim === 0) trimRelayWarned = false;
    if (T.neutralRev && !neutralRevWarned && mode === "game") hud.showToast(`Acelerando em neutro (N segurado): o giro sobe sem engatar — limitado a ${NEUTRAL_REV_LIMIT} rpm`);
    neutralRevWarned = T.neutralRev;
    if (T.lowFuel && !lowFuelWarned && T.engine === "running" && mode === "game") { hud.showToast(`Combustível na reserva: ${T.fuelL.toFixed(1)} L`); lowFuelWarned = true; }
    if (!T.lowFuel) lowFuelWarned = false;
    if (T.stall && T.stall !== lastStall && T.stall !== "capsize" && T.stall !== "broken") hud.showToast(T.stall === "fuel" ? (T.fuelValveOpen ? "O motor morreu: acabou o combustível" : "O motor morreu: registro do tanque FECHADO (Y abre)") : T.stall === "flooded" ? "O motor AFOGOU: afogador puxado com o motor quente — empurre o afogador (Y) e puxe a corda de novo" : "O motor desligou: superaquecimento");
    lastStall = T.stall;
    if ((hoursSaveT += dtReal) > 10) { hoursSaveT = 0; try { localStorage.setItem(V.hoursKey, String(boat.systems.engineHours)); } catch { /* sem storage */ } }
    // hélice: velocidade visual PROPORCIONAL ao RPM real (escala fixa de 0,12). A rotação real (até ~48 voltas/s)
    // daria efeito estroboscópico a 60 FPS (a hélice pareceria parada ou girando ao contrário).
    drivesOf(vis).forEach((dr, i) => {
      const pr = T.propRpms?.[i] ?? T.propRpm;
      if (!paused) dr.propeller.rotation.z += (pr / 60) * PROP_VISUAL_SCALE * 2 * Math.PI * dtReal * (i === 0 ? 1 : -1); // hélices contrarrotativas
      dr.propBlur.alpha = Math.min(0.3, Math.max(0, (Math.abs(pr) - 1200) / 4000));
    });
    for (const b of buoys) b.position.y = water.getHeight(b.position.x, b.position.z) - 0.05;
    moorVis.buoys.forEach((m, i) => { const bb = buoyField.buoys[i]; m.position.set(bb.x, water.getHeight(bb.x, bb.z) + (bb.kind === "mooring" ? 0.08 : 0.3), bb.z); });
    // chegada ao fim do cânion (largada)
    if (mode === "game" && !driving && !carOnly) {
      const dEnd = Math.hypot(boat.pos.x - CANYON_END.x, boat.pos.z - CANYON_END.z);
      if (dEnd < 18 && !reachedEnd) { reachedEnd = true; hud.showToast("Fim do cânion! É aqui que o jogo começa de verdade (LARGADA)"); }
      if (dEnd > 60) reachedEnd = false;
    }
    ropes.update(boat);
    V.gear.update(boat, simTime, mode === "game", physWater);
    // câmera embaixo d'água: neblina verde-azulada densa, céu escondido, superfície vista por baixo, som abafado
    {
      const cp = cam.cam.position;
      const under = cp.y < physWater.getHeight(cp.x, cp.z) - 0.03;
      if (under !== underwater) {
        underwater = under;
        waterVis.under = under;
        skybox.setEnabled(!under);
        scene.fogColor = under ? UNDER_FOG : AIR_FOG;
        scene.clearColor = under ? new Color4(UNDER_FOG.r, UNDER_FOG.g, UNDER_FOG.b, 1) : new Color4(AIR_FOG.r, AIR_FOG.g, AIR_FOG.b, 1);
        waterVis.fogColor = under ? UNDER_FOG : AIR_FOG;
        underOverlay.classList.toggle("on", under);
        audio.setUnderwater(under);
      }
      // a densidade cresce com a profundidade (menos luz)
      if (under) {
        const depthCam = physWater.getHeight(cp.x, cp.z) - cp.y;
        scene.fogDensity = 0.07 + 0.01 * depthCam;
        waterVis.fogDensity = scene.fogDensity;
      } else if (scene.fogDensity !== AIR_FOG_DENSITY) { scene.fogDensity = AIR_FOG_DENSITY; waterVis.fogDensity = AIR_FOG_DENSITY; }
    }

    if (mode === "menu") cam.spin(dtReal, 0.22, 0.12); // prévia: câmera girando devagar em volta do barco
    cam.distScale = (V.kind === "bote" ? 0.62 : V.kind === "rapida" ? 1.3 : V.kind === "turbina" ? 1.45 : 1) * (driving ? 1.35 : 1);
    if (carOnly || (driving && !V.rig.coupled)) {
      // câmera segue o veículo (no carro sem o barco ou com a carretinha solta)
      const cp = V.rig.carPose();
      cam.distScale = V.kind === "turbina" ? 1.6 : V.kind === "rapida" ? 1.45 : V.kind === "lancha" ? 1.25 : 1.0;
      cam.update(dtReal, new Vector3(cp.x, cp.y, cp.z), Quaternion.FromEulerAngles(cp.pitch, cp.yaw, 0), Math.abs(V.rig.v));
    } else cam.update(dtReal, rPos, rRot, Math.hypot(boat.vel.x, boat.vel.z));
    fx.water = physWater; // as partículas param na mesma superfície da física (com a esteira)
    if (!paused) fx.update(dtReal, boat, water);
    exhaustFx.update(dtReal, vis.exhausts, T.turbine, boat.vel, paused);
    waterVis.update(water, cam.cam, engine.getRenderWidth(), engine.getRenderHeight());
    if (cfg.quality.shadows > 0) sun.position = rPos.add(sunDir.scale(150));

    // esguicho de refrigeração: bico no capô, jato para fora (+X local do motor, levemente para trás e para baixo)
    const ew = vis.engine.getWorldMatrix();
    fx.updateTelltale(vis.telltale.getAbsolutePosition().clone(), Vector3.TransformNormal(new Vector3(1, -0.15, -0.35), ew), T.rpm, new Vector3(boat.vel.x, boat.vel.y, boat.vel.z),
      T.engine === "running" && T.intakeSubmerged && V.kind !== "rapida" && V.kind !== "turbina"); // sem água na entrada do pé = sem esguicho; os V8 de centro (AR-9) não têm esguicho: a água sai com o escape
    if (T.tiltBlocked && !tiltWarned) { hud.showToast(isBote ? "Solte o acelerador para mudar a posição do motor" : "Tilt bloqueado: o empuxo da hélice segura o motor — reduza a rotação"); tiltWarned = true; }
    if (isBote && T.trimPin !== lastPin) { if (lastPin > 0) hud.showToast(T.trimPin > P.trimPins.length ? "Motor levantado (tilt) e travado" : `Motor no pino ${T.trimPin} de ${P.trimPins.length} (${(P.trimPins[T.trimPin - 1] * 180 / Math.PI).toFixed(0)}°)`); lastPin = T.trimPin; }
    if (!T.tiltBlocked) tiltWarned = false;
    if (T.engine === "running" && !T.intakeSubmerged && T.tiltDeg > 5 && !intakeWarned && !T.capsized) { hud.showToast("Motor recolhido: sem água de refrigeração!"); intakeWarned = true; }
    if (T.intakeSubmerged) intakeWarned = false;

    fx.updateDrips(dtReal, V.skeg.getAbsolutePosition().clone(), T.propImmersion);
    if (T.gear !== lastGear) { audio.clunk(T.gear !== "N"); lastGear = T.gear; }
    audio.update({
      rpm: T.rpm, throttle: T.throttle, speed: Math.hypot(boat.vel.x, boat.vel.z), boil: Math.max(T.cavitation, 1 - T.ventilation),
      inGear: T.gear !== "N", propInWater: T.propImmersion > 0.5, revLimiter: T.revLimiter, cockpit: cam.mode === "cockpit", engine: T.engine, trimMotorA: T.trimMotorA, trimRelay: T.trimRelay, bilgeAlarm: mode === "game" && T.bilgeAlarm && !T.capsized && !T.sunk, bilgeFlowLps: T.bilgeFlowLps, bilgePumpOn: T.bilgePump && !T.sunk, bilgeWaterL: T.bilgeL, windlassA: T.windlassA, apparentWind: T.apparentWind, anchorRelay: T.anchorRelay, buzzer: T.buzzer, starterRpm: T.starterRpm, pullStart: T.pullStart,
      oilAlarm: mode === "game" && !!T.turbine?.oilHot && !T.sunk,
      // AR-9: o 2º V8 tem voz própria (rotação/carga/estado dele)
      ...(boat.units.length > 1 ? { rpm: T.rpms[0], throttle: T.throttles[0], rpm2: T.rpms[1], throttle2: T.throttles[1], engine2: T.engines[1], engine: T.engines[0] } : {}),
      // turbina: N1/N2, EGT (chama), arranque e velas de ignição — síntese própria (apito do compressor, rugido da combustão)
      turbine: T.turbine ? { n1: T.turbine.n1, n2: T.turbine.n2, egt: T.turbine.egt, power: T.turbine.torque / 100 * T.turbine.n2 / 100, starter: T.turbine.starter, ignition: T.turbine.ignition, lit: T.turbine.lit, fuelLph: T.turbine.fuelLph } : undefined,
    });
    // buzina: do veículo quando você está nele; senão do barco (segurar B, ou toque no botão = 0,22 s)
    hornPulse = Math.max(0, hornPulse - dtReal);
    // buzina elétrica da lancha: tom e volume caem com a tensão da bateria (o bote tem buzina de ar; o carro, bateria própria)
    audio.setHorn(mode === "game" && (input.hornHeld || hornPulse > 0), driving || carOnly ? "car" : V.kind === "bote" ? "bote" : "lancha", !driving && !carOnly && V.boat.systems.p.hasBattery ? T.houseV * 12 / T.nominalV : 12.6);
    if (lights && V.vis.lights) setNavLights(V.vis, true, T.houseV * 12 / T.nominalV); // luzes de navegação: brilho pela tensão
    if ((windHudT -= dtReal) <= 0) { windHudT = 0.25; hud.updateWind(wind.speed * MS_TO_KNOTS, wind.dirFrom - Math.atan2(boat.forward.x, boat.forward.z)); }
    hud.update(T, fpsSmooth, {
      "física (ms/frame)": physMs.toFixed(2),
      "resolução": `${engine.getRenderWidth()}×${engine.getRenderHeight()} (${pixelRatio.toFixed(2)}×)`,
      "malhas ativas": String(scene.getActiveMeshes().length),
      "input": input.lastDevice,
      "ondas": water.intensity.toFixed(2),
      "pessoas na água": String(T.swimmers),
      "correnteza (m/s)": Math.hypot(water.getCurrent(boat.pos.x, boat.pos.z).x, water.getCurrent(boat.pos.x, boat.pos.z).z).toFixed(2),
    });
  });

  // começa no menu com a prévia do barco (ou direto no jogo com ?barco=lancha|bote|rapida|turbina)
  activate(V.kind);
  if (isKind(urlKind)) startGame(); else showSplash(); // abertura: splash → escolha do barco → jogo

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
  (window as unknown as Record<string, unknown>).__aqua = {
    get kind() { return V.kind; }, get boat() { return V.boat; }, get boatVis() { return V.vis; }, get mode() { return mode; },
    vessels, water, waterVis, fx, audio, world, scene, engine, cam, input, loadMs, startGame, showMenu, gpuCart,
    checkConvention: () => {
      const f = V.boat.forward;
      const bf = V.vis.root.forward;
      return { sim: f, babylon: { x: bf.x, y: bf.y, z: bf.z } };
    },
  };
};

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById("loading");
  if (el) el.textContent = "Erro ao iniciar: " + (e as Error).message;
});
