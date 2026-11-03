// "EM BREVE": a faixa listrada (textura reaproveitável) e a CACHOEIRA do fim do cânion.
// `buildComingSoon` (barreira de boias na entrada do cânion) ficou GUARDADA para outro uso (v0.66.1 não a monta).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, DynamicTexture, ParticleSystem, Texture, Vector3 } from "@babylonjs/core";
import { CANYON_BOOM, FALLS, groundHeight } from "../sim/world.ts";

export const buildComingSoon = (scene: Scene): Mesh[] => {
  const B = CANYON_BOOM, meshes: Mesh[] = [];
  // boias da barreira (meio afundadas) + o cabo que as une
  const buoyMat = new StandardMaterial("boomBuoy", scene);
  buoyMat.diffuseColor = new Color3(1, 0.42, 0.05); buoyMat.emissiveColor = new Color3(0.25, 0.08, 0); buoyMat.specularColor = new Color3(0.3, 0.3, 0.3);
  const base = MeshBuilder.CreateSphere("boomBuoyBase", { diameter: 0.9, segments: 10 }, scene);
  base.material = buoyMat; base.isVisible = false;
  const n = Math.round((B.half * 2) / 1.6);
  for (let i = 0; i <= n; i++) {
    const b = base.createInstance("boomBuoy" + i);
    b.position.set(B.x - B.half + (i * 2 * B.half) / n, 0.12, B.z);
    meshes.push(b as unknown as Mesh);
  }
  meshes.push(base);
  const ropeMat = new StandardMaterial("boomRope", scene); ropeMat.diffuseColor = new Color3(0.9, 0.85, 0.7);
  const rope = MeshBuilder.CreateCylinder("boomRope", { height: B.half * 2 + 6, diameter: 0.07, tessellation: 6 }, scene);
  rope.rotation.z = Math.PI / 2; rope.position.set(B.x, 0.35, B.z); rope.material = ropeMat; meshes.push(rope);

  // mastros nas margens e a faixa "EM BREVE"
  const poleMat = new StandardMaterial("boomPole", scene); poleMat.diffuseColor = new Color3(0.85, 0.85, 0.82);
  const span = B.half * 2 + 10, topY = 9;
  for (const sx of [-1, 1]) {
    const x = B.x + sx * span / 2, gy = Math.max(0, groundHeight(x, B.z));
    const pole = MeshBuilder.CreateCylinder("boomPoleM", { height: topY + 1 - gy + 2, diameter: 0.35, tessellation: 10 }, scene);
    pole.position.set(x, (topY + 1 + gy - 2) / 2 + 0.5, B.z); pole.material = poleMat; meshes.push(pole);
  }
  const W = 1024, H = 192;
  const tex = new DynamicTexture("comingSoonTex", { width: W, height: H }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = "#ffb020"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#111"; for (let x = -H; x < W; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 28, 0); ctx.lineTo(x + 28 + H * 0.35, 26); ctx.lineTo(x + H * 0.35, 26); ctx.fill(); ctx.beginPath(); ctx.moveTo(x, H - 26); ctx.lineTo(x + 28, H - 26); ctx.lineTo(x + 28 + H * 0.35, H); ctx.lineTo(x + H * 0.35, H); ctx.fill(); }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "900 92px Segoe UI, Arial, sans-serif"; ctx.fillText("EM BREVE", W / 2, H / 2 - 12);
  ctx.font = "700 26px Segoe UI, Arial, sans-serif"; ctx.fillText("O CÂNION E NOVAS ÁREAS CHEGAM NAS PRÓXIMAS ATUALIZAÇÕES", W / 2, H / 2 + 46);
  tex.update();
  const bannerMat = new StandardMaterial("comingSoonMat", scene);
  bannerMat.diffuseTexture = tex; bannerMat.emissiveColor = new Color3(0.35, 0.3, 0.2); bannerMat.specularColor = Color3.Black(); bannerMat.backFaceCulling = false;
  const banner = MeshBuilder.CreatePlane("comingSoonBanner", { width: span - 0.6, height: (span - 0.6) * H / W }, scene);
  banner.position.set(B.x, topY - 0.6, B.z); banner.material = bannerMat;
  // (o plano da Babylon já mostra a frente para quem olha em +Z — quem vem do lago, ao sul)
  meshes.push(banner);
  return meshes;
};

/** Material da faixa listrada amarela/preta com um título grande e uma linha menor (dupla face). */
export const comingSoonMaterial = (scene: Scene, title: string, sub: string, name = "comingSoonMat"): StandardMaterial => {
  const W = 1024, H = 192;
  const tex = new DynamicTexture(name + "Tex", { width: W, height: H }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = "#ffb020"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#111";
  for (let x = -H; x < W; x += 64) {
    for (const y0 of [0, H - 26]) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + 28, y0); ctx.lineTo(x + 28 + 9, y0 + 26); ctx.lineTo(x + 9, y0 + 26); ctx.fill(); }
  }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "900 88px Segoe UI, Arial, sans-serif"; ctx.fillText(title, W / 2, H / 2 - 14);
  ctx.font = "700 25px Segoe UI, Arial, sans-serif"; ctx.fillText(sub, W / 2, H / 2 + 44);
  tex.update();
  const m = new StandardMaterial(name, scene);
  m.diffuseTexture = tex; m.emissiveColor = new Color3(0.35, 0.3, 0.2); m.specularColor = Color3.Black(); m.backFaceCulling = false;
  return m;
};

/**
 * Cachoeira do fim do cânion: paredão de pedra, lâmina d'água caindo (textura que escorre), a água do rio em cima,
 * espuma e névoa na base. Devolve as malhas (para reflexo/sombra) — a animação roda sozinha no `onBeforeRender`.
 */
