// Perfil da margem sul perto do píer (para posicionar a rampa). node tests/debug-shore.ts
import { groundHeight, buildWorld } from "../src/sim/world.ts";
const w = buildWorld();
console.log("pier", w.pier.shoreX.toFixed(1), w.pier.shoreZ.toFixed(1), "spawn", w.spawn);
for (const x of [-34, -28, -22, -16]) {
  let row = `x=${x}: `;
  for (let z = w.pier.shoreZ - 30; z <= w.pier.shoreZ + 24; z += 4) row += `${z.toFixed(0)}:${groundHeight(x, z).toFixed(1)} `;
  console.log(row);
}
