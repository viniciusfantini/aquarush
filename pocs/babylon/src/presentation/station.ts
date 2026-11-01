// Estrada (rampa → pátio), pátio de estacionamento, posto de combustível, loja e oficina.
// A estrada e o pátio têm malhas próprias que seguem EXATAMENTE o relevo da física (groundHeight):
// asfalto + uma "saia" de terreno nas laterais (a malha geral do terreno é grossa e fica rebaixada sob elas).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, PBRMaterial, Color3, Vector3, DynamicTexture, Texture, VertexBuffer } from "@babylonjs/core";
import { groundHeight, ROAD, ROAD_SAMPLES, LOT, fbm, lotDistance } from "../sim/world.ts";
import { STATION } from "../sim/station.ts";
import { pbr, roundedBox } from "./boatMesh.ts";
import { smoothstep } from "../sim/math.ts";

/** Faixa extra de terreno ao lado da estrada/pátio (cobre a malha grossa rebaixada). */
export const skirtWidth = (terrainSubdiv: number) => 4 + 2600 / terrainSubdiv * 1.4;

const grassColor = (x: number, z: number, h: number): Color3 => {
  const grass = new Color3(0.3, 0.45, 0.2), dark = new Color3(0.18, 0.32, 0.13), sand = new Color3(0.76, 0.69, 0.52);
  const n = fbm(x / 30, z / 30, 2) * 0.5 + 0.5;
  return Color3.Lerp(sand, Color3.Lerp(grass, dark, n), smoothstep(1.2, 2.4, h));
};

const asphaltTex = (scene: Scene, name: string, lines: "road" | "lot"): DynamicTexture => {
  const t = new DynamicTexture(name, { width: 256, height: 512 }, scene, true);
  const c = t.getContext() as CanvasRenderingContext2D;
  c.fillStyle = "#3a3c3e"; c.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 6000; i++) { const v = 40 + Math.random() * 40; c.fillStyle = `rgba(${v},${v},${v + 4},0.5)`; c.fillRect(Math.random() * 256, Math.random() * 512, 2, 2); }
  if (lines === "road") {
    c.fillStyle = "#e8e8e2"; c.fillRect(8, 0, 7, 512); c.fillRect(241, 0, 7, 512);   // bordas
    c.fillStyle = "#e9c03a"; for (let y = 0; y < 512; y += 128) c.fillRect(124, y, 8, 70); // eixo tracejado
  }
  t.update();
  t.wrapU = Texture.WRAP_ADDRESSMODE; t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
};

/** Placa com texto (fundo + letras), em material emissivo leve. */
export const signMat = (scene: Scene, name: string, title: string, sub = "", bg = "#0d4f8b", fg = "#ffffff", w = 512, h = 160): StandardMaterial => {
  const t = new DynamicTexture(name, { width: w, height: h }, scene, true);
  const c = t.getContext() as CanvasRenderingContext2D;
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.fillStyle = fg; c.textAlign = "center"; c.textBaseline = "middle";
  // fonte encolhe até o texto caber na placa (sem cortar as pontas)
  const fit = (txt: string, size: number, weight: string) => { let f = size; do { c.font = `${weight} ${Math.round(f)}px Arial`; f *= 0.93; } while (c.measureText(txt).width > w * 0.92 && f > 8); };
  fit(title, h * (sub ? 0.42 : 0.55), "bold");
  c.fillText(title, w / 2, sub ? h * 0.38 : h / 2);
  if (sub) { fit(sub, h * 0.2, ""); c.fillText(sub, w / 2, h * 0.78); }
  t.update();
  const m = new StandardMaterial(name + "Mat", scene);
  m.diffuseTexture = t; m.emissiveColor = new Color3(0.25, 0.25, 0.25); m.specularColor = Color3.Black();
  return m;
};

