// Water Rendering: superfície do lago com as MESMAS ondas de Gerstner da física
// (sim/water.ts -> shaderParams). Grade que acompanha a câmera (encaixada em passos
// fixos para não "nadar"), com resolução decrescente para longe. Reflexo analítico do céu,
// especular do sol, espuma nas cristas e na margem (via depth map), fresnel e neblina.

import {
  type Scene, type Camera, Mesh, VertexData, ShaderMaterial, Effect, Vector2, Vector3, Color3, type DepthRenderer, Constants,
} from "@babylonjs/core";
import type { GerstnerWater } from "../sim/water.ts";

const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 uCamPos;
uniform vec2 uGridOffset;
uniform float uTime;
uniform vec4 wA[4];
uniform vec4 wB[4];
uniform vec2 uFade;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vHeight;
void main() {
  vec2 p0 = position.xz + uGridOffset;
  float dist = length(p0 - uCamPos.xz);
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, dist);
  vec3 disp = vec3(0.0);
  vec3 dPdx = vec3(1.0, 0.0, 0.0);
  vec3 dPdz = vec3(0.0, 0.0, 1.0);
  for (int i = 0; i < 4; i++) {
    vec2 dir = wA[i].xy; float k = wA[i].z; float c = wA[i].w;
    float amp = wB[i].x * fade; float qa = wB[i].y * fade; float ph = wB[i].z;
    float f = k * (dot(dir, p0) - c * uTime) + ph;
    float cf = cos(f); float sf = sin(f);
    disp.x += qa * dir.x * cf;
    disp.z += qa * dir.y * cf;
    disp.y += amp * sf;
    dPdx += vec3(-qa * dir.x * dir.x * k * sf, amp * k * dir.x * cf, -qa * dir.x * dir.y * k * sf);
    dPdz += vec3(-qa * dir.x * dir.y * k * sf, amp * k * dir.y * cf, -qa * dir.y * dir.y * k * sf);
  }
  vec3 world = vec3(p0.x + disp.x, disp.y, p0.y + disp.z);
  vNormal = normalize(cross(dPdz, dPdx));
  // Jacobiano < 1 => compressão horizontal => crista (espuma)
  float J = dPdx.x * dPdz.z - dPdx.z * dPdz.x;
  vFoam = clamp((0.82 - J) * 3.0, 0.0, 1.0);
  vHeight = disp.y;
  vWorld = world;
  gl_Position = viewProjection * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uUseDepth;
uniform sampler2D uDepthMap;
uniform vec2 uScreen;
uniform vec2 uNearFar;
uniform vec3 uCamFwd;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vHeight;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// ondulações finas (só visuais) para quebrar o reflexo
vec3 detailNormal(vec2 p, float dist) {
  float s = 1.0 - smoothstep(20.0, 160.0, dist);
  vec2 q1 = p * 0.9 + vec2(uTime * 0.35, uTime * 0.21);
  vec2 q2 = p * 2.3 - vec2(uTime * 0.27, -uTime * 0.4);
  float e = 0.07;
  float h0 = noise(q1) + 0.5 * noise(q2);
  float hx = noise(q1 + vec2(e, 0)) + 0.5 * noise(q2 + vec2(e, 0) * 2.55);
  float hz = noise(q1 + vec2(0, e)) + 0.5 * noise(q2 + vec2(0, e) * 2.55);
  return vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.12 * s;
}

