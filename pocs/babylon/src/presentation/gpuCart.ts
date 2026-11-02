// GPU (ground power unit) da doca: carrinho de fonte de solo de 28 V DC, como os de pátio de aeroporto/heliponto,
// parado no píer ao lado da vaga. Com a GPU conectada, um cabo grosso vai do carrinho até a tomada externa da
// lancha de turbina (desenhado com barriga). Só visual: quem decide se está conectada é a simulação (`systems.gpu`).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, DynamicTexture, Color3, TransformNode, Vector3 } from "@babylonjs/core";
import { makeKit, makeMats } from "./fleet.ts";

export class GpuCart {
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  private readonly plug: TransformNode;   // saída do cabo no carrinho
  private cable: Mesh | null = null;
  private readonly cableMat: StandardMaterial;
  private readonly lamp: StandardMaterial;
  private readonly scene: Scene;

  /** (x, y, z) = centro do carrinho no convés do píer; yaw = rumo da frente (painel) */
  constructor(scene: Scene, x: number, y: number, z: number, yaw: number) {
    this.scene = scene;
    const K = makeKit(scene), M = makeMats(scene);
    const root = new TransformNode("gpuCart", scene);
    root.position.set(x, y, z); root.rotation.y = yaw;
    this.root = root;
    const yellow = M.yellow;
    // chassi com rodas e cambão
    K.box(0.86, 0.08, 1.5, 0, 0.26, 0, M.steelDark, root);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.cyl(0.1, 0.36, "x", sx * 0.46, 0.18, sz * 0.55, M.tire, root);
    K.box(0.06, 0.06, 0.7, 0, 0.24, 1.05, M.steelDark, root).rotation.x = -0.25;
    K.cyl(0.04, 0.14, "y", 0, 0.12, 1.36, M.steelDark, root);
    // gabinete (amarelo de pátio) com faixas de advertência, grade de ventilação e painel
    K.rbox(0.8, 0.86, 1.3, 0.05, 0, 0.73, 0, yellow, root);
    for (let i = 0; i < 6; i++) K.box(0.81, 0.06, 0.04, 0, 0.36 + 0.07 * (i % 2), -0.62 + i * 0.25, i % 2 ? M.black : yellow, root);
    for (let i = 0; i < 5; i++) K.box(0.012, 0.04, 0.9, -0.41, 0.85 - i * 0.08, -0.05, M.black, root);
    K.rbox(0.62, 0.42, 0.04, 0.02, 0, 0.88, 0.66, M.matte, root);                 // painel
    for (let i = 0; i < 2; i++) K.cyl(0.02, 0.16, "z", -0.15 + i * 0.3, 0.95, 0.69, M.black, root); // voltímetro/amperímetro
    K.box(0.1, 0.05, 0.03, 0, 0.78, 0.69, M.red, root);                             // botão de emergência
    // lâmpada "GPU ATIVA" no teto
    this.lamp = new StandardMaterial("gpuLamp", scene); this.lamp.diffuseColor = new Color3(0.1, 0.3, 0.1); this.lamp.emissiveColor = Color3.Black();
    K.cyl(0.08, 0.1, "y", 0.25, 1.2, -0.4, this.lamp, root);
    // placa "GPU 28 V DC"
    const tex = new DynamicTexture("gpuLabel", { width: 256, height: 96 }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = "#ffd21a"; ctx.font = "bold 46px sans-serif"; ctx.textAlign = "center"; ctx.fillText("GPU", 128, 46);
    ctx.font = "bold 26px sans-serif"; ctx.fillText("28 V DC · 600 A", 128, 82);
    tex.update();
    const labMat = new StandardMaterial("gpuLabelMat", scene); labMat.diffuseTexture = tex; labMat.emissiveColor = new Color3(0.35, 0.35, 0.35);
    for (const s of [-1, 1]) {
      const lab = MeshBuilder.CreatePlane("gpuLabel", { width: 0.62, height: 0.24 }, scene);
      lab.material = labMat; lab.parent = root; lab.position.set(s * 0.405, 0.95, -0.15); lab.rotation.y = s * Math.PI / 2;
      K.out.push(lab);
    }
    // carretel do cabo (enrolado) e a saída do cabo no lado que dá para a água
    const reel = MeshBuilder.CreateTorus("gpuReel", { diameter: 0.5, thickness: 0.12, tessellation: 24 }, scene);
    reel.material = M.black; reel.parent = root; reel.position.set(0.44, 0.78, -0.25); reel.rotation.z = Math.PI / 2;
    K.out.push(reel);
    K.cyl(0.08, 0.14, "x", 0.47, 0.62, 0.3, M.steel, root);
    this.plug = K.node("gpuPlug", root, 0.53, 0.62, 0.3);
    this.cableMat = new StandardMaterial("gpuCable", scene); this.cableMat.diffuseColor = new Color3(0.04, 0.04, 0.045); this.cableMat.specularColor = new Color3(0.2, 0.2, 0.2);
    this.meshes = K.out;
    for (const m of this.meshes) { m.isPickable = false; m.receiveShadows = true; }
  }

  /**
   * Cabo até a tomada do barco (mundo) quando conectada; null = cabo recolhido no carretel. `edge` = ponto na borda do
   * píer por onde o cabo passa (ele desce do carrinho, corre no convés até a borda e cai em barriga até o costado).
   */
  update(socket: Vector3 | null, on: boolean, edge?: Vector3): void {
    this.lamp.emissiveColor = on ? new Color3(0.2, 1, 0.3) : Color3.Black();
    if (!socket) { this.cable?.setEnabled(false); return; }
    const a = this.plug.getAbsolutePosition();
    const path: Vector3[] = [];
    const sag = (p0: Vector3, p1: Vector3, n: number, k: number, skipFirst: boolean) => {
      const span = Vector3.Distance(p0, p1);
      for (let i = skipFirst ? 1 : 0; i <= n; i++) {
        const t = i / n, p = Vector3.Lerp(p0, p1, t);
        p.y -= Math.sin(Math.PI * t) * Math.min(0.5, k * span); // barriga do cabo
        path.push(p);
      }
    };
    if (edge) {
      // do bocal ao chão do píer (curva) e pelo convés até a borda
      const floor = new Vector3(a.x + 0.25, edge.y, a.z);
      path.push(a, new Vector3(a.x + 0.12, (a.y + edge.y) / 2 - 0.05, a.z), floor);
      sag(floor, edge, 4, 0, true);
      sag(edge, socket, 8, 0.12, true);
    } else sag(a, socket, 12, 0.12, false);
    if (!this.cable) {
      this.cable = MeshBuilder.CreateTube("gpuCableTube", { path, radius: 0.025, tessellation: 8, updatable: true }, this.scene);
      this.cable.material = this.cableMat; this.cable.isPickable = false;
    } else MeshBuilder.CreateTube("gpuCableTube", { path, radius: 0.025, instance: this.cable });
    this.cable.setEnabled(true);
  }
}
