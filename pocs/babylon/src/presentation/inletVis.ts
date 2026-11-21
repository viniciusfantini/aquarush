// Boca do cânion no mar (v0.82): visual dos dois MOLHES de pedra (enrocamento de blocos grandes, irregulares,
// assentados no relevo de sim/world.ts → jettyHeight) e das torres de sinalização nas pontas (entrando do mar: a
// vermelha fica à direita — no molhe oeste — e a verde à esquerda). As ondas e a espuma da boca vêm do mar local
// (INLET_SEA) no shader da água; a correnteza, de INLET_CURRENTS. Só visual.

import { type Scene, Mesh, MeshBuilder, PBRMaterial, StandardMaterial, Color3, Matrix, Quaternion, Vector3, VertexBuffer } from "@babylonjs/core";
import { INLET, jettyHeight } from "../sim/world.ts";

/** gerador pseudoaleatório determinístico (o molhe sai sempre igual) */
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export const buildInlet = (scene: Scene): Mesh[] => {
  const out: Mesh[] = [];
  // bloco de pedra: icosfera amassada (facetada), granito cinza-escuro com manchas de água salgada
  const rock = MeshBuilder.CreateIcoSphere("inletRock", { radius: 1, subdivisions: 2, flat: true }, scene);
  {
    const pos = rock.getVerticesData(VertexBuffer.PositionKind)!;
    const r = rng(77);
    const bump = new Map<string, number>();
    for (let i = 0; i < pos.length; i += 3) {
      const key = `${pos[i].toFixed(3)},${pos[i + 1].toFixed(3)},${pos[i + 2].toFixed(3)}`;
      if (!bump.has(key)) bump.set(key, 0.72 + 0.4 * r());
      const k = bump.get(key)!;
      pos[i] *= k * 1.15; pos[i + 1] *= k * 0.78; pos[i + 2] *= k;
    }
    rock.updateVerticesData(VertexBuffer.PositionKind, pos);
    rock.refreshBoundingInfo();
  }
  const mat = new PBRMaterial("inletRockMat", scene);
  mat.albedoColor = new Color3(0.34, 0.32, 0.3); mat.metallic = 0; mat.roughness = 0.92;
  rock.material = mat; rock.isPickable = false; rock.receiveShadows = true;
  const r = rng(1234);
  const mats: number[] = [];
  const m = new Matrix();
  for (const s of [-1, 1]) {
    const xs = INLET.cx + s * INLET.half;
    for (let z = INLET.z0 - 6; z <= INLET.z1 + 9; z += 1.35) {
      // 3 a 5 blocos por seção: crista e os dois taludes
      for (let k = -2; k <= 2; k++) {
        if (Math.abs(k) === 2 && r() < 0.35) continue;
        const x = xs + k * 1.9 + (r() - 0.5) * 0.9, zz = z + (r() - 0.5) * 0.9;
        const top = jettyHeight(x, zz);
        if (!Number.isFinite(top) || top < -2.5) continue;
        const sz = 0.85 + 1.1 * r() * (k === 0 ? 1.15 : 1);
        const q = Quaternion.FromEulerAngles((r() - 0.5) * 0.8, r() * Math.PI * 2, (r() - 0.5) * 0.8);
        Matrix.ComposeToRef(new Vector3(sz, sz * (0.7 + 0.4 * r()), sz * (0.9 + 0.4 * r())), q, new Vector3(x, top - 0.35 * sz, zz), m);
        for (let i = 0; i < 16; i++) mats.push(m.m[i]);
      }
    }
  }
  rock.thinInstanceSetBuffer("matrix", new Float32Array(mats), 16, true);
  out.push(rock);
  // torres de sinalização nas pontas (concreto + lanterna acesa)
  const concrete = new PBRMaterial("inletTower", scene);
  concrete.albedoColor = new Color3(0.78, 0.77, 0.74); concrete.metallic = 0; concrete.roughness = 0.8;
  for (const [s, c] of [[-1, new Color3(1, 0.08, 0.05)], [1, new Color3(0.1, 1, 0.3)]] as [number, Color3][]) {
    const x = INLET.cx + s * INLET.half, z = INLET.z1 - 1, y0 = jettyHeight(x, z);
    const base = MeshBuilder.CreateCylinder("inletTowerBase", { height: 4.2, diameterTop: 1.0, diameterBottom: 1.6, tessellation: 12 }, scene);
    base.material = concrete; base.position.set(x, y0 + 2.0, z);
    const band = MeshBuilder.CreateCylinder("inletTowerBand", { height: 1.0, diameter: 1.08, tessellation: 12 }, scene);
    const bandMat = new PBRMaterial("inletBand" + s, scene); bandMat.albedoColor = c.scale(0.7); bandMat.metallic = 0; bandMat.roughness = 0.5;
    band.material = bandMat; band.position.set(x, y0 + 3.4, z);
    const lamp = MeshBuilder.CreateSphere("inletLamp", { diameter: 0.45, segments: 10 }, scene);
    const lm = new StandardMaterial("inletLampMat" + s, scene); lm.diffuseColor = c; lm.emissiveColor = c;
    lamp.material = lm; lamp.position.set(x, y0 + 4.45, z);
    for (const mm of [base, band, lamp]) { mm.isPickable = false; out.push(mm); }
  }
  return out;
};