void main() {
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 N = normalize(vNormal + detailNormal(vWorld.xz, dist));

  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  float spec = pow(max(dot(R, uSunDir), 0.0), 380.0) * 7.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.25;

  // espessura de água até o fundo/objetos (depth map da cena) -> cor rasa, transparência e espuma de margem
  float thickness = 50.0;
  if (uUseDepth > 0.5) {
    vec2 uv = gl_FragCoord.xy / uScreen;
    float d = texture2D(uDepthMap, uv).r;
    float sceneDepth = d * (uNearFar.x + uNearFar.y) - uNearFar.x;
    float waterDepth = dot(vWorld - uCamPos, uCamFwd);
    thickness = max(sceneDepth - waterDepth, 0.0);
  }
  float shallowF = exp(-thickness * 0.35);
  // dispersão subsuperficial nas cristas iluminadas por trás
  float sss = pow(max(dot(V, -uSunDir), 0.0), 4.0) * clamp(vHeight * 2.5 + 0.3, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, clamp(shallowF + vHeight * 0.35 + 0.15, 0.0, 1.0));
  body += vec3(0.0, 0.25, 0.22) * sss * 0.6;
  float diffuse = clamp(dot(N, uSunDir), 0.0, 1.0) * 0.25 + 0.75;
  vec3 col = mix(body * diffuse, sky, fres) + uSunColor * spec;

  // espuma: cristas + margem
  float foamNoise = noise(vWorld.xz * 1.7 + uTime * 0.2) * noise(vWorld.xz * 0.6 - uTime * 0.1);
  float shoreFoam = (1.0 - smoothstep(0.0, 0.9, thickness)) * smoothstep(0.15, 0.6, foamNoise + 0.35 * sin(thickness * 9.0 - uTime * 2.0));
  float foam = clamp(vFoam * smoothstep(0.25, 0.7, foamNoise * 1.6) + shoreFoam, 0.0, 1.0);
  col = mix(col, vec3(0.95, 0.97, 1.0) * (0.75 + 0.25 * diffuse), foam * 0.85);

  float alpha = mix(clamp(1.0 - exp(-thickness * 1.3), 0.0, 1.0), 1.0, fres);
  alpha = max(alpha, foam * 0.9);

  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, mix(alpha, 1.0, fog));
}
`;

Effect.ShadersStore["aquaWaterVertexShader"] = VERT;
Effect.ShadersStore["aquaWaterFragmentShader"] = FRAG;

export interface WaterVisualOptions {
  resolution: number; // vértices por lado
  innerExtent: number; // termo linear do mapeamento (m)
  outerExtent: number; // alcance total (m)
  depth: DepthRenderer | null;
}

/** Grade com espaçamento crescente: g(t) = a·t + b·t³ (t ∈ [-1, 1]). */
const buildGrid = (scene: Scene, n: number, a: number, total: number): Mesh => {
  const b = total - a;
  const coords: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 2 - 1;
    coords.push(a * t + b * t * t * t);
  }
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) positions.push(coords[i], 0, coords[j]);
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const p = j * n + i;
      indices.push(p, p + n, p + 1, p + 1, p + n, p + n + 1);
    }
  }
  const mesh = new Mesh("water", scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.applyToMesh(mesh, false);
  mesh.alwaysSelectAsActiveMesh = true; // deslocamento é no shader
  return mesh;
};

export class WaterVisual {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private readonly spacing: number;
  private readonly depth: DepthRenderer | null;

  sunDir = new Vector3(0.4, 0.6, 0.5).normalize();
  sunColor = new Color3(1.0, 0.95, 0.85);
  deep = new Color3(0.02, 0.13, 0.17);
  shallow = new Color3(0.1, 0.42, 0.42);
  skyHorizon = new Color3(0.72, 0.82, 0.9);
  skyZenith = new Color3(0.25, 0.48, 0.8);
  fogColor = new Color3(0.72, 0.8, 0.86);
  fogDensity = 0.0009;

  constructor(scene: Scene, opts: WaterVisualOptions) {
    const inner = opts.innerExtent;
    this.mesh = buildGrid(scene, opts.resolution, inner, opts.outerExtent);
    this.spacing = (inner * 2) / (opts.resolution - 1);
    this.depth = opts.depth;
    this.material = new ShaderMaterial("waterMat", scene, { vertex: "aquaWater", fragment: "aquaWater" }, {
      attributes: ["position"],
      uniforms: [
        "viewProjection", "uCamPos", "uGridOffset", "uTime", "wA", "wB", "uFade", "uSunDir", "uSunColor", "uDeep",
        "uShallow", "uSkyHorizon", "uSkyZenith", "uFogColor", "uFogDensity", "uUseDepth", "uScreen", "uNearFar", "uCamFwd",
      ],
      samplers: ["uDepthMap"],
      needAlphaBlending: true,
    });
    this.material.backFaceCulling = false;
    this.material.alphaMode = Constants.ALPHA_COMBINE;
    this.mesh.material = this.material;
    if (this.depth) {
      this.material.setTexture("uDepthMap", this.depth.getDepthMap());
    }
  }

  update(water: GerstnerWater, camera: Camera, screenW: number, screenH: number): void {
    const cam = camera.globalPosition;
    const s = this.spacing;
    const ox = Math.round(cam.x / s) * s;
    const oz = Math.round(cam.z / s) * s;
    const m = this.material;
    const p = water.shaderParams();
    m.setVector3("uCamPos", cam);
    m.setVector2("uGridOffset", new Vector2(ox, oz));
    m.setFloat("uTime", water.time);
    m.setArray4("wA", p.a);
    m.setArray4("wB", p.b);
    m.setVector2("uFade", new Vector2(160, 420));
    m.setVector3("uSunDir", this.sunDir);
    m.setColor3("uSunColor", this.sunColor);
    m.setColor3("uDeep", this.deep);
    m.setColor3("uShallow", this.shallow);
    m.setColor3("uSkyHorizon", this.skyHorizon);
    m.setColor3("uSkyZenith", this.skyZenith);
    m.setColor3("uFogColor", this.fogColor);
    m.setFloat("uFogDensity", this.fogDensity);
    m.setFloat("uUseDepth", this.depth ? 1 : 0);
    m.setVector2("uScreen", new Vector2(screenW, screenH));
    m.setVector2("uNearFar", new Vector2(camera.minZ, camera.maxZ));
    m.setVector3("uCamFwd", camera.getForwardRay(1).direction);
  }
}