/** Estrada + pátio (asfalto e saias de terreno). */
export const buildRoadAndLot = (scene: Scene, terrainSubdiv: number): Mesh[] => {
  const meshes: Mesh[] = [];
  // a estrada visual termina na borda do pátio (dentro dele vale o asfalto do pátio, sem faixas)
  const S = ROAD_SAMPLES.filter((p) => lotDistance(p.x, p.z) > 0.3), hw = ROAD.halfWidth, skirt = ROAD.shoulder + skirtWidth(terrainSubdiv);
  // ---- saia de terreno da estrada (segue o relevo da física; cores do terreno) ----
  const offs = [-hw - skirt, -hw - skirt * 0.6, -hw - skirt * 0.3, -hw - ROAD.shoulder, -hw - 0.6, 0, hw + 0.6, hw + ROAD.shoulder, hw + skirt * 0.3, hw + skirt * 0.6, hw + skirt];
  const rows = S.map((p) => offs.map((o) => { const x = p.x - p.dz * o, z = p.z + p.dx * o; return new Vector3(x, groundHeight(x, z) + 0.02, z); }));
  const sk = MeshBuilder.CreateRibbon("roadSkirt", { pathArray: rows, sideOrientation: Mesh.DOUBLESIDE }, scene);
  const pos = sk.getVerticesData(VertexBuffer.PositionKind)!;
  const col: number[] = [];
  for (let i = 0; i < pos.length; i += 3) { const c = grassColor(pos[i], pos[i + 2], pos[i + 1]); col.push(c.r, c.g, c.b, 1); }
  sk.setVerticesData(VertexBuffer.ColorKind, col);
  const skMat = new StandardMaterial("roadSkirtMat", scene); skMat.specularColor = new Color3(0.04, 0.04, 0.04);
  sk.material = skMat; meshes.push(sk);
  // ---- asfalto da estrada ----
  const ar = S.map((p) => [-hw, -hw / 2, 0, hw / 2, hw].map((o) => { const x = p.x - p.dz * o, z = p.z + p.dx * o; return new Vector3(x, groundHeight(x, z) + 0.05, z); }));
  const road = MeshBuilder.CreateRibbon("road", { pathArray: ar, sideOrientation: Mesh.DOUBLESIDE }, scene);
  const roadMat = new PBRMaterial("asphalt", scene);
  roadMat.albedoTexture = asphaltTex(scene, "roadTex", "road"); roadMat.metallic = 0; roadMat.roughness = 0.85; roadMat.environmentIntensity = 0.4;
  road.material = roadMat;
  const uv = road.getVerticesData("uv")!;
  for (let i = 0; i < uv.length; i += 2) uv[i + 1] *= S.length / 8; // ~8 m por repetição
  road.setVerticesData("uv", uv);
  meshes.push(road);
  // ---- pátio: saia + asfalto plano ----
  const m = skirtWidth(terrainSubdiv) + 6, N = 24;
  const lotRows: Vector3[][] = [];
  for (let i = 0; i <= N; i++) {
    const z = LOT.cz - LOT.hz - m + (2 * (LOT.hz + m)) * (i / N);
    const row: Vector3[] = [];
    for (let j = 0; j <= N; j++) { const x = LOT.cx - LOT.hx - m + (2 * (LOT.hx + m)) * (j / N); row.push(new Vector3(x, groundHeight(x, z) + 0.02, z)); }
    lotRows.push(row);
  }
  const lsk = MeshBuilder.CreateRibbon("lotSkirt", { pathArray: lotRows, sideOrientation: Mesh.DOUBLESIDE }, scene);
  const lp = lsk.getVerticesData(VertexBuffer.PositionKind)!;
  const lc: number[] = [];
  for (let i = 0; i < lp.length; i += 3) { const c = grassColor(lp[i], lp[i + 2], lp[i + 1]); lc.push(c.r, c.g, c.b, 1); }
  lsk.setVerticesData(VertexBuffer.ColorKind, lc);
  lsk.material = skMat; meshes.push(lsk);
  const lot = MeshBuilder.CreateGround("lot", { width: LOT.hx * 2, height: LOT.hz * 2 }, scene);
  lot.position.set(LOT.cx, LOT.y + 0.05, LOT.cz);
  const lotMat = new PBRMaterial("lotAsphalt", scene);
  const lt = asphaltTex(scene, "lotTex", "lot"); lt.uScale = LOT.hx / 4; lt.vScale = LOT.hz / 8;
  lotMat.albedoTexture = lt; lotMat.metallic = 0; lotMat.roughness = 0.85; lotMat.environmentIntensity = 0.4;
  lot.material = lotMat; meshes.push(lot);
  // vagas pintadas (faixa sul do pátio) + faixa de pedestre na loja
  const paint = new StandardMaterial("paint", scene); paint.diffuseColor = new Color3(0.92, 0.92, 0.88); paint.specularColor = Color3.Black();
  for (let k = 0; k < 4; k++) {
    const z = LOT.cz - LOT.hz + 1 + k * 4.2;
    const st = MeshBuilder.CreateGround("stall", { width: 18, height: 0.15 }, scene);
    st.position.set(LOT.cx + 14, LOT.y + 0.06, z); st.material = paint; meshes.push(st);
  }
  for (const mm of meshes) { mm.isPickable = false; mm.receiveShadows = true; }
  return meshes;
};

