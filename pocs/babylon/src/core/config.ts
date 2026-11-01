// Core: configuração e perfis de qualidade (GDD A.11: baixo / médio / alto).
// Selecionável por URL: ?q=low|med|high  ·  ?webgpu=1  ·  ?touch=1 (força controles touch)

export type QualityName = "low" | "med" | "high";

export interface Quality {
  name: QualityName;
  hardwareScaling: number;   // >1 = renderiza em resolução menor
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
  low: { name: "low", hardwareScaling: 1.5, waterResolution: 128, depthEffects: false, shadows: 0, particles: 500, wakeTexture: 256, reflection: 0, terrainSubdiv: 160, trees: 500 },
  med: { name: "med", hardwareScaling: 1, waterResolution: 192, depthEffects: true, shadows: 1024, particles: 1200, wakeTexture: 512, reflection: 512, terrainSubdiv: 256, trees: 1200 },
  high: { name: "high", hardwareScaling: 1, waterResolution: 256, depthEffects: true, shadows: 2048, particles: 2400, wakeTexture: 512, reflection: 1024, terrainSubdiv: 360, trees: 2200 },
};

export const PHYSICS_DT = 1 / 120;
export const MAX_SUBSTEPS = 10;

export const readUrlConfig = () => {
  const p = new URLSearchParams(location.search);
  const isMobile = matchMedia("(pointer: coarse)").matches;
  const q = (p.get("q") as QualityName) || (isMobile ? "low" : "med");
  return {
    quality: QUALITY[q] ?? QUALITY.med,
    webgpu: p.get("webgpu") === "1",
    isMobile,
  };
};
