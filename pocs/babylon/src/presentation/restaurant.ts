// Bar & Restaurante da marina (centralizado com o píer): casa de madeira pintada com telhado de telha,
// varanda de deck com guarda-corpo, pérgola com cordão de luzes, mesas com guarda-sóis listrados, balcão
// externo com banquetas, toldo listrado, vasos de plantas e lousa de cardápio. Tudo procedural.
// Fachada voltada para o lago (+Z). (x, y, z) = centro da casa no chão.

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, DynamicTexture, Texture } from "@babylonjs/core";
import { signMat } from "./station.ts";

const tex = (scene: Scene, name: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, uS = 1, vS = 1): Texture => {
  const t = new DynamicTexture(name, { width: w, height: h }, scene, true);
  draw(t.getContext() as CanvasRenderingContext2D);
  t.update();
  t.uScale = uS; t.vScale = vS;
  return t;
};

export const buildRestaurant = (scene: Scene, x: number, y: number, z: number): Mesh[] => {
  const meshes: Mesh[] = [];
  const mat = (name: string, c: Color3, spec = 0.05, t?: Texture) => { const m = new StandardMaterial(name, scene); m.diffuseColor = c; m.specularColor = new Color3(spec, spec, spec); if (t) m.diffuseTexture = t; return m; };
  const add = <M extends Mesh>(m: M, material: StandardMaterial, px: number, py: number, pz: number): M => { m.material = material; m.position.set(px, py, pz); m.isPickable = false; m.receiveShadows = true; meshes.push(m); return m; };
  const box = (name: string, w: number, h: number, d: number, m: StandardMaterial, px: number, py: number, pz: number) => add(MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene), m, px, py, pz);

  // ---- materiais ----
  const siding = mat("rSiding", new Color3(1, 1, 1), 0.05, tex(scene, "rSidingTex", 256, 256, (c) => {
    c.fillStyle = "#e8e0c9"; c.fillRect(0, 0, 256, 256);
    for (let yy = 0; yy < 256; yy += 21) { c.fillStyle = "rgba(120,100,70,0.35)"; c.fillRect(0, yy, 256, 2); c.fillStyle = "rgba(255,255,255,0.25)"; c.fillRect(0, yy + 2, 256, 2); }
  }, 3, 2));
  const trim = mat("rTrim", new Color3(0.97, 0.97, 0.95), 0.2);
  const teal = mat("rTeal", new Color3(0.08, 0.45, 0.5), 0.1);
  const tile = mat("rTile", new Color3(1, 1, 1), 0.08, tex(scene, "rTileTex", 256, 256, (c) => {
    c.fillStyle = "#a8381f"; c.fillRect(0, 0, 256, 256);
    for (let yy = 0; yy < 256; yy += 32) { c.fillStyle = "rgba(60,15,5,0.45)"; c.fillRect(0, yy + 26, 256, 6); for (let xx = (yy / 32) % 2 ? 16 : 0; xx < 256; xx += 32) { c.fillStyle = "rgba(255,170,120,0.18)"; c.fillRect(xx + 4, yy + 4, 22, 18); } }
  }, 4, 3));
  const deckM = mat("rDeck", new Color3(1, 1, 1), 0.05, tex(scene, "rDeckTex", 256, 256, (c) => {
    c.fillStyle = "#9b6b43"; c.fillRect(0, 0, 256, 256);
    for (let xx = 0; xx < 256; xx += 32) { c.fillStyle = "rgba(50,30,15,0.5)"; c.fillRect(xx, 0, 3, 256); }
    for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(${120 + Math.random() * 40},${80 + Math.random() * 30},50,0.25)`; c.fillRect(Math.random() * 256, Math.random() * 256, 1, 8); }
  }, 4, 2));
  const darkWood = mat("rDarkWood", new Color3(0.36, 0.24, 0.14));
  const glass = mat("rGlass", new Color3(0.16, 0.24, 0.28), 0.9); glass.alpha = 0.85;
  const white = mat("rWhite", new Color3(0.95, 0.95, 0.93), 0.1);
  const stripes = (name: string, a: string, b: string) => mat(name, new Color3(1, 1, 1), 0.02, tex(scene, name + "Tex", 128, 128, (c) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? a : b; c.fillRect(i * 16, 0, 16, 128); } }));
  const awningM = stripes("rAwning", "#0f6e74", "#f4efe3"); awningM.backFaceCulling = false;
  const umbM = stripes("rUmb", "#e2571c", "#f6f1e6"); umbM.backFaceCulling = false;
  const plant = mat("rPlant", new Color3(0.2, 0.45, 0.18)), pot = mat("rPot", new Color3(0.62, 0.32, 0.2));
  const bulb = new StandardMaterial("rBulb", scene); bulb.emissiveColor = new Color3(1, 0.85, 0.5); bulb.diffuseColor = new Color3(1, 0.9, 0.6);
  const metal = mat("rMetal", new Color3(0.2, 0.2, 0.22), 0.4);

  // ---- casa (9 × 6 m) ----
  const W = 9, D = 6, H = 3.3, front = z + D / 2;
  box("rHouse", W, H, D, siding, x, y + H / 2, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box("rCorner", 0.18, H, 0.18, trim, x + sx * W / 2, y + H / 2, z + sz * D / 2);
  box("rBase", W + 0.1, 0.35, D + 0.1, mat("rBaseM", new Color3(0.55, 0.53, 0.5)), x, y + 0.17, z);
  // telhado de duas águas com beiral (cumeeira ao longo de X)
  const slope = 0.42, halfSpan = D / 2 + 0.8, rh = halfSpan * Math.tan(slope);
  for (const s of [-1, 1]) {
    const r = box("rRoof", W + 1.2, 0.12, halfSpan / Math.cos(slope) + 0.1, tile, x, y + H + rh / 2, z + s * halfSpan / 2);
    r.rotation.x = s * slope;
  }
  box("rRidge", W + 1.3, 0.16, 0.22, mat("rRidgeM", new Color3(0.45, 0.15, 0.08)), x, y + H + rh + 0.02, z);
  // oitões (triângulos das laterais, sob as águas do telhado)
  const gh = (D / 2) * Math.tan(slope);
  for (const s of [-1, 1]) {
    const gx = x + s * (W / 2);
    const g = MeshBuilder.CreateRibbon("rGable", { pathArray: [[new Vector3(gx, y + H, z - D / 2), new Vector3(gx, y + H, z + D / 2)], [new Vector3(gx, y + H + gh, z), new Vector3(gx, y + H + gh, z)]], sideOrientation: Mesh.DOUBLESIDE }, scene);
    add(g, siding, 0, 0, 0);
  }
  // janelas grandes com moldura e venezianas, porta dupla de vidro
  for (const dx of [-3, 3]) {
    box("rWinFrame", 2.0, 1.5, 0.08, trim, x + dx, y + 1.75, front + 0.03);
    box("rWinGlass", 1.8, 1.3, 0.08, glass, x + dx, y + 1.75, front + 0.05);
    box("rWinBar", 0.06, 1.3, 0.1, trim, x + dx, y + 1.75, front + 0.06);
    box("rWinSill", 2.2, 0.08, 0.25, trim, x + dx, y + 0.98, front + 0.12);
    for (const s of [-1, 1]) box("rShutter", 0.55, 1.5, 0.05, teal, x + dx + s * 1.33, y + 1.75, front + 0.05);
  }
  box("rDoorFrame", 1.9, 2.4, 0.08, trim, x, y + 1.35, front + 0.03);
  for (const s of [-1, 1]) box("rDoorGlass", 0.8, 2.15, 0.08, glass, x + s * 0.42, y + 1.3, front + 0.05);
  // toldo listrado sobre a fachada
  const aw = MeshBuilder.CreatePlane("rAwningM", { width: W - 0.6, height: 1.4 }, scene);
  add(aw, awningM, x, y + 2.75, front + 0.6); aw.rotation.x = Math.PI / 2 - 0.55; aw.rotation.y = Math.PI;
  // letreiro na faixa acima do toldo
  // letreiro na beira do telhado (acima da pérgola), com suportes
  const sign = MeshBuilder.CreatePlane("barSign", { width: 5.6, height: 0.8 }, scene);
  add(sign, signMat(scene, "barSignT", "BAR & RESTAURANTE", "peixe frito · porções · drinks", "#5a1d10", "#ffd8a8", 1024, 160), x, y + H + 0.62, front + 0.95);
  sign.rotation.y = Math.PI;
  for (const s of [-2.2, 2.2]) box("rSignPost", 0.06, 0.7, 0.06, metal, x + s, y + H + 0.3, front + 0.97);

  // ---- varanda: deck, degraus, guarda-corpo (abertura central para o píer) ----
  const DW = 12, DD = 5.5, dz0 = front + DD / 2, dY = y + 0.35;
  box("barDeck", DW, 0.2, DD, deckM, x, dY - 0.1, dz0);
  for (let k = 0; k < 2; k++) box("rStep", 2.4, 0.18, 0.4, deckM, x, dY - 0.2 - k * 0.12, front + DD + 0.2 + k * 0.4);
  const railY = dY + 0.95;
  const rails: [number, number, number, number][] = [ // x0, z0, x1, z1
    [x - DW / 2, front + 0.2, x - DW / 2, front + DD], [x + DW / 2, front + 0.2, x + DW / 2, front + DD],
    [x - DW / 2, front + DD, x - 1.3, front + DD], [x + 1.3, front + DD, x + DW / 2, front + DD],
  ];
  for (const [x0, z0, x1, z1] of rails) {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
    const top = box("rRail", 0.08, 0.08, len, white, (x0 + x1) / 2, railY, (z0 + z1) / 2); top.rotation.y = ang;
    const mid = box("rRailMid", 0.04, 0.04, len, white, (x0 + x1) / 2, railY - 0.45, (z0 + z1) / 2); mid.rotation.y = ang;
    const n = Math.max(1, Math.round(len / 1.4));
    for (let i = 0; i <= n; i++) box("rRailPost", 0.1, 0.95, 0.1, white, x0 + (x1 - x0) * (i / n), dY + 0.47, z0 + (z1 - z0) * (i / n));
  }
  // pérgola sobre metade da varanda (lado oeste) com cordão de luzes
  const pgX0 = x - DW / 2 + 0.3, pgX1 = x - 0.5, pgZ0 = front + 0.4, pgZ1 = front + DD - 0.3, pgH = dY + 2.6;
  for (const px of [pgX0, pgX1]) for (const pz of [pgZ0, pgZ1]) box("rPergPost", 0.16, pgH - dY, 0.16, darkWood, px, (pgH + dY) / 2, pz);
  for (const pz of [pgZ0, pgZ1]) box("rPergBeam", pgX1 - pgX0 + 0.6, 0.18, 0.12, darkWood, (pgX0 + pgX1) / 2, pgH, pz);
  for (let i = 0; i <= 8; i++) box("rPergSlat", 0.08, 0.1, pgZ1 - pgZ0 + 0.5, darkWood, pgX0 + (pgX1 - pgX0) * (i / 8), pgH + 0.12, (pgZ0 + pgZ1) / 2);
  for (const pz of [pgZ0 + 1.2, pgZ1 - 1.2]) for (let i = 0; i <= 10; i++) {
    const t = i / 10, sag = 0.35 * Math.sin(Math.PI * t);
    add(MeshBuilder.CreateSphere("rBulb", { diameter: 0.09, segments: 6 }, scene), bulb, pgX0 + (pgX1 - pgX0) * t, pgH - 0.1 - sag, pz);
  }
  // mesas: 2 sob a pérgola, 2 com guarda-sol listrado do lado leste
  const table = (tx: number, tz: number, umb: boolean) => {
    add(MeshBuilder.CreateCylinder("barTableTop", { height: 0.05, diameter: 1.0, tessellation: 20 }, scene), white, tx, dY + 0.75, tz);
    add(MeshBuilder.CreateCylinder("barTableLeg", { height: 0.72, diameter: 0.07 }, scene), metal, tx, dY + 0.38, tz);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4, cx = tx + Math.sin(a) * 0.8, cz = tz + Math.cos(a) * 0.8;
      box("barChairSeat", 0.44, 0.06, 0.44, darkWood, cx, dY + 0.45, cz);
      const back = box("barChairBack", 0.44, 0.45, 0.05, darkWood, cx + Math.sin(a) * 0.2, dY + 0.7, cz + Math.cos(a) * 0.2); back.rotation.y = a;
      for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) box("barChairLeg", 0.04, 0.45, 0.04, metal, cx + lx, dY + 0.22, cz + lz);
    }
    if (umb) {
      add(MeshBuilder.CreateCylinder("umbPole", { height: 2.3, diameter: 0.05 }, scene), white, tx, dY + 1.2, tz);
      const u = add(MeshBuilder.CreateCylinder("umbrellaTop", { height: 0.5, diameterTop: 0.06, diameterBottom: 2.6, tessellation: 16 }, scene), umbM, tx, dY + 2.3, tz);
      void u;
    }
  };
  table(x - 4.2, front + 2.2, false); table(x - 1.8, front + 3.8, false);
  table(x + 2.2, front + 2.0, true); table(x + 4.4, front + 3.8, true);
  // balcão externo com banquetas (lateral leste da casa)
  box("rCounter", 0.6, 1.05, 3.2, darkWood, x + W / 2 + 0.6, dY + 0.52, z + 0.6);
  box("rCounterTop", 0.8, 0.06, 3.4, white, x + W / 2 + 0.6, dY + 1.07, z + 0.6);
  for (let k = 0; k < 3; k++) {
    add(MeshBuilder.CreateCylinder("rStool", { height: 0.06, diameter: 0.36 }, scene), teal, x + W / 2 + 1.3, dY + 0.75, z - 0.4 + k * 1.0);
    add(MeshBuilder.CreateCylinder("rStoolLeg", { height: 0.72, diameter: 0.05 }, scene), metal, x + W / 2 + 1.3, dY + 0.37, z - 0.4 + k * 1.0);
  }
  // deck lateral sob o balcão
  box("barDeckSide", 2.4, 0.2, D, deckM, x + W / 2 + 1.2, dY - 0.1, z);
  // vasos com plantas e lousa de cardápio
  for (const [px, pz] of [[x - DW / 2 + 0.5, front + DD - 0.5], [x + DW / 2 - 0.5, front + DD - 0.5], [x - 1.7, front + DD - 0.4], [x + 1.7, front + DD - 0.4]] as const) {
    add(MeshBuilder.CreateCylinder("rPot", { height: 0.5, diameterTop: 0.55, diameterBottom: 0.4, tessellation: 12 }, scene), pot, px, dY + 0.25, pz);
    add(MeshBuilder.CreateSphere("rBush", { diameter: 0.75, segments: 8 }, scene), plant, px, dY + 0.75, pz);
  }
  const board = MeshBuilder.CreatePlane("rMenuBoard", { width: 0.7, height: 0.95 }, scene);
  add(board, (() => {
    const m = new StandardMaterial("rMenuMat", scene); m.specularColor = Color3.Black();
    m.diffuseTexture = tex(scene, "rMenuTex", 256, 360, (c) => {
      c.fillStyle = "#1f2a24"; c.fillRect(0, 0, 256, 360); c.strokeStyle = "#8a6a44"; c.lineWidth = 14; c.strokeRect(0, 0, 256, 360);
      c.fillStyle = "#f2f2e8"; c.textAlign = "center"; c.font = "bold 36px Arial"; c.fillText("HOJE", 128, 60);
      c.font = "24px Arial"; ["Tilápia frita", "Isca de peixe", "Porção de camarão", "Caipirinha", "Chopp gelado"].forEach((t, i) => c.fillText(t, 128, 115 + i * 46));
    });
    return m;
  })(), x + 1.9, dY + 0.9, front + DD + 0.6);
  board.rotation.y = Math.PI; board.rotation.x = -0.15;
  // luminárias de poste nas pontas do guarda-corpo
  for (const s of [-1, 1]) {
    box("rLampPost", 0.08, 1.6, 0.08, metal, x + s * 1.3, dY + 0.8, front + DD);
    add(MeshBuilder.CreateSphere("rLampGlobe", { diameter: 0.26, segments: 10 }, scene), bulb, x + s * 1.3, dY + 1.7, front + DD);
  }
  return meshes;
};
