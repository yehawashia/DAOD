"use client";

import * as THREE from "three";
import gsap from "gsap";
import katex from "katex";
import type {
  DAODStepType,
  CreateLatexStep,
  CreateTextStep,
  CreateShapeStep,
  CreateAxesStep,
  PlotFunctionStep,
  CreateDotStep,
  TransformLatexStep,
  HighlightStep,
  MoveToStep,
  FadeOutStep,
  CameraMoveStep,
} from "@/lib/ai/schema";
import { StateManager } from "./state-manager";
import { TimelineManager } from "./timeline-manager";

// ─── Coordinate helpers ───────────────────────────────────────────────────────

/** Convert DAOD canvas coords to Three.js world coords (1 unit = 1 world unit) */
function toWorld(x: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, 0);
}

// ─── KaTeX DOM overlay helpers ────────────────────────────────────────────────

function renderKaTeX(latex: string, color: string): HTMLElement {
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.pointerEvents = "none";
  container.style.color = color;
  container.style.fontSize = "20px";
  container.style.fontFamily = "KaTeX_Main, serif";
  container.style.opacity = "0";
  katex.render(latex, container, {
    throwOnError: false,
    displayMode: true,
  });
  return container;
}

/**
 * Positions a DOM element over the Three.js canvas by projecting a 3D world
 * position to 2D screen space.
 */
function projectToScreen(
  position: THREE.Vector3,
  camera: THREE.Camera,
  canvasWidth: number,
  canvasHeight: number
): { left: number; top: number } {
  const proj = position.clone().project(camera);
  const left = ((proj.x + 1) / 2) * canvasWidth;
  const top = ((-proj.y + 1) / 2) * canvasHeight;
  return { left, top };
}

// ─── Main interpreter ─────────────────────────────────────────────────────────

