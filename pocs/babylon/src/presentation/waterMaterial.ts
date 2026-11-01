// Water Rendering: superfície do lago com as MESMAS ondas de Gerstner da física
// (sim/water.ts → shaderParams), mais:
//  • mapa de esteira (wakeMap.ts): desloca a superfície, perturba a normal e gera espuma;
//  • reflexo planar real (render target espelhado), distorcido pela normal; fallback = céu analítico;
//  • espessura de água via depth map (cor rasa, transparência e espuma de margem);
//  • ondulações finas controláveis (0 = água vidro / "glass").

import {
  type Scene, type Camera, type AbstractMesh, Mesh, VertexData, ShaderMaterial, Effect, Vector2, Vector3, Color3,
  type DepthRenderer, Constants, RenderTargetTexture, Matrix, Plane, Texture,
} from "@babylonjs/core";
import type { GerstnerWater } from "../sim/water.ts";
import { type WakeMap, WAKE_HEIGHT_SCALE } from "./wakeMap.ts";

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
uniform sampler2D uWake;
uniform vec3 uWakeInfo; // originX, originZ, worldSize
uniform float uWakeHeight;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vHeight;

float wakeH(vec2 xz) {
  vec2 uv = (xz - uWakeInfo.xy) / uWakeInfo.z + 0.5;
  vec2 e = smoothstep(0.0, 0.08, uv) * smoothstep(0.0, 0.08, 1.0 - uv);
  vec4 t = texture2D(uWake, uv);
  return (t.g - t.b) * uWakeHeight * e.x * e.y;
}

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
  world.y += wakeH(world.xz);
  vNormal = normalize(cross(dPdz, dPdx));
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
uniform float uUnder;
uniform float uTime;
uniform float uRipple;
uniform float uWhitecaps;
uniform vec2 uWindDir;
uniform float uUseDepth;
uniform sampler2D uDepthMap;
uniform vec2 uScreen;
uniform vec2 uNearFar;
uniform vec3 uCamFwd;
uniform sampler2D uWake;
uniform vec3 uWakeInfo;
uniform float uWakeHeight;
uniform float uWakeTexel;
uniform float uUseRefl;
uniform sampler2D uRefl;
uniform mat4 uReflVP;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vHeight;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return 0.5 * noise(p) + 0.3 * noise(p * 2.1 + 3.7) + 0.2 * noise(p * 4.3 - 1.3); }

// ondulações finas (só visuais); uRipple = 0 deixa a água como vidro
vec3 detailNormal(vec2 p, float dist) {
  float s = (1.0 - smoothstep(20.0, 160.0, dist)) * uRipple;
  if (s < 0.001) return vec3(0.0);
  vec2 q1 = p * 0.9 + vec2(uTime * 0.35, uTime * 0.21);
  vec2 q2 = p * 2.3 - vec2(uTime * 0.27, -uTime * 0.4);
  float e = 0.07;
  float h0 = noise(q1) + 0.5 * noise(q2);
  float hx = noise(q1 + vec2(e, 0)) + 0.5 * noise(q2 + vec2(e, 0) * 2.55);
  float hz = noise(q1 + vec2(0, e)) + 0.5 * noise(q2 + vec2(0, e) * 2.55);
  return vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.12 * s;
}

vec4 wakeTex(vec2 xz) { return texture2D(uWake, (xz - uWakeInfo.xy) / uWakeInfo.z + 0.5); }
float wakeEdge(vec2 xz) {
  vec2 uv = (xz - uWakeInfo.xy) / uWakeInfo.z + 0.5;
  vec2 e = smoothstep(0.0, 0.08, uv) * smoothstep(0.0, 0.08, 1.0 - uv);
  return e.x * e.y;
}

