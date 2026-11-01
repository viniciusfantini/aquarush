// Bootstrap da POC 1 (Babylon.js). Une Simulation (sim/), Gameplay (gameplay/),
// Presentation (presentation/) e Platform (platform/) com um laço de física em PASSO FIXO
// (120 Hz) e renderização interpolada.
// Fluxo: carrega o lago → MENU (o barco escolhido boia no píer, câmera girando = prévia real) → JOGO.

import {
  Engine, WebGPUEngine, Scene, Vector3, Quaternion, Color3, Color4, HemisphericLight, DirectionalLight, ShadowGenerator,
  MeshBuilder, ReflectionProbe, RenderTargetTexture, ImageProcessingConfiguration, Matrix, type AbstractEngine, type Mesh, type AbstractMesh, type TransformNode,
} from "@babylonjs/core";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";

import { readUrlConfig, PHYSICS_DT, MAX_SUBSTEPS } from "./core/config.ts";
import { Speedboat } from "./sim/boat.ts";
import { VESSELS, PERSON_KG, type VesselKind, type SeatId, type SpeedboatParams } from "./sim/params.ts";
import { GerstnerWater, WAVE_PRESETS } from "./sim/water.ts";
import { buildWorld, RIVER_CURRENT, RAMP, fromFrame } from "./sim/world.ts";
import { buildTrailer, trailerLoadState, attachWinch, seatedBoatLocal, type TrailerLayout } from "./sim/trailer.ts";
import { TowRig, TOW_SPECS, type Pose } from "./sim/towVehicle.ts";
import { buildRamp, buildTrailerMesh, buildTowVehicle } from "./presentation/ramp.ts";
import { buildRoadAndLot, buildStation } from "./presentation/station.ts";
import { buildMoorings, Ropes } from "./presentation/mooring.ts";
import { pierBerthState, tieToPier, buoyState, tieToBuoy } from "./sim/mooring.ts";
import { STATION, stationObstacles, fuelBayState } from "./sim/station.ts";
import { WakeField, WaterWithWake } from "./sim/wake.ts";
import { v3 } from "./sim/math.ts";
import { emptyInput } from "./gameplay/vehicleInput.ts";
import { InputManager, attachTouchControls, type Action } from "./platform/input.ts";
import { WaterVisual } from "./presentation/waterMaterial.ts";
import { buildTerrain, buildRocks, buildTrees, buildPier } from "./presentation/environment.ts";
import { buildBoat, setNavLights, type BoatVisual } from "./presentation/boatMesh.ts";
import { buildHelm, toRootLocal } from "./presentation/helm.ts";
import { buildPilot, buildPassenger, type Pilot } from "./presentation/pilot.ts";
import { buildDinghy, DINGHY_FLOOR, type DinghyControls } from "./presentation/dinghyMesh.ts";
import { WaterInteraction } from "./presentation/waterInteraction.ts";
import { BoatCamera } from "./presentation/cameras.ts";
import { Hud } from "./presentation/hud.ts";
import { EngineAudio } from "./presentation/audio.ts";

const BUILD = "poc-babylon 0.22.0";
/** Escala visual da rotação da hélice (proporcional ao RPM, abaixo do limite estroboscópico). */
const PROP_VISUAL_SCALE = 0.12;

/** Presets de água: amplitude das ondas de Gerstner (física + visual) e ondulação fina (visual). */
const WATER_PRESETS = [
  { key: "vidro", label: "Água: vidro (glass)", waves: 0, ripple: 0 },
  { key: "calma", label: "Água: calma", waves: 0.35, ripple: 0.45 },
  { key: "lago", label: "Água: lago", waves: 1, ripple: 1 },
  { key: "forte", label: "Água: ondas fortes", waves: 2.5, ripple: 1.4 },
] as const;

/** Combustível no tanque ao começar / reposicionar (pedido do usuário: lancha 3 L, bote 1 L). */
const START_FUEL: Record<VesselKind, number> = { lancha: 3, bote: 1 };

/** Tudo o que pertence a uma embarcação: física, visual, comandos, pessoas. */
interface Vessel {
  kind: VesselKind;
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
  skybox.material = skyMat;
  skybox.infiniteDistance = true;
  skybox.isPickable = false;