export class Interpreter {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private state: StateManager;
  private timeline: TimelineManager;
  private overlayContainer: HTMLElement | null = null;
  private canvasWidth = 1;
  private canvasHeight = 1;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    state: StateManager,
    timeline: TimelineManager
  ) {
    this.scene = scene;
    this.camera = camera;
    this.state = state;
    this.timeline = timeline;
    this.state.setCamera(camera);
  }

  setOverlayContainer(el: HTMLElement) {
    this.overlayContainer = el;
  }

  setCanvasSize(width: number, height: number) {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  /**
   * Process all steps from a DAOD scene, building them onto the master
   * GSAP timeline. Returns the timeline manager for playback control.
   */
  processSteps(steps: DAODStepType[]): TimelineManager {
    for (const step of steps) {
      this.processStep(step);
    }
    return this.timeline;
  }

  processStep(step: DAODStepType) {
    switch (step.type) {
      case "create_latex":
        return this.createLatex(step);
      case "create_text":
        return this.createText(step);
      case "create_shape":
        return this.createShape(step);
      case "create_axes":
        return this.createAxes(step);
      case "plot_function":
        return this.plotFunction(step);
      case "create_dot":
        return this.createDot(step);
      case "transform_latex":
        return this.transformLatex(step);
      case "highlight":
        return this.highlight(step);
      case "move_to":
        return this.moveTo(step);
      case "fade_out":
        return this.fadeOut(step);
      case "camera_move":
        return this.cameraMove(step);
      case "wait":
        return this.wait(step.duration);
    }
  }

  // ─── Step handlers ──────────────────────────────────────────────────────────

  private createLatex(step: CreateLatexStep) {
    if (!this.overlayContainer) return;

    const el = renderKaTeX(step.latex, step.color ?? "#ffffff");
    el.style.transform = "translate(-50%, -50%)";
    el.style.transition = "none";
    this.overlayContainer.appendChild(el);

    // Dummy Three.js anchor for positional tracking
    const anchor = new THREE.Object3D();
    anchor.position.copy(toWorld(step.position.x, step.position.y));
    this.scene.add(anchor);

    const pos = projectToScreen(
      anchor.position,
      this.camera,
      this.canvasWidth,
      this.canvasHeight
    );
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;

    this.state.add({
      id: step.id,
      type: "latex",
      mesh: anchor,
      domElement: el,
      position: { x: step.position.x, y: step.position.y, z: 0 },
      scale: step.scale ?? 1,
      opacity: 0,
      color: step.color ?? "#ffffff",
      metadata: { latex: step.latex },
    });

    this.timeline.timeline.to(
      el,
      { opacity: 1, duration: step.duration, ease: "power2.out" },
      "+=0"
    );
  }

  private createText(step: CreateTextStep) {
    if (!this.overlayContainer) return;

    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.pointerEvents = "none";
    el.style.color = step.color ?? "#ffffff";
    el.style.fontSize = `${step.fontSize ?? 24}px`;
    el.style.fontWeight = step.fontWeight ?? "normal";
    el.style.fontFamily = "Georgia, serif";
    el.style.opacity = "0";
    el.style.transform = "translate(-50%, -50%)";
    el.textContent = step.text;
    this.overlayContainer.appendChild(el);

    const anchor = new THREE.Object3D();
    anchor.position.copy(toWorld(step.position.x, step.position.y));
    this.scene.add(anchor);

    const pos = projectToScreen(
      anchor.position,
      this.camera,
      this.canvasWidth,
      this.canvasHeight
    );
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;

    this.state.add({
      id: step.id,
      type: "text",
      mesh: anchor,
      domElement: el,
      position: { x: step.position.x, y: step.position.y, z: 0 },
      scale: 1,
      opacity: 0,
      color: step.color ?? "#ffffff",
      metadata: { text: step.text },
    });

    this.timeline.timeline.to(
      el,
      { opacity: 1, duration: step.duration, ease: "power2.out" },
      "+=0"
    );
  }

  private createShape(step: CreateShapeStep) {
    let geometry: THREE.BufferGeometry;

    switch (step.shape) {
      case "circle":
        geometry = new THREE.CircleGeometry(
          Math.min(step.width ?? 100, step.height ?? 100) / 100,
          64
        );
        break;
      case "rectangle":
        geometry = new THREE.PlaneGeometry(
          (step.width ?? 100) / 100,
          (step.height ?? 100) / 100
        );
        break;
      case "triangle":
        geometry = new THREE.BufferGeometry();
        const w = (step.width ?? 100) / 100;
        const h = (step.height ?? 100) / 100;
        const verts = new Float32Array([
          0, h / 2, 0,
          -w / 2, -h / 2, 0,
          w / 2, -h / 2, 0,
        ]);
        geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
        geometry.setIndex([0, 1, 2]);
        geometry.computeVertexNormals();
        break;
      case "line":
      case "arrow": {
        const points = [
          new THREE.Vector3(-(step.width ?? 100) / 200, 0, 0),
          new THREE.Vector3((step.width ?? 100) / 200, 0, 0),
        ];
        geometry = new THREE.BufferGeometry().setFromPoints(points);
        const lineMat = new THREE.LineBasicMaterial({
          color: new THREE.Color(step.color ?? "#4f8ef7"),
          transparent: true,
          opacity: 0,
        });
        const line = new THREE.Line(geometry, lineMat);
        line.position.copy(toWorld(step.position.x, step.position.y));
        this.scene.add(line);

        this.state.add({
          id: step.id,
          type: "line",
          mesh: line,
          position: { x: step.position.x, y: step.position.y, z: 0 },
          scale: 1,
          opacity: 0,
          color: step.color ?? "#4f8ef7",
        });

        this.timeline.timeline.to(
          lineMat,
          { opacity: step.opacity ?? 1, duration: step.duration, ease: "power2.out" },
          "+=0"
        );
        return;
      }
      default:
        geometry = new THREE.PlaneGeometry(1, 1);
    }

    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(step.color ?? "#4f8ef7"),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(toWorld(step.position.x, step.position.y));
    this.scene.add(mesh);

    this.state.add({
      id: step.id,
      type: "shape",
      mesh,
      position: { x: step.position.x, y: step.position.y, z: 0 },
      scale: 1,
      opacity: 0,
      color: step.color ?? "#4f8ef7",
    });

    this.timeline.timeline.to(
      material,
      {
        opacity: step.opacity ?? 1,
        duration: step.duration,
        ease: "power2.out",
      },
      "+=0"
    );
  }

  private createAxes(step: CreateAxesStep) {
    const group = new THREE.Group();
    const [xMin, xMax] = step.xRange ?? [-5, 5];
    const [yMin, yMax] = step.yRange ?? [-5, 5];
    const color = new THREE.Color(step.color ?? "#888888");

    // Axis lines
    const axisMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });

    const xPoints = [
      new THREE.Vector3(xMin, 0, 0),
      new THREE.Vector3(xMax, 0, 0),
    ];
    const yPoints = [
      new THREE.Vector3(0, yMin, 0),
      new THREE.Vector3(0, yMax, 0),
    ];

    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(xPoints), axisMat.clone()));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(yPoints), axisMat.clone()));

    // Grid lines
    if (step.gridLines !== false) {
      const gridMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
      });
      for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x++) {
        if (x === 0) continue;
        const pts = [new THREE.Vector3(x, yMin, 0), new THREE.Vector3(x, yMax, 0)];
        const gridLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          gridMat.clone()
        );
        group.add(gridLine);
      }
      for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y++) {
        if (y === 0) continue;
        const pts = [new THREE.Vector3(xMin, y, 0), new THREE.Vector3(xMax, y, 0)];
        const gridLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          gridMat.clone()
        );
        group.add(gridLine);
      }
    }

    group.position.copy(toWorld(step.position.x, step.position.y));
    this.scene.add(group);

    this.state.add({
      id: step.id,
      type: "axes",
      mesh: group,
      position: { x: step.position.x, y: step.position.y, z: 0 },
      scale: 1,
      opacity: 0,
      color: step.color ?? "#888888",
      metadata: { xRange: step.xRange, yRange: step.yRange },
    });

    // Animate all line materials in the group
    const materials: THREE.LineBasicMaterial[] = [];
    group.traverse((child) => {
      if (child instanceof THREE.Line) {
        materials.push(child.material as THREE.LineBasicMaterial);
      }
    });

    this.timeline.timeline.to(
      materials,
      { opacity: 0.6, duration: step.duration, ease: "power2.out" },
      "+=0"
    );
  }

  private plotFunction(step: PlotFunctionStep) {
    const axesObj = this.state.get(step.axesId);
    const xRange: [number, number] = axesObj?.metadata?.xRange as [number, number] ?? [-5, 5];
    const [xMin, xMax] = xRange;
    const samples = step.samples ?? 100;

    // eslint-disable-next-line no-new-func
    const fn = new Function("x", `return ${step.expression}`);

    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      const x = xMin + (i / samples) * (xMax - xMin);
      let y: number;
      try {
        y = fn(x) as number;
      } catch {
        continue;
      }
      if (!isFinite(y)) continue;
      points.push(new THREE.Vector3(x, y, 0));
    }

    if (points.length < 2) return;

    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(step.color ?? "#f7c948"),
      linewidth: step.strokeWidth ?? 2,
      transparent: true,
      opacity: 0,
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);

    // Position relative to axes origin if axes exists
    if (axesObj) {
      line.position.copy(axesObj.mesh.position);
    }
    this.scene.add(line);

    this.state.add({
      id: step.id,
      type: "line",
      mesh: line,
      position: line.position,
      scale: 1,
      opacity: 0,
      color: step.color ?? "#f7c948",
      metadata: { expression: step.expression },
    });

    this.timeline.timeline.to(
      material,
      { opacity: 1, duration: step.duration, ease: "power2.out" },
      "+=0"
    );
  }

  private createDot(step: CreateDotStep) {
    const geometry = new THREE.CircleGeometry(
      (step.radius ?? 6) / 100,
      32
    );
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(step.color ?? "#ff4f4f"),
      transparent: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(toWorld(step.position.x, step.position.y));
    this.scene.add(mesh);

    this.state.add({
      id: step.id,
      type: "dot",
      mesh,
      position: { x: step.position.x, y: step.position.y, z: 0 },
      scale: 1,
      opacity: 0,
      color: step.color ?? "#ff4f4f",
      metadata: { label: step.label },
    });

    this.timeline.timeline.to(
      material,
      { opacity: 1, duration: step.duration, ease: "power2.out" },
      "+=0"
    );
  }

  private transformLatex(step: TransformLatexStep) {
    const fromObj = this.state.get(step.fromId);
    if (!fromObj?.domElement || !this.overlayContainer) return;

    const newEl = renderKaTeX(step.toLaTeX, fromObj.color);
    newEl.style.transform = "translate(-50%, -50%)";
    newEl.style.left = fromObj.domElement.style.left;
    newEl.style.top = fromObj.domElement.style.top;
    this.overlayContainer.appendChild(newEl);

    const tl = gsap.timeline();
    tl.to(fromObj.domElement, { opacity: 0, duration: step.duration / 2 });
    tl.to(newEl, { opacity: 1, duration: step.duration / 2 });
    tl.call(() => {
      fromObj.domElement?.remove();
      // Update state with new element
      const obj = this.state.get(step.fromId);
      if (obj) {
        obj.domElement = newEl;
        obj.metadata = { latex: step.toLaTeX };
      }
    });

    // Also register new id
    if (step.toId !== step.fromId) {
      this.timeline.timeline.call(() => {
        const fromState = this.state.get(step.fromId);
        if (fromState) {
          this.state.add({ ...fromState, id: step.toId, domElement: newEl });
          this.state.remove(step.fromId);
        }
      });
    }

    this.timeline.timeline.add(tl, "+=0");
  }

  private highlight(step: HighlightStep) {
    const obj = this.state.get(step.targetId);
    if (!obj) return;

    const target = obj.domElement ?? obj.mesh;
    const pulses = step.pulses ?? 2;

    const tl = gsap.timeline();
    for (let i = 0; i < pulses; i++) {
      if (obj.domElement) {
        tl.to(obj.domElement, {
          color: step.color ?? "#f7c948",
          duration: step.duration / (pulses * 2),
        });
        tl.to(obj.domElement, {
          color: obj.color,
          duration: step.duration / (pulses * 2),
        });
      } else if (
        obj.mesh instanceof THREE.Mesh &&
        obj.mesh.material instanceof THREE.MeshBasicMaterial
      ) {
        const originalColor = obj.mesh.material.color.getHex();
        const highlightColor = new THREE.Color(step.color ?? "#f7c948");
        tl.to(
          {},
          {
            duration: step.duration / (pulses * 2),
            onUpdate() {
              (obj.mesh as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.lerp(highlightColor, 0.1);
            },
          }
        );
        tl.to(
          {},
          {
            duration: step.duration / (pulses * 2),
            onUpdate() {
              (obj.mesh as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.setHex(originalColor);
            },
          }
        );
      }
    }

    // Keep tsc happy — target is referenced
    void target;

    this.timeline.timeline.add(tl, "+=0");
  }

  private moveTo(step: MoveToStep) {
    const obj = this.state.get(step.targetId);
    if (!obj) return;

    const easeMap: Record<string, string> = {
      linear: "none",
      easeIn: "power2.in",
      easeOut: "power2.out",
      easeInOut: "power2.inOut",
      bounce: "bounce.out",
      elastic: "elastic.out(1, 0.3)",
    };
    const ease = easeMap[step.easing ?? "easeInOut"] ?? "power2.inOut";

    this.timeline.timeline.to(
      obj.mesh.position,
      {
        x: step.position.x,
        y: step.position.y,
        duration: step.duration,
        ease,
        onUpdate: () => {
          obj.position.x = obj.mesh.position.x;
          obj.position.y = obj.mesh.position.y;
          // Reproject DOM element if present
          if (obj.domElement) {
            const pos = projectToScreen(
              obj.mesh.position,
              this.camera,
              this.canvasWidth,
              this.canvasHeight
            );
            obj.domElement.style.left = `${pos.left}px`;
            obj.domElement.style.top = `${pos.top}px`;
          }
        },
      },
      "+=0"
    );
  }

  private fadeOut(step: FadeOutStep) {
    const obj = this.state.get(step.targetId);
    if (!obj) return;

    if (obj.domElement) {
      this.timeline.timeline.to(
        obj.domElement,
        {
          opacity: 0,
          duration: step.duration,
          onComplete: () => this.state.remove(step.targetId),
        },
        "+=0"
      );
    } else if (
      obj.mesh instanceof THREE.Mesh &&
      obj.mesh.material instanceof THREE.Material
    ) {
      (obj.mesh.material as THREE.MeshBasicMaterial).transparent = true;
      this.timeline.timeline.to(
        obj.mesh.material,
        {
          opacity: 0,
          duration: step.duration,
          onComplete: () => this.state.remove(step.targetId),
        },
        "+=0"
      );
    }
  }

  private cameraMove(step: CameraMoveStep) {
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.timeline.timeline.to(
        this.camera.position,
        {
          x: step.position.x,
          y: step.position.y,
          z: step.position.z ?? this.camera.position.z,
          duration: step.duration,
          ease: "power2.inOut",
        },
        "+=0"
      );
    } else if (this.camera instanceof THREE.OrthographicCamera) {
      this.timeline.timeline.to(
        this.camera,
        {
          zoom: step.zoom ?? 1,
          duration: step.duration,
          ease: "power2.inOut",
          onUpdate: () => {
            (this.camera as THREE.OrthographicCamera).updateProjectionMatrix();
          },
        },
        "+=0"
      );
    }
  }

  private wait(duration: number) {
    this.timeline.timeline.to({}, { duration });
  }
}
