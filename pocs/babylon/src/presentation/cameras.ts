// Câmeras: externa (perseguição com mola + órbita por arraste) e cockpit (cabeça do piloto).

import { type Scene, UniversalCamera, Vector3, Quaternion, Matrix } from "@babylonjs/core";
import { clamp } from "../sim/math.ts";

export type CamMode = "externa" | "cockpit";

export class BoatCamera {
  readonly cam: UniversalCamera;
  mode: CamMode = "externa";
  private pos = new Vector3(0, 5, -15);
  private look = new Vector3();
  private orbitYaw = 0;
  private orbitPitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private idle = 0;
  private first = true;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.cam = new UniversalCamera("cam", new Vector3(0, 5, -15), scene);
    this.cam.minZ = 0.05;
    this.cam.maxZ = 3500;
    this.cam.fov = 0.95;
    this.cam.inputs.clear(); // controle manual
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return; // no celular o arraste é dos controles
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
    });
    window.addEventListener("pointerup", () => (this.dragging = false));
    window.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.orbitYaw += (e.clientX - this.lastX) * 0.006;
      this.orbitPitch = clamp(this.orbitPitch + (e.clientY - this.lastY) * 0.004, -0.25, 0.9);
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.idle = 0;
    });
  }

  toggle(): CamMode {
    this.mode = this.mode === "externa" ? "cockpit" : "externa";
    this.orbitYaw = 0; this.orbitPitch = 0;
    this.first = true;
    return this.mode;
  }

  /** Atualiza a câmera a partir da pose (interpolada) do barco. */
  update(dt: number, boatPos: Vector3, boatRot: Quaternion, speed: number): void {
    const m = new Matrix();
    boatRot.toRotationMatrix(m);
    const fwd = Vector3.TransformNormal(new Vector3(0, 0, 1), m);
    const up = Vector3.TransformNormal(new Vector3(0, 1, 0), m);

    if (!this.dragging) {
      this.idle += dt;
      if (this.idle > 1.5) {
        const k = 1 - Math.exp(-dt * 1.5);
        this.orbitYaw += (0 - this.orbitYaw) * k;
        this.orbitPitch += (0 - this.orbitPitch) * k;
      }
    }

    if (this.mode === "externa") {
      this.cam.fov = 0.95 + clamp(speed / 25, 0, 1) * 0.12;
      const flat = new Vector3(fwd.x, 0, fwd.z).normalize();
      const yaw = Math.atan2(flat.x, flat.z) + this.orbitYaw;
      const dist = 11 + clamp(speed / 22, 0, 1) * 2.5;
      const height = 3.3 + this.orbitPitch * 8;
      const desired = new Vector3(boatPos.x - Math.sin(yaw) * dist, boatPos.y + height, boatPos.z - Math.cos(yaw) * dist);
      const k = this.first ? 1 : 1 - Math.exp(-dt * 6);
      this.pos = Vector3.Lerp(this.pos, desired, k);
      if (this.pos.y < 0.6) this.pos.y = 0.6;
      const lookT = boatPos.add(new Vector3(flat.x * 2.5, 1.0, flat.z * 2.5));
      this.look = this.first ? lookT : Vector3.Lerp(this.look, lookT, 1 - Math.exp(-dt * 12));
      this.first = false;
      this.cam.position.copyFrom(this.pos);
      this.cam.upVector = Vector3.Up();
      this.cam.setTarget(this.look);
    } else {
      this.cam.fov = 1.15;
      const head = Vector3.TransformCoordinates(new Vector3(0.5, 1.24, -0.18), Matrix.Compose(Vector3.One(), boatRot, boatPos));
      this.cam.position.copyFrom(head);
      const yawQ = Quaternion.RotationAxis(Vector3.Up(), this.orbitYaw * 1.5);
      const pitchQ = Quaternion.RotationAxis(Vector3.Right(), 0.2 + this.orbitPitch * 0.6);
      const q = boatRot.multiply(yawQ).multiply(pitchQ);
      const qm = new Matrix(); q.toRotationMatrix(qm);
      const dir = Vector3.TransformNormal(new Vector3(0, 0, 1), qm);
      this.cam.upVector = Vector3.Lerp(Vector3.Up(), up, 0.6).normalize();
      this.cam.setTarget(head.add(dir));
      this.pos.copyFrom(head);
      this.look = head.add(fwd.scale(3));
    }
  }
}