  // ---------------- simulação ----------------
  const world = buildWorld();
  const water = new GerstnerWater({ waves: WAVE_PRESETS.lago, groundHeight: world.groundHeight, currents: [RIVER_CURRENT] });
  const spawnPos = () => v3(world.spawn.x, 0.25, world.spawn.z);
  // a física enxerga a água + as marolas da esteira (o barco sente a esteira ao cruzá-la)
  const wakeField = new WakeField();
  const physWater = new WaterWithWake(water, wakeField);

  // ---------------- cena ----------------
  const terrain = buildTerrain(scene, { terrainSubdiv: cfg.quality.terrainSubdiv, trees: cfg.quality.trees });
  const rocks = buildRocks(scene, world.rockList);
  const trees = buildTrees(scene, cfg.quality.trees);
  const pierMeshes = buildPier(scene, world.pier);
  const buoys = pierMeshes.filter((m) => m.name === "buoy");
  const moorVis = buildMoorings(scene, world.pier);
  const ropes = new Ropes(scene);
  const rampMeshes = [...buildRamp(scene), ...buildRoadAndLot(scene, cfg.quality.terrainSubdiv)];
  const stationMeshes = buildStation(scene);

  // ---------------- as duas embarcações (as duas ficam prontas; só a escolhida aparece) ----------------
  const makeVessel = (kind: VesselKind): Vessel => {
    const P = VESSELS[kind];
    const S = P.seats;
    const boat = new Speedboat(P, spawnPos(), world.spawn.heading);
    // lancha: volante + manete no console (helm.ts); bote: cana do leme no motor (dinghyMesh.ts)
    const d = kind === "bote" ? buildDinghy(scene) : null;
    const vis: BoatVisual = d ?? buildBoat(scene);
    const helm = d ? d.controls : buildHelm(scene, vis.root);
    const pilot = d ? buildPilot(scene, vis.root, { x: S.helm.x, zc: S.helm.z, floor: DINGHY_FLOOR }) : buildPilot(scene, vis.root);
    const pax: Vessel["pax"] = d ? {
      passenger: buildPassenger(scene, vis.root, S.passenger.x, S.passenger.z, "paxA", 0, DINGHY_FLOOR),
      rearLeft: buildPassenger(scene, vis.root, S.rearLeft.x, S.rearLeft.z, "paxB", 1, DINGHY_FLOOR),
    } : {
      passenger: buildPassenger(scene, vis.root, -0.5, -0.22, "paxA", 0),
      rearLeft: buildPassenger(scene, vis.root, -0.45, -2.15, "paxB", 1),
      rearRight: buildPassenger(scene, vis.root, 0.45, -2.15, "paxC", 2),
    };
    vis.meshes.push(...helm.meshes, ...pilot.meshes);
    for (const p of Object.values(pax)) vis.meshes.push(...p.meshes);
    const presets = d ? [
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
    const hoursKey = kind === "bote" ? "aquarush.engineHours.bote" : "aquarush.engineHours";
    try { const h = Number(localStorage.getItem(hoursKey)); boat.systems.engineHours = Number.isFinite(h) && h > 0 ? h : kind === "bote" ? 112.4 : 37.2; } catch { boat.systems.engineHours = 37.2; }
    boat.systems.fuelL = START_FUEL[kind];
    vis.root.setEnabled(false);
    // carretinha do tamanho do barco + veículo (bote: carro comum; lancha: caminhonete)
    const trailer = buildTrailer(P);
    const tm = buildTrailerMesh(scene, trailer);
    const tv = buildTowVehicle(scene, trailer);
    tm.root.setEnabled(false); tv.root.setEnabled(false);
    return { kind, P, boat, vis, helm, dinghy: d ? d.controls : null, pilot, pax, presets, skeg: vis.meshes.find((m) => m.name === "skeg")!, hoursKey,
      trailer, trailerNodes: [tm.root, tv.root], trailerMeshes: [...tm.meshes, ...tv.meshes],
      rig: new TowRig(trailer, TOW_SPECS[kind === "lancha" ? "pickup" : "car"], world.groundHeight), trailerRoot: tm.root, carRoot: tv.root };
  };
  const vessels: Record<VesselKind, Vessel> = { lancha: makeVessel("lancha"), bote: makeVessel("bote") };
  let V = vessels[urlKind === "bote" ? "bote" : "lancha"];
  const allBoatMeshes = [...vessels.lancha.vis.meshes, ...vessels.bote.vis.meshes].filter((m) => m.name !== "propDisc");
  const staticExtras = [...rampMeshes, ...stationMeshes, ...moorVis.meshes, ...vessels.lancha.trailerMeshes, ...vessels.bote.trailerMeshes];

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
    const list: Mesh[] = [terrain, rocks, ...pierMeshes, ...staticExtras, ...allBoatMeshes];
    depth.getDepthMap().renderList = list;
  }

