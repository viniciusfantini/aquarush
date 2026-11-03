// Entrada do cânion FECHADA por enquanto ("EM BREVE"): barreira flutuante de boias laranja atravessando o rio, com
// um cabo, e uma faixa entre dois mastros nas margens. O colisor é `CANYON_BOOM` (sim/world.ts, `buildWorld({ canyonClosed })`);
// aqui só o visual. A faixa fica de frente para o lago (quem vem do sul lê).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, Color3, DynamicTexture } from "@babylonjs/core";
import { CANYON_BOOM, groundHeight } from "../sim/world.ts";

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
