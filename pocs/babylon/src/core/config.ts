// Core: configuração e perfis de qualidade (GDD A.11: baixo / médio / alto).
// Selecionável por URL: ?q=low|med|high  ·  ?webgpu=1  ·  ?touch=1 (força controles touch)

export type QualityName = "low" | "med" | "high";

export interface Quality {
  name: QualityName;
  maxPixelRatio: number;     // resolução máxima em pixels físicos por pixel CSS (telas retina: 2–3)
  minPixelRatio: number;     // piso da resolução dinâmica (cai se o FPS não segurar)
  waterResolution: number;   // vértices por lado da grade de água
  depthEffects: boolean;     // transparência/espuma de margem via depth map
  shadows: number;           // 0 = sem sombras; senão, tamanho do shadow map
  particles: number;
  wakeTexture: number;       // px do mapa de esteira
  reflection: number;        // px do reflexo planar (0 = desligado)
  terrainSubdiv: number;
  trees: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: { name: "low", maxPixelRatio: 1.5, minPixelRatio: 0.75, waterResolution: 128, depthEffects: false, shadows: 0, particles: 500, wakeTexture: 384, reflection: 0, terrainSubdiv: 160, trees: 500 },
  med: { name: "med", maxPixelRatio: 2, minPixelRatio: 1, waterResolution: 192, depthEffects: true, shadows: 1024, particles: 1200, wakeTexture: 768, reflection: 512, terrainSubdiv: 256, trees: 1200 },
  high: { name: "high", maxPixelRatio: 2.5, minPixelRatio: 1.25, waterResolution: 256, depthEffects: true, shadows: 2048, particles: 2400, wakeTexture: 1024, reflection: 1024, terrainSubdiv: 360, trees: 2200 },
};

export const PHYSICS_DT = 1 / 120;
export const MAX_SUBSTEPS = 10;

export const readUrlConfig = () => {
  const p = new URLSearchParams(location.search);
  const isMobile = matchMedia("(pointer: coarse)").matches;
  // iPhone/iPad (inclui iPadOS que se apresenta como Mac): GPU forte → "med" (reflexo, espuma, sombras).
  // Outros celulares começam em "low". Em todos, a resolução dinâmica garante o FPS (main.ts).
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const q = (p.get("q") as QualityName) || (isIOS ? "med" : isMobile ? "low" : "med");
  return {
    quality: QUALITY[q] ?? QUALITY.med,
    webgpu: p.get("webgpu") === "1",
    isMobile,
    isIOS,
  };
};