void main() {
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // ---- esteira: normal a partir do gradiente de altura + espuma ----
  float px = uWakeTexel;
  float we = wakeEdge(vWorld.xz);
  vec4 w0 = wakeTex(vWorld.xz);
  float hL = wakeTex(vWorld.xz - vec2(px, 0.0)).g - wakeTex(vWorld.xz - vec2(px, 0.0)).b;
  float hR = wakeTex(vWorld.xz + vec2(px, 0.0)).g - wakeTex(vWorld.xz + vec2(px, 0.0)).b;
  float hB = wakeTex(vWorld.xz - vec2(0.0, px)).g - wakeTex(vWorld.xz - vec2(0.0, px)).b;
  float hF = wakeTex(vWorld.xz + vec2(0.0, px)).g - wakeTex(vWorld.xz + vec2(0.0, px)).b;
  vec2 wGrad = vec2(hR - hL, hF - hB) * uWakeHeight / (2.0 * px) * we;
  float wakeFoam = w0.r * we;
  // turbulência: a água revolvida também enruga a superfície
  vec2 turb = (vec2(noise(vWorld.xz * 3.1 + uTime * 1.7), noise(vWorld.xz * 3.1 - uTime * 1.3)) - 0.5) * wakeFoam * 0.9;

  vec3 N = normalize(vNormal + detailNormal(vWorld.xz, dist) + vec3(-wGrad.x + turb.x, 0.0, -wGrad.y + turb.y));

  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  vec3 refl = sky;
  if (uUseRefl > 0.5) {
    vec4 rp = uReflVP * vec4(vWorld.x, 0.0, vWorld.z, 1.0);
    vec2 ruv = rp.xy / rp.w * 0.5 + 0.5;
    ruv += N.xz * 0.06 * clamp(12.0 / (dist + 4.0), 0.25, 1.0);
    vec4 rs = texture2D(uRefl, clamp(ruv, 0.001, 0.999));
    refl = mix(sky, rs.rgb, rs.a);
  }
  float spec = pow(max(dot(R, uSunDir), 0.0), 380.0) * 7.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.25;

  float thickness = 50.0;
  if (uUseDepth > 0.5) {
    vec2 uv = gl_FragCoord.xy / uScreen;
    float d = texture2D(uDepthMap, uv).r;
    float sceneDepth = d * (uNearFar.x + uNearFar.y) - uNearFar.x;
    float waterDepth = dot(vWorld - uCamPos, uCamFwd);
    thickness = max(sceneDepth - waterDepth, 0.0);
  }
  float shallowF = exp(-thickness * 0.35);
  float sss = pow(max(dot(V, -uSunDir), 0.0), 4.0) * clamp(vHeight * 2.5 + 0.3, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, clamp(shallowF + vHeight * 0.35 + 0.15, 0.0, 1.0));
  body += vec3(0.0, 0.25, 0.22) * sss * 0.6;
  // água aerada (bolhas sob a espuma) fica turquesa clara
  body = mix(body, vec3(0.42, 0.72, 0.72), clamp(wakeFoam * 1.4, 0.0, 0.8));
  float diffuse = clamp(dot(N, uSunDir), 0.0, 1.0) * 0.25 + 0.75;
  vec3 col = mix(body * diffuse, refl, fres) + uSunColor * spec * (1.0 - clamp(wakeFoam * 2.0, 0.0, 1.0));

  // espuma: cristas + margem + esteira (quebrada por ruído em duas escalas)
  float n1 = fbm(vWorld.xz * 1.6 + vec2(uTime * 0.15, -uTime * 0.1));
  float n2 = noise(vWorld.xz * 6.5 - uTime * 0.6);
  float foamNoise = noise(vWorld.xz * 1.7 + uTime * 0.2) * noise(vWorld.xz * 0.6 - uTime * 0.1);
  float shoreFoam = (1.0 - smoothstep(0.0, 0.9, thickness)) * smoothstep(0.15, 0.6, foamNoise + 0.35 * sin(thickness * 9.0 - uTime * 2.0));
  float wf = smoothstep(0.22, 0.95, wakeFoam * (0.35 + 1.1 * n1) + (n2 - 0.5) * 0.45 * wakeFoam) * (0.75 + 0.25 * n2);
  // carneirinhos (vento): manchas de espuma que nascem, andam a favor do vento e se desfazem — sem mudar as ondas
  float wc = 0.0;
  if (uWhitecaps > 0.001) {
    // alongados no sentido do vento (escala menor ao longo dele)
    vec2 wa = vec2(dot(vWorld.xz, uWindDir) * 0.22, dot(vWorld.xz, vec2(-uWindDir.y, uWindDir.x)) * 0.45);
    vec2 wp = wa - vec2(uTime * 0.12, 0.0);
    vec2 cellId = floor(wp * 0.5);
    float life = 0.5 + 0.5 * sin(uTime * (0.9 + hash(cellId) * 0.8) + hash(cellId + 7.3) * 6.2832);
    float patchN = noise(wp) * noise(wp * 2.3 + 5.1);
    float th = mix(0.62, 0.34, uWhitecaps);
    wc = smoothstep(th, th + 0.07, patchN * (0.55 + 0.75 * life));
    // borda rendada e estrias na direção do vento
    float streak = noise(vec2(dot(vWorld.xz, uWindDir) * 0.6, dot(vWorld.xz, vec2(-uWindDir.y, uWindDir.x)) * 3.5) - uTime * 0.4);
    wc *= (0.55 + 0.45 * noise(vWorld.xz * 4.5 + uTime * 0.8)) * (0.7 + 0.3 * streak);
    wc *= smoothstep(0.4, 1.6, thickness); // não na beira
  }
  float foam = clamp(vFoam * smoothstep(0.25, 0.7, foamNoise * 1.6) + shoreFoam + wf + wc * 0.95, 0.0, 1.0);
  col = mix(col, vec3(0.96, 0.98, 1.0) * (0.78 + 0.22 * diffuse), foam * 0.9);

  float alpha = mix(clamp(1.0 - exp(-thickness * 1.3), 0.0, 1.0), 1.0, fres);
  alpha = max(alpha, foam * 0.92);
  alpha = max(alpha, clamp(wakeFoam * 0.8, 0.0, 0.7));

  if (uUnder > 0.5) {
    // vista de BAIXO: dentro da janela de Snell (~48,6° da vertical) passa a claridade do céu, ondulando; fora dela
    // há reflexão interna total (a superfície espelha o fundo escuro). A espuma aparece como manchas claras.
    vec3 Nd = -N;
    float c = clamp(dot(Nd, V), 0.0, 1.0);                 // cosseno do ângulo com a vertical (para cima)
    float win = smoothstep(0.62, 0.72, c);
    vec3 skyU = mix(uSkyHorizon, uSkyZenith, 0.5) * (1.15 + 0.35 * c) + uSunColor * pow(c, 24.0) * 0.6;
    vec3 tir = uDeep * 0.9 + vec3(0.0, 0.05, 0.05);
    col = mix(tir, skyU, win);
    col = mix(col, vec3(0.75, 0.85, 0.86), foam * 0.6);
    alpha = 0.97;
  }
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, mix(alpha, 1.0, fog));
}
`;

Effect.ShadersStore["aquaWaterVertexShader"] = VERT;
Effect.ShadersStore["aquaWaterFragmentShader"] = FRAG;

export interface WaterVisualOptions {
  resolution: number;
  innerExtent: number;
  outerExtent: number;
  depth: DepthRenderer | null;
  wake: WakeMap;
  reflectionSize: number; // 0 = sem reflexo planar
}

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
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
};

export class WaterVisual {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly reflection: RenderTargetTexture | null = null;
  private readonly spacing: number;
  private readonly depth: DepthRenderer | null;
  private readonly wake: WakeMap;
  private readonly reflView = new Matrix();
  private readonly reflVP = new Matrix();
  private readonly mirror = Matrix.Reflection(new Plane(0, 1, 0, 0));

  sunDir = new Vector3(0.4, 0.6, 0.5).normalize();
  sunColor = new Color3(1.0, 0.95, 0.85);
  deep = new Color3(0.02, 0.13, 0.17);
  shallow = new Color3(0.1, 0.42, 0.42);
  skyHorizon = new Color3(0.72, 0.82, 0.9);
  skyZenith = new Color3(0.25, 0.48, 0.8);
  fogColor = new Color3(0.72, 0.8, 0.86);
  fogDensity = 0.0009;
  /** Intensidade das ondulações finas (0 = vidro). */
  ripple = 1;
  /** Carneirinhos do vento (0 = nenhum, 1 = tempestade) e direção para onde o vento sopra (XZ, unitária). */
  whitecaps = 0;
  /** câmera abaixo da superfície (o shader desenha a superfície vista por baixo) */
  under = false;
  windDir = new Vector2(0, 1);

  constructor(scene: Scene, opts: WaterVisualOptions) {
    const inner = opts.innerExtent;
    this.mesh = buildGrid(scene, opts.resolution, inner, opts.outerExtent);
    this.mesh.alphaIndex = 10; // depois da "tampa" do cockpit (alphaIndex 0)
    this.spacing = (inner * 2) / (opts.resolution - 1);
    this.depth = opts.depth;
    this.wake = opts.wake;
    this.material = new ShaderMaterial("waterMat", scene, { vertex: "aquaWater", fragment: "aquaWater" }, {
      attributes: ["position"],
      uniforms: [
        "viewProjection", "uCamPos", "uGridOffset", "uTime", "wA", "wB", "uFade", "uSunDir", "uSunColor", "uDeep",
        "uShallow", "uSkyHorizon", "uSkyZenith", "uFogColor", "uFogDensity", "uUseDepth", "uScreen", "uNearFar", "uCamFwd",
        "uRipple", "uUnder", "uWhitecaps", "uWindDir", "uWakeInfo", "uWakeHeight", "uWakeTexel", "uUseRefl", "uReflVP",
      ],
      samplers: ["uDepthMap", "uWake", "uRefl"],
      needAlphaBlending: true,
    });
    this.material.backFaceCulling = false;
    this.material.alphaMode = Constants.ALPHA_COMBINE;
    this.mesh.material = this.material;
    if (this.depth) this.material.setTexture("uDepthMap", this.depth.getDepthMap());
    this.material.setTexture("uWake", this.wake.texture);

    if (opts.reflectionSize > 0) {
      const rtt = new RenderTargetTexture("waterReflection", opts.reflectionSize, scene, false, true);
      rtt.wrapU = rtt.wrapV = Texture.CLAMP_ADDRESSMODE;
      rtt.renderParticles = false;
      rtt.refreshRate = 1;
      scene.customRenderTargets.push(rtt);
      let savedView: Matrix | null = null;
      let savedClip: Plane | null = null;
      const engine = scene.getEngine() as unknown as { cullBackFaces: boolean | null };
      rtt.onBeforeRenderObservable.add(() => {
        savedView = scene.getViewMatrix().clone();
        this.mirror.multiplyToRef(savedView, this.reflView);
        scene.setTransformMatrix(this.reflView, scene.getProjectionMatrix());
        savedClip = scene.clipPlane;
        scene.clipPlane = new Plane(0, -1, 0, -0.05); // descarta o que está abaixo d'água
        engine.cullBackFaces = false;
        const cam = scene.activeCamera;
        if (cam) (scene as unknown as { _mirroredCameraPosition: Vector3 | null })._mirroredCameraPosition = Vector3.TransformCoordinates(cam.globalPosition, this.mirror);
      });
      rtt.onAfterRenderObservable.add(() => {
        if (savedView) scene.setTransformMatrix(savedView, scene.getProjectionMatrix());
        scene.clipPlane = savedClip;
        engine.cullBackFaces = null;
        (scene as unknown as { _mirroredCameraPosition: Vector3 | null })._mirroredCameraPosition = null;
      });
      this.reflection = rtt;
      this.material.setTexture("uRefl", rtt);
    }
  }

  setReflectionList(meshes: AbstractMesh[]): void {
    if (this.reflection) this.reflection.renderList = meshes;
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
    m.setFloat("uRipple", this.ripple);
    m.setFloat("uWhitecaps", this.whitecaps);
    m.setFloat("uUnder", this.under ? 1 : 0);
    m.setVector2("uWindDir", this.windDir);
    m.setFloat("uUseDepth", this.depth ? 1 : 0);
    m.setVector2("uScreen", new Vector2(screenW, screenH));
    m.setVector2("uNearFar", new Vector2(camera.minZ, camera.maxZ));
    m.setVector3("uCamFwd", camera.getForwardRay(1).direction);
    m.setVector3("uWakeInfo", new Vector3(this.wake.originX, this.wake.originZ, this.wake.worldSize));
    m.setFloat("uWakeHeight", WAKE_HEIGHT_SCALE);
    m.setFloat("uWakeTexel", (this.wake.worldSize / this.wake.size) * 1.5);
    m.setFloat("uUseRefl", this.reflection ? 1 : 0);
    if (this.reflection) {
      this.mirror.multiplyToRef(camera.getViewMatrix(), this.reflView);
      this.reflView.multiplyToRef(camera.getProjectionMatrix(), this.reflVP);
      m.setMatrix("uReflVP", this.reflVP);
    }
  }
}
