// POSTO NÁUTICO (v0.77): abastecer o barco na água, encostado na vaga do píer de abastecimento (a oeste do píer
// principal). Sem Babylon. Mesmo critério do posto da estrada: parado, encostado, motor desligado.

import type { Speedboat } from "./boat.ts";
import { type PierLayout, fuelBerth } from "./world.ts";

export interface FuelDockState {
  /** perto da vaga (mostra a dica) */
  near: boolean;
  /** pode abastecer agora */
  ok: boolean;
  /** por que ainda não (texto para o HUD) */
  why: string;
}

export const fuelDockState = (b: Speedboat, P: PierLayout): FuelDockState => {
  const B = fuelBerth(P);
  const dx = b.pos.x - B.x, dz = b.pos.z - B.z;
  const near = Math.abs(dx) < 8 && Math.abs(dz) < B.len;
  if (!near) return { near: false, ok: false, why: "" };
  // costado mais perto do píer: a meia-boca do barco a partir do centro
  const gap = b.pos.x - b.params.beam / 2 - B.edgeX;
  const speed = Math.hypot(b.vel.x, b.vel.z);
  if (Math.abs(dz) > B.len / 2) return { near, ok: false, why: "encoste ao lado da bomba (perto da ponta do píer)" };
  if (gap > 1.6) return { near, ok: false, why: "encoste no píer (a mangueira não alcança)" };
  if (speed > 0.6) return { near, ok: false, why: "pare o barco" };
  return { near, ok: true, why: "" };
};