/** Posto (cobertura, ilhas, bombas, totem), loja de conveniência e oficina. */
export const buildStation = (scene: Scene): Mesh[] => {
  const meshes: Mesh[] = [];
  const Y = LOT.y + 0.05;
  const add = <M extends Mesh>(m: M, mat: StandardMaterial | PBRMaterial): M => { m.material = mat; m.isPickable = false; meshes.push(m); return m; };
  const white = pbr(scene, "stWhite", new Color3(0.93, 0.93, 0.92), 0, 0.5);
  const red = pbr(scene, "stRed", new Color3(0.78, 0.1, 0.08), 0, 0.45);
  const grey = pbr(scene, "stGrey", new Color3(0.55, 0.56, 0.57), 0.2, 0.6);
  const dark = pbr(scene, "stDark", new Color3(0.12, 0.13, 0.14), 0, 0.5);
  const concrete = pbr(scene, "stConcrete", new Color3(0.7, 0.69, 0.66), 0, 0.85);
  const glass = pbr(scene, "stGlass", new Color3(0.25, 0.35, 0.4), 0, 0.05); glass.alpha = 0.55;
  const wall = pbr(scene, "stWall", new Color3(0.85, 0.82, 0.74), 0, 0.8);
  const brick = pbr(scene, "stBrick", new Color3(0.55, 0.3, 0.22), 0, 0.85);
  const lightM = new StandardMaterial("stLight", scene); lightM.emissiveColor = new Color3(0.9, 0.9, 0.85); lightM.diffuseColor = Color3.White();
  // ---- cobertura do posto ----
  const C = STATION.canopy;
  const roof = add(MeshBuilder.CreateBox("canopy", { width: C.w, height: 0.5, depth: C.d }, scene), white); roof.position.set(C.x, Y + C.h, C.z);
  for (const [w, d, dx, dz] of [[C.w + 0.05, 0.05, 0, C.d / 2], [C.w + 0.05, 0.05, 0, -C.d / 2], [0.05, C.d, C.w / 2, 0], [0.05, C.d, -C.w / 2, 0]] as const) {
    add(MeshBuilder.CreateBox("canopyBand", { width: w, height: 0.55, depth: d }, scene), red).position.set(C.x + dx, Y + C.h, C.z + dz);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(MeshBuilder.CreateBox("canopyCol", { width: 0.4, height: C.h, depth: 0.4 }, scene), white).position.set(C.x + sx * (C.w / 2 - 0.4), Y + C.h / 2, C.z + sz * (C.d / 2 - 0.4));
  for (let k = -1; k <= 1; k++) add(MeshBuilder.CreateBox("canopyLamp", { width: 1.6, height: 0.05, depth: 0.5 }, scene), lightM).position.set(C.x + k * 4.5, Y + C.h - 0.27, C.z);
  const canopySign = add(MeshBuilder.CreatePlane("canopySign", { width: 6, height: 0.5 }, scene), signMat(scene, "canopySignT", "POSTO · COMBUSTÍVEL", "", "#c0171c", "#fff", 1024, 90));
  canopySign.position.set(C.x + C.w / 2 + 0.04, Y + C.h, C.z); canopySign.rotation.y = -Math.PI / 2;
  // ---- ilhas e bombas ----
  for (const p of STATION.pumps) {
    add(MeshBuilder.CreateBox("island", { width: STATION.islandLen, height: 0.22, depth: STATION.islandW }, scene), concrete).position.set(p.x, Y + 0.11, p.z);
    const body = add(roundedBox("pump", scene, 0.7, 1.7, 0.45, 0.06), white); body.position.set(p.x, Y + 0.22 + 0.85, p.z);
    for (const sz of [-1, 1]) {
      const disp = add(MeshBuilder.CreatePlane("pumpDisplay", { width: 0.45, height: 0.3 }, scene), signMat(scene, "pumpDisp" + p.z + sz, "0,00", "LITROS", "#0b1d12", "#7dff9a", 256, 160));
      disp.position.set(p.x, Y + 1.55, p.z + sz * 0.235); disp.rotation.y = sz > 0 ? Math.PI : 0;
      add(MeshBuilder.CreateBox("pumpBand", { width: 0.72, height: 0.18, depth: 0.47 }, scene), red).position.set(p.x, Y + 1.95, p.z);
      // mangueira e bico
      const hose = add(MeshBuilder.CreateTube("hose", { path: [new Vector3(p.x + 0.3, Y + 1.3, p.z + sz * 0.2), new Vector3(p.x + 0.5, Y + 0.6, p.z + sz * 0.35), new Vector3(p.x + 0.4, Y + 1.0, p.z + sz * 0.3)], radius: 0.025, tessellation: 6 }, scene), dark);
      void hose;
      add(MeshBuilder.CreateBox("nozzle", { width: 0.06, height: 0.2, depth: 0.08 }, scene), dark).position.set(p.x + 0.4, Y + 1.05, p.z + sz * 0.3);
    }
  }
  // ---- totem de preços na entrada ----
  const totem = add(MeshBuilder.CreatePlane("priceTotem", { width: 1.6, height: 2.4, sideOrientation: Mesh.DOUBLESIDE }, scene), (() => {
    const t = new DynamicTexture("priceTex", { width: 256, height: 384 }, scene, true);
    const c = t.getContext() as CanvasRenderingContext2D;
    c.fillStyle = "#c0171c"; c.fillRect(0, 0, 256, 384); c.fillStyle = "#fff"; c.textAlign = "center";
    c.font = "bold 44px Arial"; c.fillText("POSTO", 128, 60);
    c.fillStyle = "#111"; c.fillRect(16, 100, 224, 260); c.fillStyle = "#ffd34d"; c.font = "bold 26px Arial";
    c.fillText("GASOLINA", 128, 150); c.font = "bold 44px Arial"; c.fillText("6,29", 128, 200);
    c.font = "bold 26px Arial"; c.fillText("ÁLCOOL", 128, 260); c.font = "bold 44px Arial"; c.fillText("4,59", 128, 310);
    t.update();
    const m = new StandardMaterial("priceMat", scene); m.diffuseTexture = t; m.emissiveColor = new Color3(0.3, 0.3, 0.3); m.specularColor = Color3.Black();
    return m;
  })());
  totem.position.set(LOT.cx + LOT.hx - 1, Y + 3.6, LOT.cz + LOT.hz - 2); totem.rotation.y = Math.PI / 2;
  add(MeshBuilder.CreateBox("totemPole", { width: 0.25, height: 2.4, depth: 0.25 }, scene), grey).position.set(LOT.cx + LOT.hx - 1, Y + 1.2, LOT.cz + LOT.hz - 2);
  // ---- loja de conveniência (fachada de vidro para +X) ----
  const sh = STATION.shop;
  add(MeshBuilder.CreateBox("shop", { width: sh.w, height: sh.h, depth: sh.d }, scene), wall).position.set(sh.x, Y + sh.h / 2, sh.z);
  add(MeshBuilder.CreateBox("shopRoof", { width: sh.w + 0.8, height: 0.3, depth: sh.d + 0.8 }, scene), dark).position.set(sh.x, Y + sh.h + 0.15, sh.z);
  const sf = add(MeshBuilder.CreatePlane("shopGlass", { width: sh.d - 2, height: sh.h - 1.2 }, scene), glass); sf.position.set(sh.x + sh.w / 2 + 0.02, Y + (sh.h - 1.2) / 2 + 0.2, sh.z); sf.rotation.y = -Math.PI / 2;
  const ss = add(MeshBuilder.CreatePlane("shopSign", { width: 6, height: 0.9 }, scene), signMat(scene, "shopSignT", "LOJA", "conveniência · 24 h", "#1d6b3a"));
  ss.position.set(sh.x + sh.w / 2 + 0.05, Y + sh.h - 0.35, sh.z); ss.rotation.y = -Math.PI / 2;
  // ---- oficina (portões para +X) ----
  const wk = STATION.workshop;
  add(MeshBuilder.CreateBox("workshop", { width: wk.w, height: wk.h, depth: wk.d }, scene), brick).position.set(wk.x, Y + wk.h / 2, wk.z);
  add(MeshBuilder.CreateBox("workshopRoof", { width: wk.w + 0.6, height: 0.3, depth: wk.d + 0.6 }, scene), grey).position.set(wk.x, Y + wk.h + 0.15, wk.z);
  for (const dz of [-2.8, 2.8]) {
    const door = add(MeshBuilder.CreatePlane("workshopDoor", { width: 4.2, height: 3.6 }, scene), (() => {
      const t = new DynamicTexture("doorTex" + dz, { width: 128, height: 128 }, scene, true);
      const c = t.getContext() as CanvasRenderingContext2D;
      c.fillStyle = "#8a8f94"; c.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 8) { c.fillStyle = "#6c7176"; c.fillRect(0, y, 128, 2); }
      t.update();
      const m = new StandardMaterial("doorMat" + dz, scene); m.diffuseTexture = t; m.specularColor = new Color3(0.1, 0.1, 0.1);
      return m;
    })());
    door.position.set(wk.x + wk.w / 2 + 0.02, Y + 1.8, wk.z + dz); door.rotation.y = -Math.PI / 2;
  }
  const ws = add(MeshBuilder.CreatePlane("workshopSign", { width: 7, height: 1.0 }, scene), signMat(scene, "wsSignT", "OFICINA", "náutica e mecânica", "#2b2f33", "#ffd34d"));
  ws.position.set(wk.x + wk.w / 2 + 0.05, Y + wk.h - 0.5, wk.z); ws.rotation.y = -Math.PI / 2;
  // pilha de pneus ao lado da oficina
  for (let k = 0; k < 4; k++) {
    const tire = add(MeshBuilder.CreateTorus("tireStack", { diameter: 0.6, thickness: 0.2, tessellation: 16 }, scene), dark);
    tire.position.set(wk.x + wk.w / 2 + 1.2, Y + 0.1 + k * 0.2, wk.z + wk.d / 2 - 1);
  }
  for (const mm of meshes) mm.receiveShadows = true;
  return meshes;
};