  const fx = new WaterInteraction(scene, wakeField, { particles: cfg.quality.particles, wakeTexture: cfg.quality.wakeTexture });
  const waterVis = new WaterVisual(scene, {
    resolution: cfg.quality.waterResolution, innerExtent: 80, outerExtent: 2600, depth, wake: fx.wake, reflectionSize: cfg.quality.reflection,
  });
  waterVis.sunDir = sunDir;
  waterVis.fogDensity = scene.fogDensity;
  const reflList: AbstractMesh[] = [skybox, terrain, rocks, trees, ...pierMeshes, ...staticExtras, ...allBoatMeshes];
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
    V.boat.occupants = pr.seats.map((seat) => ({ seat, mass: PERSON_KG }));
    for (const [seat, p] of Object.entries(V.pax)) for (const m of p.meshes) m.setEnabled(pr.seats.includes(seat as SeatId));
    hud.setOccupants(`${pr.seats.length} · ${pr.label}`);
    if (toast) hud.showToast(`Ocupantes: ${pr.label} (+${pr.seats.length * PERSON_KG} kg)`);
  };
  document.getElementById("h-occ")!.addEventListener("click", () => input.pushAction("occupants"));

  let waterPreset = 2;
  const applyWater = (i: number, toast = true) => {
    waterPreset = (i + WATER_PRESETS.length) % WATER_PRESETS.length;
    const p = WATER_PRESETS[waterPreset];
    water.intensity = p.waves;
    waterVis.ripple = p.ripple;
    hud.setWater(p.key);
    if (toast) hud.showToast(p.label);
  };
  applyWater(1, false); // sempre começa em "1 — calma"
  document.getElementById("h-water")!.addEventListener("click", () => input.pushAction("waterNext"));

  // ---------------- estado do laço ----------------
  let acc = 0;
  let paused = false;
  let lights = false;
  let mode: "menu" | "game" = "menu";
  const prevPos = new Vector3(), curPos = new Vector3();
  const prevRot = new Quaternion(), curRot = new Quaternion();
  const snap = (dst: Vector3, q: Quaternion) => { const b = V.boat; dst.set(b.pos.x, b.pos.y, b.pos.z); q.set(b.rot.x, b.rot.y, b.rot.z, b.rot.w); };
  let fpsSmooth = 60, resT = 0;
  let lastStartFail = "", lowFuelWarned = false;
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
  let ctxKey = "";
  const ctxBar = document.getElementById("ctx-keys")!;
  ctxBar.addEventListener("click", (e) => { const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a; if (a) input.pushAction(a as Action); });
  // ---- dirigindo o veículo de reboque (barco preso na carretinha pela cinta) ----
  let driving = false;
  let strapT = 0;
  const boatOnTrailer = new Matrix(); // pose do barco no referencial da carretinha (fixa enquanto preso)
  const poseMatrix = (p: Pose) => Matrix.Compose(Vector3.One(), Quaternion.FromEulerAngles(p.pitch, p.yaw, 0), new Vector3(p.x, p.y, p.z));
  const placeRigOf = (X: Vessel) => {
    const c = X.rig.carPose(), t = X.rig.trailerPose();
    X.carRoot.position.set(c.x, c.y, c.z); X.carRoot.rotationQuaternion = Quaternion.FromEulerAngles(c.pitch, c.yaw, 0);
    X.trailerRoot.position.set(t.x, t.y, t.z); X.trailerRoot.rotationQuaternion = Quaternion.FromEulerAngles(t.pitch, t.yaw, 0);
    X.trailer.collider.pose = t; // os colisores da carretinha acompanham o veículo
  };
  const placeRig = () => placeRigOf(V);
  /**
   * O OUTRO barco fica estacionado no pátio, na carretinha, engatado no veículo dele (só visual + obstáculo).
   * Pessoas escondidas (estão no bar/loja); motor levantado para o transporte.
   */
  const parkInLot = (X: Vessel) => {
    const pk = STATION.parking;
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
    X.vis.engine.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), X.P.tiltMax * 0.85); // motor levantado
    X.vis.propBlur.alpha = 0;
  };
  /** Obstáculos do veículo ativo: prédios, ilhas, colunas e o conjunto estacionado do outro barco. */
  const setObstacles = () => {
    const other = vessels[V.kind === "lancha" ? "bote" : "lancha"];
    const pr = world.pier;
    V.rig.obstacles = [...stationObstacles(), other.rig.carObb(), other.rig.trailerObb(),
      { x: pr.shoreX, z: pr.shoreZ - 14, hw: 4.6, hl: 4.8, yaw: 0 },        // bar + deck
      { x: pr.shoreX + 13, z: pr.shoreZ - 15, hw: 6.5, hl: 4.5, yaw: 0 },   // piscina
      { x: pr.shoreX, z: pr.shoreZ - 3, hw: pr.width / 2, hl: 3, yaw: 0 }]; // começo do píer
  };
  const setPeopleVisible = (on: boolean) => { for (const p of [V.pilot, ...Object.values(V.pax)]) p.group.setEnabled(on); };
  // ---- abastecimento no posto ----
  let fueling = false, fuelAdded = 0;
  const FUEL_RATE = { lancha: 1.5, bote: 0.4 } as const; // L/s (bomba de posto ~ 40 L/min; galão portátil mais devagar)
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
    hud.showToast(`Barco preso. Acelerador e direção agora são ${V.kind === "lancha" ? "da caminhonete" : "do carro"} (W/S/A/D); o motor do barco continua no P e no E/Q. U desengata`);
  };
  /** Desengata: solta a cinta; se estiver dirigindo, o comando volta para o barco (a carretinha fica onde está). */
  const unhitch = () => {
    const b = V.boat;
    if (!b.winchStrap && !driving) { hud.showToast("O barco não está preso na carretinha"); return; }
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
    parkInLot(vessels[kind === "lancha" ? "bote" : "lancha"]); // o outro conjunto fica no pátio do posto
    V.vis.root.setEnabled(true);
    // carretinha deste barco na rampa (visual + colisores do berço, postes-guia e batente)
    for (const n of V.trailerNodes) n.setEnabled(true);
    world.trailers = [V.trailer.collider];
    trailerDone = false;
    if (driving) { for (const p of [vessels.lancha, vessels.bote]) for (const q of [p.pilot, ...Object.values(p.pax)]) q.group.setEnabled(true); }
    driving = false; strapT = 0; V.rig.reset(); placeRig(); setObstacles();
    fueling = false;
    for (const p of [V.pilot, ...Object.values(V.pax)]) p.group.setEnabled(true);
    const isBote = kind === "bote";
    hud.configure(isBote ? { speedMax: 60, temp: false, battery: false, trimPins: V.P.trimPins.length, gear: "dial" } : { speedMax: 100, temp: true, battery: true, trimPins: 0, gear: "bar" });
    document.getElementById("help-trim")!.innerHTML = isBote
      ? "<kbd>E</kbd>/<kbd>Q</kbd> trim manual (sem acelerar): pino 1 · 2 · 3 → <kbd>E</kbd> de novo levanta o motor (tilt)"
      : "<kbd>E</kbd> trim + (proa sobe) · <kbd>Q</kbd> trim − (proa desce)";
    document.getElementById("help-occ")!.innerHTML = isBote
      ? "<kbd>O</kbd> ocupantes (1 · 1 no meio · 1 na popa · 3) — mudam o peso e o equilíbrio"
      : "<kbd>O</kbd> ocupantes (1 · carona · 2 na popa · 4) — mudam o peso e o equilíbrio";
    document.getElementById("help-ign")!.innerHTML = isBote
      ? "<kbd>P</kbd> puxa a corda / desliga (partida só em <b>N</b>) · <kbd>Esc</kbd> pausa"
      : "<kbd>P</kbd> liga/desliga o motor (partida só em <b>N</b>) · <kbd>Esc</kbd> pausa";
    document.getElementById("help-lights")!.innerHTML = isBote ? "<kbd>L</kbd> lanterna de mão" : "<kbd>L</kbd> luzes de navegação";
    document.getElementById("help-reset")!.textContent = `reposicionar (${START_FUEL[kind]} L)`;
    document.getElementById("h-charge")!.style.display = isBote ? "none" : "";
    cam.headLocal = isBote ? new Vector3(V.P.seats.helm.x, DINGHY_FLOOR + 1.22, V.P.seats.helm.z + 0.02) : new Vector3(0.5, 1.24, -0.06);
    cam.distScale = isBote ? 0.62 : 1;
    if (cam.mode === "cockpit") { cam.toggle(); hud.setCamera(cam.mode); }
    setCockpitHead(false);
    audio.cylinders = V.P.cylinders;
    lights = false; input.setLights(false);
    setNavLights(V.vis, false); V.dinghy?.setLantern(false);
    hud.setLights(false, isBote ? "LANTERNA" : "LUZES");
    resetBoat(false);
  };

  /** Reposiciona no píer: barco de pé, ocupantes a bordo, combustível inicial. */
  const resetBoat = (toast = true) => {
    const b = V.boat;
    if (driving) stopDriving();
    strapT = 0; moorArmed = true; moorWhere = "";
    input.setGear("N"); wakeField.reset();
    b.reset(spawnPos(), world.spawn.heading);
    b.repair();
    b.engine = mode === "game" ? "running" : "off";
    b.systems.fuelL = START_FUEL[V.kind];
    b.systems.coolantC = Math.min(b.systems.coolantC, 60);
    for (const p of [V.pilot, ...Object.values(V.pax)]) p.board(V.vis.root);
    if (V.dinghy) V.dinghy.pilotAboard = true;
    applyOccupants(occIdx, false);
    capsizeWarned = false; lastPin = 0; lastStall = "";
    snap(curPos, curRot); snap(prevPos, prevRot);
    if (toast) hud.showToast(`Reposicionado no píer — ${START_FUEL[V.kind]} L no tanque`);
  };

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
    V.boat.engine = "running";
    cam.resetOrbit();
    hud.showToast(V.kind === "bote" ? "Bote de apoio AR-3 — 15 hp, cana do leme" : "Lancha AR-6 — 150 hp");
  };
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
    if (a === "unhitch") { unhitch(); return; }
    if (a === "moor") {
      if (boat.mooringLines.length) { boat.mooringLines = []; moorArmed = false; hud.showToast("Amarras soltas — afaste o barco"); moorWhere = ""; }
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
    if (driving && a === "occupants") { hud.showToast("Com o barco na carretinha não dá para trocar a lotação"); return; }
    if (driving && a === "camera") return;
    if (a === "camera") {
      if (V.pilot.group.parent !== V.vis.root) { hud.showToast("O piloto está na água"); return; }
      const m = cam.toggle();
      hud.setCamera(m);
      setCockpitHead(m === "cockpit");
    }
    else if (a === "lights") {
      lights = input.toggleLights();
      setNavLights(V.vis, lights); V.dinghy?.setLantern(lights);
      hud.setLights(lights, V.dinghy ? "LANTERNA" : "LUZES");
    }
    else if (a === "reset") resetBoat();
    else if (a === "ramp") {
      // treino: reposiciona o barco 14 m atrás da carretinha, de proa para a rampa, motor ligado em N
      resetBoat(false);
      const tr = V.trailer;
      boat.reset(v3(tr.cx + 0.3, 0.25, tr.zRear + 14), Math.PI);
      boat.engine = "running";
      snap(curPos, curRot); snap(prevPos, prevRot);
      cam.resetOrbit();
      hud.showToast(V.kind === "lancha" ? "Rampa: levante o motor (E: trim todo + um pouco de tilt), depois suba devagar, de proa e alinhado" : "Rampa: passe o motor para o pino 3 (E), depois suba devagar, de proa e alinhado");
    }
    else if (a === "occupants") applyOccupants(occIdx + 1);
    else if (a === "debug") hud.toggleDebug();
    else if (a === "help") hud.toggleHelp();
    else if (a === "ignition") {
      if (boat.capsized) { hud.showToast("Barco virado — R para recomeçar"); return; }
      const r = boat.toggleIgnition();
      if (r === "noPilot") { hud.showToast("Ninguém no comando — o piloto está na água"); return; }
      if (r === "broken") { hud.showToast("Motor avariado: não liga — R leva à oficina do píer"); return; }
      if (r === "pulling") audio.ropePull();
      const msg: Record<string, string> = { stopped: "Motor desligado", pulling: "Puxando a corda…", starting: "Chave ligada — autoteste…", busy: "Dando partida…", needNeutral: "Coloque em N para dar partida", noFuel: "Sem combustível — R para voltar ao píer e abastecer", lowBattery: "Bateria descarregada: nem o relé de partida arma", hot: "Motor quente demais — espere esfriar" };
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

    const vin = mode === "game" && !driving ? input.update(dtReal) : idleInput;
    if (!paused && driving) {
      // dirigindo: o veículo puxa a carretinha; o barco vai preso nela (pose fixa no referencial da carretinha)
      acc += dtReal;
      const cmd = input.drive(dtReal);
      while (acc >= PHYSICS_DT) {
        prevPos.copyFrom(curPos); prevRot.copyFrom(curRot);
        water.time += PHYSICS_DT; simTime += PHYSICS_DT;
        V.rig.update(PHYSICS_DT, cmd);
        boat.carriedStep(PHYSICS_DT, cmd.trim, physWater);
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
        boat.step(PHYSICS_DT, vin, physWater, world);
        wakeField.update(PHYSICS_DT, boat);
        snap(curPos, curRot);
        acc -= PHYSICS_DT;
        n++;
      }
      if (n === MAX_SUBSTEPS) acc = 0;
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
    vis.engine.rotationQuaternion = qTilt.multiply(qSteer);
    V.helm.update(dtReal, T, input.state, P.maxSteerLow * 180 / Math.PI);

    // pessoas: sentadas nos bancos ou boiando com o colete (barco virado)
    const persons: [SeatId, Pilot][] = [["helm", V.pilot], ...(Object.entries(V.pax) as [SeatId, Pilot][])];
    for (const [seat, person] of persons) {
      const sw = boat.swimmers.find((s) => s.seat === seat);
      if (sw) person.float(new Vector3(sw.pos.x, sw.pos.y, sw.pos.z), sw.yaw, simTime + (seat.length * 0.7), sw.swim);
      else if (person.group.parent !== vis.root) person.board(vis.root);
    }
    const pilotAboard = !boat.swimmers.some((s) => s.seat === "helm");
    if (V.dinghy) V.dinghy.pilotAboard = pilotAboard;
    if (pilotAboard) V.pilot.update(toRootLocal(V.helm.wheelGrip, vis.root), toRootLocal(V.helm.leverGrip, vis.root));
    else if (cam.mode === "cockpit") { cam.toggle(); hud.setCamera(cam.mode); setCockpitHead(false); }
    if (T.capsized && !capsizeWarned && mode === "game") { hud.showToast("O barco virou! O corta-circuito desligou o motor e todos caíram na água (de colete) — R para recomeçar"); capsizeWarned = true; }

    // manobra da carretinha: guia de alinhamento perto dela; aviso quando o barco está carregado
    const ld = trailerLoadState(boat, V.trailer);
    trailerChip.classList.toggle("show", mode === "game" && (ld.near || ld.loaded || !!boat.winchStrap));
    trailerChip.classList.toggle("ok", ld.loaded || (!!boat.winchStrap && ld.onBunks));
    if (ld.loaded || (boat.winchStrap && ld.onBunks)) trailerChip.textContent = boat.winchStrap ? "NA CARRETINHA ✓ · cinta presa" : "NA CARRETINHA · cinta solta — dê ré com o motor para sair";
    else if (ld.near) {
      const side = Math.abs(ld.lateral) < 0.15 ? "centro" : `${Math.abs(ld.lateral).toFixed(1)} m ${ld.lateral > 0 ? "→ vá p/ direita" : "→ vá p/ esquerda"}`;
      const motorDown = T.tiltDeg < 3 && T.trimDeg < (V.kind === "lancha" ? 9 : 3.5);
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
    if (!driving && mode === "game" && boat.winchStrap && ld.overBunks) { strapT += dtReal; if (strapT > 1.5) startDriving(); } else if (!driving) strapT = 0;
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
      const berth = pierBerthState(boat, world.pier), bst = buoyState(boat);
      if (!boat.mooringLines.length && moorArmed) {
        if (berth.ok) { tieToPier(boat, world.pier, berth.side); moorWhere = "píer"; hud.showToast("Atracado na vaga do píer: cabos de proa e popa amarrados (M solta)"); }
        else if (bst.ok && bst.buoy) { tieToBuoy(boat, bst.buoy); moorWhere = "poita " + bst.buoy.id; hud.showToast(`Amarrado na poita ${bst.buoy.id} pela proa (M solta)`); }
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
    if (driving) {
      trailerChip.classList.add("show", "ok");
      const art = Math.abs(V.rig.articulation) * 180 / Math.PI;
      trailerChip.textContent = fueling ? `ABASTECENDO · +${fuelAdded.toFixed(1)} L · ${boat.systems.fuelL.toFixed(1)}/${boat.systems.p.tankLiters} L`
        : bay.near ? (bay.ok ? (boat.engine !== "off" ? "BOMBA: desligue o motor do barco (P) e abasteça (F)" : "BOMBA: parado certo — F abastece o barco") : `BOMBA: ${bay.why}`)
        : `${V.kind === "lancha" ? "CAMINHONETE" : "CARRO"} · ${(Math.abs(V.rig.v) * 3.6).toFixed(0)} km/h${V.rig.v < -0.05 ? " (ré)" : ""} · carretinha ${art.toFixed(0)}°${art > 60 ? " — CANIVETE!" : ""}${V.rig.wheelsInWater ? " · RODAS NA ÁGUA: pare e solte o barco (U)" : ""}${V.rig.blocked ? " · BATEU!" : ""}`;
    }
    // barra de atalhos do momento (teclas + botões tocáveis)
    {
      const K: [string, string, Action | null][] = [];
      if (mode !== "game") { /* menu: sem barra */ }
      else if (driving && bay.ok) K.push(["F", fueling ? "PARAR de abastecer" : "ABASTECER o barco", "fuel"], ["P", T.engine === "running" ? "desligar motor" : "motor desligado ✓", T.engine === "running" ? "ignition" : null], ["W", "sair", null], ["U", "desengatar", "unhitch"]);
      else if (driving) K.push(["W", "frente", null], ["S", "freio / ré", null], ["A D", "direção", null], ["E Q", "motor (tilt)", null], ["P", T.engine === "running" ? "desligar motor" : V.kind === "bote" ? "corda" : "ligar motor", "ignition"], ["U", "DESENGATAR o barco", "unhitch"], ["R", "píer", "reset"]);
      else if (T.capsized || boat.swimmers.length) K.push(["R", "recomeçar no píer", "reset"]);
      else if (boat.mooringLines.length) K.push(["M", "SOLTAR as amarras", "moor"], ["P", T.engine === "running" ? "desligar motor" : V.kind === "bote" ? "corda" : "ligar motor", "ignition"], ["C", "câmera", "camera"]);
      else if (boat.winchStrap) K.push(["U", "DESENGATAR (soltar a cinta)", "unhitch"], ["E Q", "motor (tilt)", null]);
      else if (ld.near) K.push(["E", V.kind === "lancha" ? "levantar o motor" : "pino / tilt", null], ["W S", "marcha / acelerar", null], ["A D", "direção", null], ["T", "recomeçar a rampa", "ramp"]);
      else K.push(["T", "rampa e carretinha", "ramp"], ["P", V.kind === "bote" ? "corda (partida)" : "liga/desliga", "ignition"], ["C", "câmera", "camera"], ["H", "ajuda", "help"]);
      const key = K.map((k) => k[0] + k[1]).join("|");
      if (key !== ctxKey) {
        ctxKey = key;
        ctxBar.innerHTML = K.map(([k, label, act]) => `<button class="ctx${act === "unhitch" || act === "moor" ? " hot" : ""}"${act ? ` data-a="${act}"` : " disabled"}>${k.split(" ").map((x) => `<kbd>${x}</kbd>`).join("")} ${label}</button>`).join("");
      }
    }
    if (T.damageCount !== lastDamage) { if (mode === "game") hud.showToast(T.damageEvent + (T.engineDamage >= 0.95 ? " — MOTOR QUEBRADO" : "")); lastDamage = T.damageCount; }
    if (T.startFail && T.startFail !== lastStartFail) hud.showToast(T.startFail === "pull" ? "Não pegou — puxe de novo (P)" : T.startFail === "dead" ? "Só estalou: bateria sem força para girar o arranque" : "Não pegou: o arranque girou fraco (bateria baixa)");
    lastStartFail = T.startFail;
    if (T.lowFuel && !lowFuelWarned && T.engine === "running" && mode === "game") { hud.showToast(`Combustível na reserva: ${T.fuelL.toFixed(1)} L`); lowFuelWarned = true; }
    if (!T.lowFuel) lowFuelWarned = false;
    if (T.stall && T.stall !== lastStall && T.stall !== "capsize" && T.stall !== "broken") hud.showToast(T.stall === "fuel" ? "O motor morreu: acabou o combustível" : "O motor desligou: superaquecimento");
    lastStall = T.stall;
    if ((hoursSaveT += dtReal) > 10) { hoursSaveT = 0; try { localStorage.setItem(V.hoursKey, String(boat.systems.engineHours)); } catch { /* sem storage */ } }
    // hélice: velocidade visual PROPORCIONAL ao RPM real (escala fixa de 0,12). A rotação real (até ~48 voltas/s)
    // daria efeito estroboscópico a 60 FPS (a hélice pareceria parada ou girando ao contrário).
    if (!paused) vis.propeller.rotation.z += (T.propRpm / 60) * PROP_VISUAL_SCALE * 2 * Math.PI * dtReal;
    vis.propBlur.alpha = Math.min(0.3, Math.max(0, (Math.abs(T.propRpm) - 1200) / 4000));
    for (const b of buoys) b.position.y = water.getHeight(b.position.x, b.position.z) - 0.05;
    for (const b of moorVis.buoys) b.position.y = water.getHeight(b.position.x, b.position.z) + 0.08;
    ropes.update(boat);

    if (mode === "menu") cam.spin(dtReal, 0.22, 0.12); // prévia: câmera girando devagar em volta do barco
    cam.distScale = (V.kind === "bote" ? 0.62 : 1) * (driving ? 1.35 : 1);
    cam.update(dtReal, rPos, rRot, Math.hypot(boat.vel.x, boat.vel.z));
    if (!paused) fx.update(dtReal, boat, water);
    waterVis.update(water, cam.cam, engine.getRenderWidth(), engine.getRenderHeight());
    if (cfg.quality.shadows > 0) sun.position = rPos.add(sunDir.scale(150));

    // esguicho de refrigeração: bico no capô, jato para fora (+X local do motor, levemente para trás e para baixo)
    const ew = vis.engine.getWorldMatrix();
    fx.updateTelltale(vis.telltale.getAbsolutePosition().clone(), Vector3.TransformNormal(new Vector3(1, -0.15, -0.35), ew), T.rpm, new Vector3(boat.vel.x, boat.vel.y, boat.vel.z),
      T.engine === "running" && T.intakeSubmerged); // sem água na entrada do pé = sem esguicho
    if (T.tiltBlocked && !tiltWarned) { hud.showToast(isBote ? "Solte o acelerador para mudar a posição do motor" : "Tilt bloqueado: o empuxo da hélice segura o motor — reduza a rotação"); tiltWarned = true; }
    if (isBote && T.trimPin !== lastPin) { if (lastPin > 0) hud.showToast(T.trimPin > P.trimPins.length ? "Motor levantado (tilt) e travado" : `Motor no pino ${T.trimPin} de ${P.trimPins.length} (${(P.trimPins[T.trimPin - 1] * 180 / Math.PI).toFixed(0)}°)`); lastPin = T.trimPin; }
    if (!T.tiltBlocked) tiltWarned = false;
    if (T.engine === "running" && !T.intakeSubmerged && T.tiltDeg > 5 && !intakeWarned && !T.capsized) { hud.showToast("Motor recolhido: sem água de refrigeração!"); intakeWarned = true; }
    if (T.intakeSubmerged) intakeWarned = false;

    fx.updateDrips(dtReal, V.skeg.getAbsolutePosition().clone(), T.propImmersion);
    if (T.gear !== lastGear) { audio.clunk(T.gear !== "N"); lastGear = T.gear; }
    audio.update({
      rpm: T.rpm, throttle: T.throttle, speed: Math.hypot(boat.vel.x, boat.vel.z), boil: Math.max(T.cavitation, 1 - T.ventilation),
      inGear: T.gear !== "N", propInWater: T.propImmersion > 0.5, revLimiter: T.revLimiter, cockpit: cam.mode === "cockpit", engine: T.engine, trimMotorA: T.trimMotorA, buzzer: T.buzzer, starterRpm: T.starterRpm, pullStart: T.pullStart,
    });
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

  // começa no menu com a prévia do barco (ou direto no jogo com ?barco=lancha|bote)
  activate(V.kind);
  if (urlKind === "lancha" || urlKind === "bote") startGame(); else showMenu();

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
    vessels, water, waterVis, fx, audio, world, scene, engine, cam, input, loadMs, startGame, showMenu,
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
