import * as THREE from "three";

export interface SceneObject {
  id: string;
  type: "latex" | "text" | "shape" | "axes" | "dot" | "line";
  mesh: THREE.Object3D;
  domElement?: HTMLElement; // for KaTeX overlays
  position: { x: number; y: number; z: number };
  scale: number;
  opacity: number;
  color: string;
  metadata?: Record<string, unknown>;
}

export interface SerializedState {
  objects: Array<{
    id: string;
    type: string;
    position: { x: number; y: number; z: number };
    scale: number;
    opacity: number;
    color: string;
    visible: boolean;
    metadata?: Record<string, unknown>;
  }>;
  camera: {
    position: { x: number; y: number; z: number };
    zoom: number;
  };
  timestamp: number;
}

export class StateManager {
  private objects = new Map<string, SceneObject>();
  private camera: THREE.Camera | null = null;

  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }

  add(obj: SceneObject) {
    this.objects.set(obj.id, obj);
  }

  get(id: string): SceneObject | undefined {
    return this.objects.get(id);
  }

  remove(id: string) {
    const obj = this.objects.get(id);
    if (obj) {
      obj.mesh.removeFromParent();
      obj.domElement?.remove();
      this.objects.delete(id);
    }
  }

  has(id: string): boolean {
    return this.objects.has(id);
  }

  all(): SceneObject[] {
    return Array.from(this.objects.values());
  }

  clear() {
    for (const obj of this.objects.values()) {
      obj.mesh.removeFromParent();
      obj.domElement?.remove();
    }
    this.objects.clear();
  }

  /**
   * Captures the full current scene state as a plain serialisable object.
   * Used by the interruption handler to send context to Groq.
   */
  serializeState(): SerializedState {
    const serializedObjects = Array.from(this.objects.values()).map((obj) => ({
      id: obj.id,
      type: obj.type,
      position: { ...obj.position },
      scale: obj.scale,
      opacity: obj.opacity,
      color: obj.color,
      visible: obj.mesh.visible,
      metadata: obj.metadata,
    }));

    let cameraPosition = { x: 0, y: 0, z: 10 };
    let zoom = 1;

    if (this.camera instanceof THREE.PerspectiveCamera) {
      cameraPosition = {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      };
    } else if (this.camera instanceof THREE.OrthographicCamera) {
      cameraPosition = {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      };
      zoom = this.camera.zoom;
    }

    return {
      objects: serializedObjects,
      camera: { position: cameraPosition, zoom },
      timestamp: Date.now(),
    };
  }
}
