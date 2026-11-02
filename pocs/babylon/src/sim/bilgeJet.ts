// Jato da bomba de porão como LINHA DE EMISSÃO (o que o olho vê): gotas soltas em instantes diferentes, todas
// com a velocidade do barco. No referencial do barco elas saem pela mangueira (v = Q/A, para fora e um pouco
// para baixo), caem com a gravidade e o vento aparente as empurra para a popa. Sem Babylon (testável no Node).

import { type Vec3, v3 } from "./math.ts";

/**
 * Pontos do jato no referencial do barco, a cada `dt` s, até `tMax` ou até `stop(p)` (ex.: chegou à água).
 * @param outlet saída no costado (local); sx = +1 boreste, −1 bombordo
 * @param vOut   velocidade na mangueira (m/s)
 * @param gL     gravidade em eixos do barco
 * @param airL   velocidade do ar visto do barco (ar parado ⇒ −velocidade do barco), em eixos do barco
 */
export const jetStreakLocal = (outlet: Vec3, sx: number, vOut: number, gL: Vec3, airL: Vec3, stop: (p: Vec3) => boolean, dt = 0.01, tMax = 1, k = 1.2, dirL?: Vec3): Vec3[] => {
  const pts: Vec3[] = [];
  // sem `dirL`: sai pelo costado (para fora e um pouco para baixo); com `dirL` (unitário, local): nessa direção
  let p = { ...outlet }, v = dirL ? v3(dirL.x * vOut, dirL.y * vOut, dirL.z * vOut) : v3(sx * 0.98 * vOut, -0.17 * vOut, 0);
  for (let t = 0; t <= tMax; t += dt) {
    pts.push(p);
    if (t > 0 && stop(p)) break;
    v = v3(v.x + (gL.x + k * (airL.x - v.x)) * dt, v.y + (gL.y + k * (airL.y - v.y)) * dt, v.z + (gL.z + k * (airL.z - v.z)) * dt);
    p = v3(p.x + v.x * dt, p.y + v.y * dt, p.z + v.z * dt);
  }
  return pts;
};
