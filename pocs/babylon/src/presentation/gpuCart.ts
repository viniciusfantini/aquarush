// GPU (ground power unit) da doca: carrinho gerador a diesel de 28 V DC, como os de pátio de aeroporto/heliponto,
// parado no píer ao lado da vaga (só aparece com a lancha de turbina, junto com o assistente de colete amarelo).
// Conectada, um cabo grosso vai do carrinho até a tomada externa da lancha. O diesel solta fumaça (escura na partida,
// clareando até sumir; baforada quando a carga sobe) e a tela de status fica na traseira. Só visual: o estado vem da
// simulação (`systems.gpu`, `gpuState`, `gpuKw`).

import { type Scene, Mesh, MeshBuilder, StandardMaterial, DynamicTexture, Color3, Color4, TransformNode, Vector3, ParticleSystem } from "@babylonjs/core";
import { makeKit, makeMats } from "./fleet.ts";

export class GpuCart {
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  private readonly plug: TransformNode;   // saída do cabo no carrinho
  private cable: Mesh | null = null;
  private readonly cableMat: StandardMaterial;
  private readonly lamp: StandardMaterial;
  private readonly scene: Scene;
  // ---- diesel: chaminé com fumaça e a tela de status na traseira ----
  private readonly stackTip: TransformNode;
  private readonly smoke: ParticleSystem;
  private readonly screenTex: DynamicTexture;
  private screenText = "";
  private loadS = 0;   // carga suavizada (o governador reage com atraso → baforada)
  private puff = 0;    // fumaça escura do transitório de carga

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
    // chaminé do diesel (no teto, atrás) com chapéu
    K.cyl(0.42, 0.07, "y", -0.22, 1.36, -0.5, M.steelDark, root);
    K.cyl(0.03, 0.14, "y", -0.22, 1.6, -0.5, M.steelDark, root);
    this.stackTip = K.node("gpuStackTip", root, -0.22, 1.6, -0.5);
    // tela de status na TRASEIRA (visível de trás do carrinho): STOP / STARTING / STABILIZING / ON e a potência
    this.screenTex = new DynamicTexture("gpuScreen", { width: 256, height: 128 }, scene, false);
    const scrMat = new StandardMaterial("gpuScreenMat", scene);
    scrMat.diffuseTexture = this.screenTex; scrMat.emissiveTexture = this.screenTex; scrMat.disableLighting = true;
    K.rbox(0.7, 0.4, 0.03, 0.02, 0, 0.86, -0.665, M.black, root);                   // moldura
    const scr = MeshBuilder.CreatePlane("gpuScreenPlane", { width: 0.62, height: 0.31 }, scene);
    scr.material = scrMat; scr.parent = root; scr.position.set(0, 0.86, -0.684); // a face do plano olha para −Z (traseira)
    K.out.push(scr);
    this.drawScreen("STOP", "0.0 kW", "");
    // fumaça do escape
    const smokeTex = new DynamicTexture("gpuSmokeTex", { width: 64, height: 64 }, scene, false);
    const g = (smokeTex.getContext() as CanvasRenderingContext2D).createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, "rgba(255,255,255,0.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
    const c2 = smokeTex.getContext() as CanvasRenderingContext2D; c2.fillStyle = g; c2.fillRect(0, 0, 64, 64); smokeTex.hasAlpha = true; smokeTex.update();
    const ps = new ParticleSystem("gpuSmoke", 400, scene);
    ps.particleTexture = smokeTex; ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.minLifeTime = 1.2; ps.maxLifeTime = 2.6; ps.minSize = 0.1; ps.maxSize = 0.2;
    ps.addSizeGradient(0, 0.5); ps.addSizeGradient(0.5, 1.6); ps.addSizeGradient(1, 2.6);
    ps.gravity = new Vector3(0.15, 0.6, 0); ps.minEmitPower = 1; ps.maxEmitPower = 1;
    ps.direction1 = new Vector3(-0.15, 0.9, -0.15); ps.direction2 = new Vector3(0.15, 1.5, 0.15);
    ps.minAngularSpeed = -0.5; ps.maxAngularSpeed = 0.5;
    ps.emitter = Vector3.Zero(); ps.emitRate = 0; ps.renderingGroupId = 1;
    ps.start();
    this.smoke = ps;
    this.cableMat = new StandardMaterial("gpuCable", scene); this.cableMat.diffuseColor = new Color3(0.04, 0.04, 0.045); this.cableMat.specularColor = new Color3(0.2, 0.2, 0.2);
    this.meshes = K.out;
    for (const m of this.meshes) { m.isPickable = false; m.receiveShadows = true; }
  }

  /**
   * Cabo até a tomada do barco (mundo) quando conectada; null = cabo recolhido no carretel. `edge` = ponto na borda do
   * píer por onde o cabo passa (ele desce do carrinho, corre no convés até a borda e cai em barriga até o costado).
   */
  private drawScreen(l1: string, l2: string, l3: string): void {
    const key = l1 + l2 + l3;
    if (key === this.screenText) return;
    this.screenText = key;
    const ctx = this.screenTex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#04120a"; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = l1 === "STOP" ? "#ff5a4e" : l1 === "ON" ? "#5dff8f" : "#ffc23a";
    ctx.font = "bold 40px monospace"; ctx.textAlign = "center"; ctx.fillText(l1, 128, 48);
    ctx.fillStyle = "#5dff8f"; ctx.font = "bold 34px monospace"; ctx.fillText(l2, 128, 90);
    ctx.fillStyle = "#3da862"; ctx.font = "20px monospace"; ctx.fillText(l3, 128, 118);
    this.screenTex.update();
  }

  /**
   * Diesel da GPU: tela de status e fumaça. `t` = s desde que foi pedida; `kw` = potência fornecida. Na partida a
   * fumaça sai escura (combustível frio, rotação subindo) e vai clareando até quase sumir com a rotação estável;
   * quando a carga sobe de repente (ex.: o starter da turbina engata), o governador abre o combustível e sai uma
   * baforada escura até estabilizar.
   */
  updateDiesel(state: "off" | "starting" | "online" | "stopping", t: number, kw: number, dt: number): void {
    const load = Math.min(1.2, kw / 16.8); // GPU de 28 V × 600 A ≈ 16,8 kW
    this.loadS += (load - this.loadS) * (1 - Math.exp(-dt / 1.2));
    this.puff = Math.max(0, this.puff - dt / 1.6);
    // degrau de carga (carga atual acima da suavizada): o governador abre o combustível → baforada escura
    if (load - this.loadS > 0.04 && state === "online") this.puff = Math.min(1, Math.max(this.puff, (load - this.loadS) * 3));
    let rate = 0, dark = 0.2;
    if (state === "starting" && t < 0.9) { rate = 18; dark = 0.35; }                          // girando no starter
    else if (state === "starting") { const u = (t - 0.9) / 3.6; rate = 130 - 105 * u; dark = 0.92 - 0.6 * u; } // pegou: preta → clareando
    else if (state === "online") { rate = Math.max(0, 25 - 4 * (t - 4.5)); dark = 0.3; }      // estabilizada: some
    else if (state === "stopping") { rate = 3; dark = 0.2; }                                    // sem carga, esfriando
    if (state !== "off" && this.puff > 0.02) { rate += 110 * this.puff; dark = Math.max(dark, 0.5 + 0.35 * this.puff); }
    const g = 0.82 - 0.7 * Math.min(1, dark);
    this.smoke.color1 = new Color4(g, g, g, 0.55); this.smoke.color2 = new Color4(g * 0.9, g * 0.9, g * 0.9, 0.45); this.smoke.colorDead = new Color4(g, g, g, 0);
    this.smoke.emitter = this.stackTip.getAbsolutePosition().clone();
    this.smoke.emitRate = this.root.isEnabled() ? rate : 0;
    // tela
    const label = state === "off" ? "STOP" : state === "online" ? "ON" : state === "stopping" ? "STOPPING" : t < 0.9 ? "STARTING" : "STABILIZING";
    const rpm = state === "off" ? 0 : state === "online" || state === "stopping" ? 1500 : t < 0.9 ? 180 : Math.round(1500 - 1300 * Math.exp(-(t - 0.9) / 0.35));
    this.drawScreen(label, kw > 0.05 ? `-${kw.toFixed(1)} kW` : "0.0 kW", state === "off" ? "" : `${rpm} RPM · 28 V`);
  }

  update(socket: Vector3 | null, state: "off" | "starting" | "online" | "stopping", edge?: Vector3): void {
    // lâmpada: pisca âmbar enquanto o diesel parte e estabiliza; verde fixa com a energia chaveada
    const blink = Math.floor(performance.now() / 350) % 2 === 0;
    this.lamp.emissiveColor = state === "online" ? new Color3(0.2, 1, 0.3) : (state === "starting" || state === "stopping") && blink ? new Color3(1, 0.65, 0.05) : Color3.Black();
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