export const buildWaterfall = (scene: Scene): Mesh[] => {
  const F = FALLS, meshes: Mesh[] = [];
  const rock = new StandardMaterial("fallsRock", scene);
  rock.diffuseColor = new Color3(0.42, 0.38, 0.33); rock.specularColor = new Color3(0.05, 0.05, 0.05);
  // paredão (atrás da lâmina) e as duas "ombreiras" laterais
  const wall = MeshBuilder.CreateBox("fallsWall", { width: 64, height: F.top + 4, depth: 30 }, scene);
  wall.position.set(F.x, (F.top - 4) / 2, F.z + 16); wall.material = rock; meshes.push(wall);
  // lâmina d'água: faixas claras escorrendo para baixo
  // estrias finas e longas, com degradê nas pontas (repete na vertical sem emenda)
  const T = 512, TH = 1024;
  const wt = new DynamicTexture("fallsTex", { width: T, height: TH }, scene, true);
  const c = wt.getContext() as unknown as CanvasRenderingContext2D;
  c.fillStyle = "rgba(170,205,225,0.55)"; c.fillRect(0, 0, T, TH); // véu de água contínuo
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * T, len = 120 + Math.random() * 420, y = Math.random() * TH, a = 0.18 + Math.random() * 0.55, w = 0.6 + Math.random() * 2.2;
    for (const yy of [y, y - TH]) {
      const g = c.createLinearGradient(0, yy, 0, yy + len);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.35, `rgba(240,248,255,${a})`); g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g; c.fillRect(x, yy, w, len);
    }
  }
  wt.hasAlpha = true; wt.wrapV = Texture.WRAP_ADDRESSMODE; wt.update();
  const sheetMat = new StandardMaterial("fallsSheet", scene);
  sheetMat.diffuseTexture = wt; sheetMat.useAlphaFromDiffuseTexture = true; sheetMat.emissiveColor = new Color3(0.55, 0.65, 0.72);
  sheetMat.diffuseColor = new Color3(0.8, 0.9, 1); sheetMat.specularColor = new Color3(0.3, 0.3, 0.3); sheetMat.backFaceCulling = false;
  (sheetMat.diffuseTexture as Texture).vScale = 1.2;
  const base = new StandardMaterial("fallsBase", scene); base.diffuseColor = new Color3(0.55, 0.7, 0.78); base.alpha = 0.7; base.emissiveColor = new Color3(0.25, 0.32, 0.36);
  const back = MeshBuilder.CreatePlane("fallsBack", { width: F.width, height: F.top }, scene);
  back.position.set(F.x, F.top / 2, F.z + 0.9); back.material = base; meshes.push(back);
  const sheet = MeshBuilder.CreatePlane("fallsSheet", { width: F.width, height: F.top }, scene);
  sheet.position.set(F.x, F.top / 2, F.z + 0.4); sheet.material = sheetMat; meshes.push(sheet);
  // rio em cima do paredão
  const topW = MeshBuilder.CreateGround("fallsTop", { width: F.width, height: 26 }, scene);
  topW.position.set(F.x, F.top + 0.05, F.z + 14); topW.material = base; meshes.push(topW);
  scene.onBeforeRenderObservable.add(() => { (sheetMat.diffuseTexture as Texture).vOffset += scene.getEngine().getDeltaTime() / 1000 * 1.6; });
  // espuma e névoa na base
  const puff = new DynamicTexture("fallsPuff", { width: 64, height: 64 }, scene, false);
  const pc = puff.getContext() as unknown as CanvasRenderingContext2D;
  const g = pc.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
  pc.fillStyle = g; pc.fillRect(0, 0, 64, 64); puff.hasAlpha = true; puff.update();
  const mist = new ParticleSystem("fallsMist", 900, scene);
  mist.particleTexture = puff;
  mist.emitter = new Vector3(F.x, 0.4, F.z - 1);
  mist.minEmitBox = new Vector3(-F.width / 2, 0, -1); mist.maxEmitBox = new Vector3(F.width / 2, 0.5, 1);
  mist.color1 = new Color4(1, 1, 1, 0.55); mist.color2 = new Color4(0.85, 0.92, 1, 0.4); mist.colorDead = new Color4(1, 1, 1, 0);
  mist.minSize = 1.5; mist.maxSize = 4.5; mist.minLifeTime = 1.2; mist.maxLifeTime = 3;
  mist.emitRate = 260; mist.direction1 = new Vector3(-1.2, 1.4, -2.5); mist.direction2 = new Vector3(1.2, 3.2, -0.6);
  mist.minEmitPower = 0.6; mist.maxEmitPower = 1.6; mist.gravity = new Vector3(0, 0.15, 0);
  mist.blendMode = ParticleSystem.BLENDMODE_STANDARD; mist.start();
  // espuma: mancha branca de bordas suaves (a textura radial da névoa) espalhada na base da queda
  const foamMat = new StandardMaterial("fallsFoam", scene); foamMat.diffuseTexture = puff; foamMat.useAlphaFromDiffuseTexture = true;
  foamMat.diffuseColor = new Color3(1, 1, 1); foamMat.emissiveColor = new Color3(0.75, 0.78, 0.8); foamMat.specularColor = Color3.Black(); foamMat.alpha = 0.85;
  const foam = MeshBuilder.CreateGround("fallsFoamDisc", { width: F.width + 14, height: 20 }, scene);
  foam.position.set(F.x, 0.08, F.z - 6); foam.material = foamMat; meshes.push(foam);
  for (const m of meshes) m.isPickable = false;
  return meshes;
};
