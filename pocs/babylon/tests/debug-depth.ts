// Profundidade ao redor do píer (lado leste: poitas). node tests/debug-depth.ts
import { groundHeight, buildWorld } from "../src/sim/world.ts";
const w = buildWorld();
console.log("píer", w.pier.shoreX, w.pier.shoreZ, "até z", w.pier.shoreZ + w.pier.length, "spawn", w.spawn);
let h = "z/x ";
for (let x = -10; x <= 80; x += 6) h += String(x).padStart(6);
console.log(h);
for (let z = -262; z <= -150; z += 8) {
  let r = String(z).padStart(5);
  for (let x = -10; x <= 80; x += 6) r += (-groundHeight(x, z)).toFixed(1).padStart(6);
  console.log(r);
}
