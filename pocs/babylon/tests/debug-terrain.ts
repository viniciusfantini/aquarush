// Mapa de alturas atrás da praia sul (para traçar a estrada e o pátio). node tests/debug-terrain.ts
import { groundHeight, RAMP } from "../src/sim/world.ts";
console.log("rampa", RAMP.x, RAMP.z0.toFixed(1), "topo s=-16 z=", (RAMP.z0 - 16).toFixed(1));
let hdr = "z/x ";
for (let x = -260; x <= 140; x += 20) hdr += String(x).padStart(5);
console.log(hdr);
for (let z = -270; z >= -450; z -= 12) {
  let row = String(z).padStart(5);
  for (let x = -260; x <= 140; x += 20) row += groundHeight(x, z).toFixed(0).padStart(5);
  console.log(row);
}
