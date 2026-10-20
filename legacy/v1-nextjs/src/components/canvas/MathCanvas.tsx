"use client";

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { StateManager } from "@/lib/engine/state-manager";
import { TimelineManager } from "@/lib/engine/timeline-manager";
import { Interpreter } from "@/lib/engine/interpreter";
import type { DAOD, DAODStepType } from "@/lib/ai/schema";

export interface MathCanvasHandle {
  loadScene: (scene: DAOD, onStepStart?: (index: number) => void) => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  getState: () => StateManager;
  getTimeline: () => TimelineManager;
  appendSteps: (steps: DAODStepType[], onStepStart?: (index: number) => void, startIndex?: number) => void;
}

interface MathCanvasProps {
  className?: string;
}

const MathCanvas = forwardRef<MathCanvasHandle, MathCanvasProps>(
  function MathCanvas({ className }, ref) {
    const mountRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
    const stateRef = useRef<StateManager>(new StateManager());
    const timelineRef = useRef<TimelineManager>(new TimelineManager());
    const overlayRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number>(0);

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;

      const width = mount.clientWidth || window.innerWidth;
      const height = mount.clientHeight || window.innerHeight;
      const aspect = width / height;

      // Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);
      sceneRef.current = scene;

      // Orthographic camera — 10 units wide each side
      const frustumSize = 10;
      const camera = new THREE.OrthographicCamera(
        (-frustumSize * aspect) / 2,
        (frustumSize * aspect) / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.1,
        1000
      );
      camera.position.set(0, 0, 10);
      cameraRef.current = camera;
      stateRef.current.setCamera(camera);

      // Renderer
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(width, height);
      mount.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Render loop
      const animate = () => {
        rafRef.current = requestAnimationFrame(animate);
        renderer.render(scene, camera);
      };
      animate();

      // Resize
      const onResize = () => {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        const a = w / h;
        camera.left = (-frustumSize * a) / 2;
        camera.right = (frustumSize * a) / 2;
        camera.top = frustumSize / 2;
        camera.bottom = -frustumSize / 2;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(mount);

      return () => {
        cancelAnimationFrame(rafRef.current);
        ro.disconnect();
        renderer.dispose();
        mount.removeChild(renderer.domElement);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      loadScene(scene: DAOD, onStepStart?: (index: number) => void) {
        if (!sceneRef.current || !cameraRef.current) return;

        // Reset
        stateRef.current.clear();
        timelineRef.current.reset();

        // Clear overlay
        if (overlayRef.current) {
          overlayRef.current.innerHTML = "";
        }

        const interpreter = new Interpreter(
          sceneRef.current,
          cameraRef.current,
          stateRef.current,
          timelineRef.current
        );

        if (overlayRef.current) {
          interpreter.setOverlayContainer(overlayRef.current);
        }

        const mount = mountRef.current;
        if (mount) {
          interpreter.setCanvasSize(mount.clientWidth, mount.clientHeight);
        }

        // Wire step callbacks for TTS narration
        if (onStepStart) {
          scene.steps.forEach((_, i) => {
            timelineRef.current.addCallback(() => onStepStart(i));
          });
        }

        interpreter.processSteps(scene.steps);
      },

      appendSteps(steps: DAODStepType[], onStepStart?: (index: number) => void, startIndex: number = 0) {
        if (!sceneRef.current || !cameraRef.current) return;
        const interpreter = new Interpreter(
          sceneRef.current,
          cameraRef.current,
          stateRef.current,
          timelineRef.current
        );
        if (overlayRef.current) interpreter.setOverlayContainer(overlayRef.current);
        const mount = mountRef.current;
        if (mount) interpreter.setCanvasSize(mount.clientWidth, mount.clientHeight);

        if (onStepStart) {
          steps.forEach((_, i) => {
            timelineRef.current.addCallback(() => onStepStart(startIndex + i));
          });
        }
        interpreter.processSteps(steps);
      },

      play() {
        timelineRef.current.play();
      },

      pause() {
        timelineRef.current.pause();
      },

      reset() {
        stateRef.current.clear();
        timelineRef.current.reset();
        if (overlayRef.current) overlayRef.current.innerHTML = "";
      },

      getState() {
        return stateRef.current;
      },

      getTimeline() {
        return timelineRef.current;
      },
    }));

    return (
      <div ref={mountRef} className={`relative w-full h-full ${className ?? ""}`}>
        {/* DOM overlay for KaTeX and text elements */}
        <div
          ref={overlayRef}
          className="absolute inset-0 pointer-events-none overflow-hidden"
        />
      </div>
    );
  }
);

export default MathCanvas;
