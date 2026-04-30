"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import FreemiumGate, { type FreemiumReason } from "@/components/FreemiumGate";
import VoidIntro from "@/components/intro/VoidIntro";
import TopicPills from "@/components/ui/TopicPills";
import ThinkingDots from "@/components/ui/ThinkingDots";
import { playNarration } from "@/lib/audio/player";
import type { DAOD, DAODStepType } from "@/lib/ai/schema";
import { cancelActiveTextDisintegration } from "@/lib/effects/textDisintegration";

type AppState =
  | "intro"
  | "audio-unlock"
  | "input"
  | "loading"
  | "playing"
  | "error";

declare global {
  interface Window {
    __DAOD_LOGS__?: string[];
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

const PANEL_WIDTH = 80;
const PANEL_HEIGHT = 55;
const PANEL_TEXTURE_WIDTH = 1024;
const PANEL_TEXTURE_HEIGHT = 640;
const PANEL_BODY_TOP = 0.22;
const PANEL_BODY_BOTTOM = 0.62;
const DEFAULT_LABEL = "what do you want to learn today?";
const ERROR_LABEL = "something went wrong. try another topic.";
const STAR_COUNT = 3000;

type Animation = {
  update: (now: number) => boolean;
};

type ButtonRecord = {
  action: "speak" | "send";
  group: THREE.Group;
  frame: THREE.LineSegments;
  targetScale: number;
};

type WorldObjectRecord = {
  object: THREE.Object3D;
  updateText?: (text: string) => void;
  axesMeta?: {
    xRange: [number, number];
    yRange: [number, number];
    width: number;
    height: number;
  };
};

type PanelTextController = ReturnType<typeof createPanelTextController>;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function easeInOut(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let line = words[0];
    for (let index = 1; index < words.length; index += 1) {
      const candidate = `${line} ${words[index]}`;
      if (ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = words[index];
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }

  return lines;
}

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number
) {
  let cursorX = x;
  for (const character of text) {
    ctx.fillText(character, cursorX, y);
    cursorX += ctx.measureText(character).width + spacing;
  }
}

function pushClientLog(...parts: unknown[]) {
  if (typeof window === "undefined") return;
  const line = parts
    .map((part) => {
      if (part instanceof Error) return `${part.name}: ${part.message}`;
      if (typeof part === "string") return part;
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .join(" ");
  window.__DAOD_LOGS__ ??= [];
  window.__DAOD_LOGS__.push(line);
}

function createTextSprite(
  text: string,
  options?: {
    width?: number;
    height?: number;
    fontSize?: number;
    color?: string;
    opacity?: number;
    background?: string;
  }
) {
  const width = options?.width ?? 1024;
  const height = options?.height ?? 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create sprite canvas context");
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: options?.opacity ?? 1,
  });
  const sprite = new THREE.Sprite(material);

  const updateText = (nextText: string) => {
    document.fonts.ready.then(() => {
      ctx.clearRect(0, 0, width, height);
      if (options?.background) {
        ctx.fillStyle = options.background;
        ctx.fillRect(0, 0, width, height);
      }
      // Force ThunderBold typography
      ctx.fillStyle = "rgba(240,237,230,0.92)";
      ctx.font = "bold 17px ThunderBold, Thunder, sans-serif";

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = wrapText(ctx, nextText, width * 0.86);
      const lineHeight = 17 * 1.2;
      const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, index) => {
        ctx.fillText(line, width / 2, startY + index * lineHeight);
      });
      texture.needsUpdate = true;
    });
  };

  updateText(text);

  return { sprite, updateText, material, texture };
}

function setObjectOpacity(object: THREE.Object3D, opacity: number) {
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((entry) => {
      if (
        entry instanceof THREE.Material &&
        "opacity" in entry &&
        "transparent" in entry
      ) {
        (entry as THREE.Material & { opacity: number; transparent: boolean }).opacity =
          opacity;
        (entry as THREE.Material & { opacity: number; transparent: boolean }).transparent =
          true;
      }
    });
  });
}

function lessonToWorld(position: { x: number; y: number; z?: number }) {
  return new THREE.Vector3(position.x * 4.6, position.y * 4.6, (position.z ?? 0) * 7);
}

function createPanelMaterial(texture: THREE.CanvasTexture, darkness: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTexture: { value: texture },
      uDarkness: { value: darkness },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uTexture;
      uniform float uDarkness;
      varying vec2 vUv;

      float borderMask(vec2 uv) {
        vec2 edge = min(uv, 1.0 - uv);
        float dist = min(edge.x, edge.y);
        return 1.0 - smoothstep(0.0, 0.018, dist);
      }

      float glowMask(vec2 uv) {
        vec2 centered = uv - 0.5;
        return smoothstep(0.45, 0.0, length(centered));
      }

      float noise(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec4 textColor = texture2D(uTexture, vUv);
        float border = borderMask(vUv);
        float glow = glowMask(vUv) * 0.06;
        float frost = noise(vUv * 24.0) * 0.035;
        vec3 base = mix(vec3(0.02, 0.02, 0.04), vec3(0.08, 0.09, 0.14), glow);
        base = mix(base, vec3(0.0), uDarkness);
        vec3 color = base + vec3(border * 0.22 + frost);
        color = mix(color, textColor.rgb, textColor.a);
        float alpha = 0.58 + glow * 0.35 + border * 0.18 + textColor.a * 0.35;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

function createPanelTextController(
  frontTexture: THREE.CanvasTexture,
  backTexture: THREE.CanvasTexture
) {
  const bodyCanvas = document.createElement("canvas");
  bodyCanvas.width = PANEL_TEXTURE_WIDTH;
  bodyCanvas.height = PANEL_TEXTURE_HEIGHT;
  const bodyCtx = bodyCanvas.getContext("2d");
  const displayCanvas = document.createElement("canvas");
  displayCanvas.width = PANEL_TEXTURE_WIDTH;
  displayCanvas.height = PANEL_TEXTURE_HEIGHT;
  const displayCtx = displayCanvas.getContext("2d");
  const backCanvas = document.createElement("canvas");
  backCanvas.width = PANEL_TEXTURE_WIDTH;
  backCanvas.height = PANEL_TEXTURE_HEIGHT;
  const backCtx = backCanvas.getContext("2d");

  if (!bodyCtx || !displayCtx || !backCtx) {
    throw new Error("Failed to create panel text contexts");
  }

  let promptLabel = DEFAULT_LABEL;
  let bodyText = "";
  let resolverToken = 0;
  const timers = new Set<number>();

  const syncTextures = () => {
    displayCtx.clearRect(0, 0, PANEL_TEXTURE_WIDTH, PANEL_TEXTURE_HEIGHT);
    displayCtx.drawImage(bodyCanvas, 0, 0);
    displayCtx.save();
    displayCtx.fillStyle = "rgba(255,255,255,0.82)";
    displayCtx.font = "500 18px Thunder, sans-serif";
    displayCtx.textAlign = "left";
    displayCtx.textBaseline = "top";
    drawSpacedText(displayCtx, "DAOD", 70, 72, 10);
    displayCtx.restore();

    displayCtx.save();
    displayCtx.fillStyle = "rgba(255,255,255,0.94)";
    displayCtx.font = "36px Georgia, serif";
    displayCtx.textAlign = "center";
    displayCtx.textBaseline = "middle";
    displayCtx.fillText(promptLabel, PANEL_TEXTURE_WIDTH / 2, 120);
    displayCtx.restore();

    backCtx.clearRect(0, 0, PANEL_TEXTURE_WIDTH, PANEL_TEXTURE_HEIGHT);
    backCtx.save();
    backCtx.translate(PANEL_TEXTURE_WIDTH, 0);
    backCtx.scale(-1, 1);
    backCtx.drawImage(displayCanvas, 0, 0);
    backCtx.restore();

    const frontImage = frontTexture.image as HTMLCanvasElement;
    const frontCtx = frontImage.getContext("2d");
    const backImage = backTexture.image as HTMLCanvasElement;
    const backImageCtx = backImage.getContext("2d");
    if (frontCtx && backImageCtx) {
      frontCtx.clearRect(0, 0, frontImage.width, frontImage.height);
      frontCtx.drawImage(displayCanvas, 0, 0);
      backImageCtx.clearRect(0, 0, backImage.width, backImage.height);
      backImageCtx.drawImage(backCanvas, 0, 0);
    }

    frontTexture.needsUpdate = true;
    backTexture.needsUpdate = true;
  };

  const drawBody = (text: string) => {
    bodyCtx.clearRect(0, 0, PANEL_TEXTURE_WIDTH, PANEL_TEXTURE_HEIGHT);
    bodyCtx.save();
    bodyCtx.fillStyle = "rgba(255,255,255,0.95)";
    bodyCtx.font = "500 30px Thunder, sans-serif";
    bodyCtx.textAlign = "left";
    bodyCtx.textBaseline = "top";
    const maxWidth = PANEL_TEXTURE_WIDTH * 0.78;
    const lines = wrapText(bodyCtx, text, maxWidth);
    const lineHeight = 42;
    const top = PANEL_TEXTURE_HEIGHT * PANEL_BODY_TOP;
    const maxBottom = PANEL_TEXTURE_HEIGHT * PANEL_BODY_BOTTOM;
    let y = top;
    lines.forEach((line) => {
      if (y > maxBottom) return;
      bodyCtx.fillText(line, PANEL_TEXTURE_WIDTH * 0.11, y);
      y += lineHeight;
    });
    bodyCtx.restore();
    syncTextures();
  };

  const clearTimers = () => {
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
    timers.clear();
  };

  const clearResolver = () => {
    resolverToken += 1;
    clearTimers();
  };

  const resolveText = (text: string) => {
    clearResolver();
    const token = resolverToken;
    const characters = "abcdefghijklmnopqrstuvwxyz0123456789#%&-+_?/\\=";
    const resolved = text;

    return new Promise<void>((resolve) => {
      const step = (offset: number) => {
        if (token !== resolverToken) {
          resolve();
          return;
        }
        const partial = resolved.slice(0, offset);
        if (offset >= resolved.length) {
          bodyText = resolved;
          drawBody(bodyText);
          resolve();
          return;
        }

        let iterations = 8;
        const scramble = () => {
          if (token !== resolverToken) {
            resolve();
            return;
          }
          const randomCharacter =
            characters[Math.floor(Math.random() * characters.length)];
          drawBody(`${partial}${iterations === 0 ? "" : randomCharacter}`);
          if (iterations === 0) {
            const timer = window.setTimeout(() => step(offset + 1), 6);
            timers.add(timer);
            return;
          }
          iterations -= 1;
          const timer = window.setTimeout(scramble, 10);
          timers.add(timer);
        };
        scramble();
      };

      if (!resolved.trim()) {
        bodyText = "";
        drawBody("");
        resolve();
        return;
      }

      step(0);
    });
  };

  const clearBody = () => {
    clearResolver();
    bodyText = "";
    bodyCtx.clearRect(0, 0, PANEL_TEXTURE_WIDTH, PANEL_TEXTURE_HEIGHT);
    syncTextures();
  };

  syncTextures();

  return {
    bodyCanvas,
    displayCanvas,
    setPrompt(nextPrompt: string) {
      promptLabel = nextPrompt;
      syncTextures();
    },
    drawStaticText(nextText: string) {
      clearResolver();
      bodyText = nextText;
      drawBody(nextText);
    },
    resolveText,
    clearBody,
    hasRenderableText() {
      return bodyText.trim().length > 0;
    },
    getBodyText() {
      return bodyText;
    },
    refreshDisplay() {
      syncTextures();
    },
    cancelResolver: clearResolver,
  };
}

function createButton(
  label: string,
  action: "speak" | "send",
  position: THREE.Vector3
): ButtonRecord {
  const group = new THREE.Group();
  group.position.copy(position);

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(18, 5.5, 1.2),
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#11151f"),
      transmission: 0.32,
      opacity: 0.78,
      transparent: true,
      roughness: 0.16,
      thickness: 1,
      metalness: 0.08,
    })
  );
  group.add(mesh);

  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(18.04, 5.54, 1.24)),
    new THREE.LineBasicMaterial({
      color: new THREE.Color("white"),
      transparent: true,
      opacity: 0.24,
    })
  );
  group.add(frame);

  const labelSprite = createTextSprite(label, {
    width: 512,
    height: 128,
    fontSize: 44,
    opacity: 0.95,
  });
  labelSprite.sprite.position.set(0, 0, 1.2);
  labelSprite.sprite.scale.set(12, 3, 1);
  group.add(labelSprite.sprite);

  group.userData.action = action;

  return {
    action,
    group,
    frame,
    targetScale: 1,
  };
}

function createStarField() {
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const brightness = new Float32Array(STAR_COUNT);

  for (let index = 0; index < STAR_COUNT; index += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 600 + Math.random() * 400;
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.sin(phi) * Math.sin(theta);
    const z = radius * Math.cos(phi);
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
    sizes[index] =
      Math.random() < 0.05
        ? Math.random() * 3 + 2
        : Math.random() * 1.5 + 0.5;
    brightness[index] = Math.pow(Math.random(), 0.5) * 0.8 + 0.2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aBrightness", new THREE.BufferAttribute(brightness, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aBrightness;
      uniform float uTime;
      varying float vBrightness;

      void main() {
        vBrightness = aBrightness;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float safeZ = max(1.0, -mvPosition.z);
        gl_PointSize = aSize * (400.0 / safeZ);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying float vBrightness;

      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float d = length(uv);
        if (d > 0.5) discard;
        float twinkle = sin(uTime * 2.0 + vBrightness * 10.0) * 0.1;
        float alpha = smoothstep(0.5, 0.0, d) * clamp(vBrightness + twinkle, 0.0, 1.0);
        vec3 color = mix(
          vec3(0.85, 0.90, 1.0),
          vec3(1.0, 0.98, 0.92),
          vBrightness
        );
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);

  return {
    points,
    update(time: number) {
      material.uniforms.uTime.value = time;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export default function LearnPage() {
  const [appState, setAppState] = useState<AppState>("intro");
  const [topic, setTopic] = useState("");
  const [gate, setGate] = useState<FreemiumReason | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isFadingOverlay, setIsFadingOverlay] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);

  const mountRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechPauseTimerRef = useRef<number | null>(null);
  const latestTranscriptRef = useRef("");
  const threeSceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const panelGroupRef = useRef<THREE.Group | null>(null);
  const panelMeshRef = useRef<THREE.Mesh | null>(null);
  const contentGroupRef = useRef<THREE.Group | null>(null);
  const panelTextRef = useRef<PanelTextController | null>(null);
  const starFieldRef = useRef<ReturnType<typeof createStarField> | null>(null);
  const activeButtonsRef = useRef<ButtonRecord[]>([]);
  const hoveredActionRef = useRef<"speak" | "send" | null>(null);
  const interactiveReadyRef = useRef(false);
  const appStateRef = useRef<AppState>("intro");
  const handleSendRef = useRef<(forcedTopic?: string) => Promise<void>>(async () => { });
  const handleSpeakRef = useRef<() => void>(() => { });
  const cancelPlaybackRef = useRef<() => void>(() => { });
  const animationsRef = useRef<Animation[]>([]);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const objectMapRef = useRef<Map<string, WorldObjectRecord>>(new Map());
  const submissionIdRef = useRef(0);
  const playbackIdRef = useRef(0);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const panelTransitionIdRef = useRef(0);
  const hasEnteredExperience = appState !== "intro";

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  const setPromptLabel = useCallback((label: string) => {
    panelTextRef.current?.setPrompt(label);
  }, []);

  const cancelPlayback = useCallback(() => {
    playbackIdRef.current += 1;
    objectMapRef.current.clear();
    animationsRef.current = [];
    const group = contentGroupRef.current;
    if (!group) return;
    while (group.children.length > 0) {
      const child = group.children.pop();
      if (!child) continue;
      child.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        if (mesh.material) {
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          materials.forEach((material) => material.dispose());
        }
      });
      group.remove(child);
    }
  }, []);

  useEffect(() => {
    cancelPlaybackRef.current = cancelPlayback;
  }, [cancelPlayback]);

  const pushAnimation = useCallback((animation: Animation) => {
    animationsRef.current = [...animationsRef.current, animation];
  }, []);

  const tweenValue = useCallback(
    (
      durationMs: number,
      onUpdate: (progress: number) => void,
      onComplete?: () => void
    ) => {
      const start = performance.now();
      pushAnimation({
        update(now) {
          const progress = clamp((now - start) / durationMs, 0, 1);
          onUpdate(easeInOut(progress));
          if (progress >= 1) {
            onComplete?.();
            return true;
          }
          return false;
        },
      });
    },
    [pushAnimation]
  );

  const createWorldText = useCallback(
    (text: string, position: THREE.Vector3, fontSize: number, color?: string) => {
      const spriteRecord = createTextSprite(text, {
        width: 1024,
        height: 256,
        fontSize,
        color: color ?? "rgba(255,255,255,0.95)",
      });
      spriteRecord.sprite.position.copy(position);
      spriteRecord.sprite.scale.set(18, 4.8, 1);
      setObjectOpacity(spriteRecord.sprite, 0);
      return spriteRecord;
    },
    []
  );

  const addObjectToScene = useCallback(
    (id: string, record: WorldObjectRecord) => {
      contentGroupRef.current?.add(record.object);
      objectMapRef.current.set(id, record);
      setObjectOpacity(record.object, 0);
      tweenValue(550, (progress) => setObjectOpacity(record.object, progress));
    },
    [tweenValue]
  );

  const executeStep = useCallback(
    (step: DAODStepType) => {
      switch (step.type) {
        case "create_text": {
          const sprite = createWorldText(
            step.text,
            lessonToWorld(step.position),
            Math.max(32, (step.fontSize ?? 24) * 2),
            step.color
          );
          addObjectToScene(step.id, {
            object: sprite.sprite,
            updateText: sprite.updateText,
          });
          break;
        }
        case "create_latex": {
          const sprite = createWorldText(
            step.latex,
            lessonToWorld(step.position),
            52 * (step.scale ?? 1),
            step.color
          );
          addObjectToScene(step.id, {
            object: sprite.sprite,
            updateText: sprite.updateText,
          });
          break;
        }
        case "create_shape": {
          let object: THREE.Object3D;
          const color = new THREE.Color(step.color ?? "#4f8ef7");
          const strokeColor = new THREE.Color(step.strokeColor ?? "#ffffff");
          switch (step.shape) {
            case "circle":
              object = new THREE.Mesh(
                new THREE.CircleGeometry(Math.min(step.width, step.height) / 45, 48),
                new THREE.MeshBasicMaterial({
                  color,
                  transparent: true,
                  opacity: step.opacity,
                })
              );
              break;
            case "triangle": {
              const geometry = new THREE.BufferGeometry();
              const width = step.width / 28;
              const height = step.height / 28;
              geometry.setAttribute(
                "position",
                new THREE.BufferAttribute(
                  new Float32Array([
                    0,
                    height / 2,
                    0,
                    -width / 2,
                    -height / 2,
                    0,
                    width / 2,
                    -height / 2,
                    0,
                  ]),
                  3
                )
              );
              geometry.setIndex([0, 1, 2]);
              geometry.computeVertexNormals();
              object = new THREE.Mesh(
                geometry,
                new THREE.MeshBasicMaterial({
                  color,
                  transparent: true,
                  opacity: step.opacity,
                  side: THREE.DoubleSide,
                })
              );
              break;
            }
            case "line":
            case "arrow": {
              const points = [
                new THREE.Vector3(-step.width / 28, 0, 0),
                new THREE.Vector3(step.width / 28, 0, 0),
              ];
              object = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(points),
                new THREE.LineBasicMaterial({
                  color: strokeColor,
                  transparent: true,
                  opacity: step.opacity,
                })
              );
              break;
            }
            case "rectangle":
            default:
              object = new THREE.Mesh(
                new THREE.PlaneGeometry(step.width / 20, step.height / 20),
                new THREE.MeshBasicMaterial({
                  color,
                  transparent: true,
                  opacity: step.opacity,
                  side: THREE.DoubleSide,
                })
              );
              break;
          }

          object.position.copy(lessonToWorld(step.position));
          addObjectToScene(step.id, { object });
          break;
        }
        case "create_axes": {
          const width = 24;
          const height = 18;
          const group = new THREE.Group();
          group.position.copy(lessonToWorld(step.position));

          const material = new THREE.LineBasicMaterial({
            color: new THREE.Color(step.color ?? "#888888"),
            transparent: true,
            opacity: 0.72,
          });

          const xAxis = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(-width / 2, 0, 0),
              new THREE.Vector3(width / 2, 0, 0),
            ]),
            material.clone()
          );
          const yAxis = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(0, -height / 2, 0),
              new THREE.Vector3(0, height / 2, 0),
            ]),
            material.clone()
          );
          group.add(xAxis, yAxis);

          if (step.gridLines) {
            for (let index = -4; index <= 4; index += 1) {
              if (index === 0) continue;
              group.add(
                new THREE.Line(
                  new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3((index / 4) * (width / 2), -height / 2, 0),
                    new THREE.Vector3((index / 4) * (width / 2), height / 2, 0),
                  ]),
                  new THREE.LineBasicMaterial({
                    color: new THREE.Color(step.color ?? "#888888"),
                    transparent: true,
                    opacity: 0.12,
                  })
                )
              );
              group.add(
                new THREE.Line(
                  new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(-width / 2, (index / 4) * (height / 2), 0),
                    new THREE.Vector3(width / 2, (index / 4) * (height / 2), 0),
                  ]),
                  new THREE.LineBasicMaterial({
                    color: new THREE.Color(step.color ?? "#888888"),
                    transparent: true,
                    opacity: 0.12,
                  })
                )
              );
            }
          }

          const xLabel = createWorldText(step.xLabel ?? "x", new THREE.Vector3(width / 2 + 2, -1.2, 0), 34, "#ffffff");
          xLabel.sprite.position.add(group.position);
          const yLabel = createWorldText(step.yLabel ?? "y", new THREE.Vector3(1.2, height / 2 + 2, 0), 34, "#ffffff");
          yLabel.sprite.position.add(group.position);
          group.add(xLabel.sprite);
          group.add(yLabel.sprite);

          addObjectToScene(step.id, {
            object: group,
            axesMeta: {
              xRange: step.xRange ?? [-5, 5],
              yRange: step.yRange ?? [-5, 5],
              width,
              height,
            },
          });
          break;
        }
        case "plot_function": {
          const axes = objectMapRef.current.get(step.axesId);
          const axesObject = axes?.object;
          const meta = axes?.axesMeta;
          if (!axesObject || !meta) break;

          try {
            const fn = new Function("x", `return ${step.expression};`) as (x: number) => number;
            const points: THREE.Vector3[] = [];
            const samples = step.samples ?? 60;
            const [xMin, xMax] = meta.xRange;
            const [yMin, yMax] = meta.yRange;
            for (let index = 0; index <= samples; index += 1) {
              const x = xMin + ((xMax - xMin) * index) / samples;
              const y = fn(x);
              if (!Number.isFinite(y)) continue;
              const localX = ((x - xMin) / (xMax - xMin) - 0.5) * meta.width;
              const localY = ((y - yMin) / (yMax - yMin) - 0.5) * meta.height;
              points.push(new THREE.Vector3(localX, localY, 0.1));
            }
            const line = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(points),
              new THREE.LineBasicMaterial({
                color: new THREE.Color(step.color ?? "#f7c948"),
                transparent: true,
                opacity: 0.96,
              })
            );
            axesObject.add(line);
            break;
          } catch {
            break;
          }
        }
        case "create_dot": {
          const group = new THREE.Group();
          group.position.copy(lessonToWorld(step.position));
          group.add(
            new THREE.Mesh(
              new THREE.SphereGeometry((step.radius ?? 6) / 15, 24, 24),
              new THREE.MeshBasicMaterial({
                color: new THREE.Color(step.color ?? "#ff4f4f"),
                transparent: true,
                opacity: 0.96,
              })
            )
          );
          if (step.label) {
            const label = createWorldText(step.label, new THREE.Vector3(0, 2.2, 0), 32, "#ffffff");
            group.add(label.sprite);
          }
          addObjectToScene(step.id, { object: group });
          break;
        }
        case "transform_latex": {
          const target = objectMapRef.current.get(step.fromId);
          target?.updateText?.(step.toLaTeX);
          break;
        }
        case "highlight": {
          const target = objectMapRef.current.get(step.targetId)?.object;
          if (!target) break;
          const start = performance.now();
          pushAnimation({
            update(now) {
              const elapsed = (now - start) / 1000;
              const duration = step.duration;
              const progress = clamp(elapsed / duration, 0, 1);
              const pulse = 1 + Math.sin(progress * Math.PI * (step.pulses ?? 2) * 2) * 0.08;
              target.scale.setScalar(pulse);
              if (progress >= 1) {
                target.scale.setScalar(1);
                return true;
              }
              return false;
            },
          });
          break;
        }
        case "move_to": {
          const target = objectMapRef.current.get(step.targetId)?.object;
          if (!target) break;
          const from = target.position.clone();
          const to = lessonToWorld(step.position);
          tweenValue(step.duration * 1000, (progress) => {
            target.position.lerpVectors(from, to, progress);
          });
          break;
        }
        case "fade_out": {
          const target = objectMapRef.current.get(step.targetId)?.object;
          if (!target) break;
          tweenValue(
            step.duration * 1000,
            (progress) => setObjectOpacity(target, 1 - progress),
            () => {
              target.parent?.remove(target);
              objectMapRef.current.delete(step.targetId);
            }
          );
          break;
        }
        case "camera_move": {
          const camera = cameraRef.current;
          const controls = controlsRef.current;
          if (!camera || !controls) break;
          const startPosition = camera.position.clone();
          const targetPosition = new THREE.Vector3(
            step.position.x * 5.2,
            step.position.y * 5.2,
            clamp(step.position.z ?? 0, -6, 6) * 12 + 120 / Math.max(0.8, step.zoom ?? 1)
          );
          const startTarget = controls.target.clone();
          const endTarget = lessonToWorld(step.position);
          tweenValue(step.duration * 1000, (progress) => {
            camera.position.lerpVectors(startPosition, targetPosition, progress);
            controls.target.lerpVectors(startTarget, endTarget, progress);
          });
          break;
        }
        case "wait":
          break;
      }
    },
    [addObjectToScene, createWorldText, pushAnimation, tweenValue]
  );

  const transitionPanelText = useCallback(
    async (nextText: string, useDisintegration = false) => {
      const panel = panelTextRef.current;
      const scene = threeSceneRef.current;
      if (!panel) return;

      panelTransitionIdRef.current += 1;
      const transitionId = panelTransitionIdRef.current;
      panel.cancelResolver();

      if (
        useDisintegration &&
        panel.hasRenderableText() &&
        scene &&
        panelMeshRef.current
      ) {
        panel.clearBody();
      } else {
        panel.clearBody();
      }

      if (panelTransitionIdRef.current !== transitionId) return;
      await panel.resolveText(nextText);
    },
    []
  );

  const playScene = useCallback(
    async (sceneData: DAOD, submissionId: number, initialNarrationShown: boolean) => {
      console.log("[play] starting scene, steps:", sceneData.steps.length);
      pushClientLog("[play] starting scene, steps:", sceneData.steps.length);
      const playbackId = ++playbackIdRef.current;
      cancelPlayback();
      setAppState("playing");
      setPromptLabel(sceneData.title);

      try {
        for (let index = 0; index < sceneData.steps.length; index += 1) {
          if (
            playbackIdRef.current !== playbackId ||
            submissionIdRef.current !== submissionId
          ) {
            return;
          }

          const step = sceneData.steps[index];
          const narration = sceneData.narration[index] ?? sceneData.title;
          const stepId =
            "id" in step
              ? step.id
              : "targetId" in step
                ? step.targetId
                : step.type;
          console.log(
            "[play] step:",
            stepId,
            "narration:",
            narration.slice(0, 40)
          );
          pushClientLog(
            "[play] step:",
            stepId,
            "narration:",
            narration.slice(0, 40)
          );
          if (!(initialNarrationShown && index === 0)) {
            await panelTextRef.current?.resolveText(narration);
          }
          executeStep(step);

          let audioDuration = 0;
          if (audioContextRef.current) {
            try {
              audioDuration = await playNarration(narration, audioContextRef.current);
            } catch (error) {
              console.error("[DAOD] narration playback failed:", error);
              audioDuration = 0;
            }
          }

          const waitMs = Math.max(
            700,
            (sceneData.steps[index].duration ?? 1) * 1000,
            audioDuration * 1000
          );
          await new Promise<void>((resolve) => window.setTimeout(resolve, waitMs));
        }
      } catch (error) {
        console.error("[DAOD] playScene failed:", error);
        await transitionPanelText(ERROR_LABEL, panelTextRef.current?.hasRenderableText());
        setAppState("error");
      }
    },
    [cancelPlayback, executeStep, setPromptLabel, transitionPanelText]
  );

  const handleSend = useCallback(
    async (forcedTopic?: string) => {
      let submissionId = submissionIdRef.current;
      try {
        const finalTopic = (forcedTopic ?? topic).trim();
        if (!finalTopic) return;
        console.log("[send] topic:", finalTopic);
        pushClientLog("[send] topic:", finalTopic);

        submissionId = submissionIdRef.current + 1;
        submissionIdRef.current = submissionId;
        setTopic(finalTopic);
        setAppState("loading");
        setPromptLabel(finalTopic);

        recognitionRef.current?.stop();
        setIsListening(false);
        latestTranscriptRef.current = finalTopic;
        fetchControllerRef.current?.abort();
        fetchControllerRef.current = new AbortController();
        cancelPlayback();
        cancelActiveTextDisintegration();

        const panel = panelTextRef.current;
        const scene = threeSceneRef.current;
        const panelMesh = panelMeshRef.current;
        const panelHasContent = panel?.hasRenderableText() ?? false;

        const fetchPromise = fetch("/api/scene/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: finalTopic }),
          signal: fetchControllerRef.current.signal,
        }).then(async (response) => {
          if (response.status === 402) {
            setGate("limit");
            setAppState("input");
            throw new Error("limit");
          }
          if (!response.ok) {
            throw new Error(await response.text());
          }
          return (await response.json()) as DAOD;
        });

        const clearPromise = new Promise<void>((resolve) => {
          panel?.clearBody();
          resolve();
        });

        const [data] = await Promise.all([fetchPromise, clearPromise]);
        if (!data || submissionIdRef.current !== submissionId) return;
        console.log("[send] scene steps:", data?.steps?.length);
        pushClientLog("[send] scene steps:", data?.steps?.length);

        if (!data?.steps?.length) {
          throw new Error("invalid scene");
        }

        void playScene(data, submissionId, false);
      } catch (err) {
        if (submissionId !== submissionIdRef.current) return;
        cancelActiveTextDisintegration();
        console.error("[send/play] ERROR:", err);
        pushClientLog("[send/play] ERROR:", err);
        setAppState("error");
        setPromptLabel(DEFAULT_LABEL);
        await transitionPanelText(ERROR_LABEL, panelTextRef.current?.hasRenderableText());
        return;
      }
    },
    [cancelPlayback, playScene, setPromptLabel, topic, transitionPanelText]
  );

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  const handleSpeak = useCallback(() => {
    const SpeechRecognitionCtor =
      (typeof window !== "undefined" &&
        (window.SpeechRecognition || window.webkitSpeechRecognition)) ||
      null;
    if (!SpeechRecognitionCtor) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-GB";
    recognition.continuous = true;
    recognition.interimResults = true;

    const resetPauseTimer = () => {
      if (speechPauseTimerRef.current) {
        window.clearTimeout(speechPauseTimerRef.current);
      }
      speechPauseTimerRef.current = window.setTimeout(() => {
        recognition.stop();
        const transcript = latestTranscriptRef.current.trim();
        if (transcript) {
          void handleSend(transcript);
        }
      }, 1500);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(
        { length: event.results.length },
        (_, index) => event.results[index][0].transcript
      ).join("");
      latestTranscriptRef.current = transcript;
      setTopic(transcript);
      resetPauseTimer();
    };

    recognition.onend = () => {
      setIsListening(false);
      if (speechPauseTimerRef.current) {
        window.clearTimeout(speechPauseTimerRef.current);
        speechPauseTimerRef.current = null;
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      if (speechPauseTimerRef.current) {
        window.clearTimeout(speechPauseTimerRef.current);
        speechPauseTimerRef.current = null;
      }
    };

    latestTranscriptRef.current = topic;
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    resetPauseTimer();
  }, [handleSend, isListening, topic]);

  useEffect(() => {
    handleSpeakRef.current = handleSpeak;
  }, [handleSpeak]);

  const handleUnlockAudio = useCallback(async () => {
    setIsFadingOverlay(true);
    // AudioContext MUST be created inside a user-gesture handler — never in useEffect
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    audioContextRef.current = ctx;
    console.log('[unlock] ctx state:', ctx.state);

    window.setTimeout(() => {
      setAppState("input");
      setIsFadingOverlay(false);
      panelTextRef.current?.setPrompt(DEFAULT_LABEL);
      panelTextRef.current?.drawStaticText("ask a maths question to enter the void.");
    }, 400);
  }, []);

  useEffect(() => {
    if (!hasEnteredExperience) return;
    const mount = mountRef.current;
    if (!mount || rendererRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#000000");
    threeSceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      mount.clientWidth / mount.clientHeight,
      0.1,
      5000
    );
    camera.position.set(0, 0, 120);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 40;
    controls.maxDistance = 400;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight("#ffffff", 0.95));
    const rim = new THREE.PointLight("#9ec5ff", 1.5, 600);
    rim.position.set(80, 50, 120);
    scene.add(rim);

    const stars = createStarField();
    scene.add(stars.points);
    starFieldRef.current = stars;

    const panelTextureCanvas = document.createElement("canvas");
    panelTextureCanvas.width = PANEL_TEXTURE_WIDTH;
    panelTextureCanvas.height = PANEL_TEXTURE_HEIGHT;
    const frontTexture = new THREE.CanvasTexture(panelTextureCanvas);
    frontTexture.colorSpace = THREE.SRGBColorSpace;
    const backTextureCanvas = document.createElement("canvas");
    backTextureCanvas.width = PANEL_TEXTURE_WIDTH;
    backTextureCanvas.height = PANEL_TEXTURE_HEIGHT;
    const backTexture = new THREE.CanvasTexture(backTextureCanvas);
    backTexture.colorSpace = THREE.SRGBColorSpace;

    const panelController = createPanelTextController(frontTexture, backTexture);
    panelTextRef.current = panelController;

    const panelGroup = new THREE.Group();
    const frontPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
      createPanelMaterial(frontTexture, 0.0)
    );
    frontPanel.position.z = 0.05;
    panelMeshRef.current = frontPanel;
    const backPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
      createPanelMaterial(backTexture, 0.22)
    );
    backPanel.rotation.y = Math.PI;
    backPanel.position.z = -0.05;
    panelGroup.add(frontPanel, backPanel);

    const contentGroup = new THREE.Group();
    panelGroupRef.current = panelGroup;
    contentGroupRef.current = contentGroup;
    scene.add(panelGroup, contentGroup);

    const speakButton = createButton("SPEAK", "speak", new THREE.Vector3(-12, -23, 1.8));
    const sendButton = createButton("SEND", "send", new THREE.Vector3(12, -23, 1.8));
    panelGroup.add(speakButton.group, sendButton.group);
    activeButtonsRef.current = [speakButton, sendButton];
    interactiveReadyRef.current = true;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const handlePointerMove = (event: PointerEvent) => {
      if (!interactiveReadyRef.current || !rendererRef.current || !cameraRef.current) {
        return;
      }
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, cameraRef.current);
      const hits = raycaster.intersectObjects(
        activeButtonsRef.current.map((button) => button.group),
        true
      );
      const action = (hits[0]?.object.parent?.userData.action ??
        hits[0]?.object.userData.action ??
        null) as "speak" | "send" | null;
      hoveredActionRef.current = action;
      rendererRef.current.domElement.style.cursor = action ? "pointer" : "grab";
    };

    const handlePointerClick = () => {
      if (
        hoveredActionRef.current === "speak" &&
        appStateRef.current !== "audio-unlock"
      ) {
        handleSpeakRef.current();
      }
      if (
        hoveredActionRef.current === "send" &&
        appStateRef.current !== "audio-unlock"
      ) {
        void handleSendRef.current();
      }
    };

    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("click", handlePointerClick);

    const resizeObserver = new ResizeObserver(() => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const width = mountRef.current.clientWidth;
      const height = mountRef.current.clientHeight;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    });
    resizeObserver.observe(mount);

    lastFrameRef.current = performance.now();
    const animate = (now: number) => {
      lastFrameRef.current = now;
      rafRef.current = window.requestAnimationFrame(animate);

      stars.update(now / 1000);

      panelGroup.position.y = Math.sin(now * 0.0005) * 1.5;
      panelGroup.rotation.y = Math.sin(now * 0.0003) * 0.02;

      activeButtonsRef.current.forEach((button) => {
        button.targetScale = hoveredActionRef.current === button.action ? 1.08 : 1;
        button.group.scale.lerp(
          new THREE.Vector3(button.targetScale, button.targetScale, button.targetScale),
          0.12
        );
        (
          button.frame.material as THREE.LineBasicMaterial
        ).opacity = hoveredActionRef.current === button.action ? 0.78 : 0.24;
      });

      animationsRef.current = animationsRef.current.filter(
        (animation) => !animation.update(now)
      );
      controls.update();
      renderer.render(scene, camera);
    };

    rafRef.current = window.requestAnimationFrame(animate);
    panelController.setPrompt(DEFAULT_LABEL);
    panelController.drawStaticText("ask a maths question to enter the void.");

    return () => {
      resizeObserver.disconnect();
      cancelActiveTextDisintegration();
      window.cancelAnimationFrame(rafRef.current);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("click", handlePointerClick);
      recognitionRef.current?.stop();
      fetchControllerRef.current?.abort();
      stars.dispose();
      controls.dispose();
      cancelPlaybackRef.current();
      frontTexture.dispose();
      backTexture.dispose();
      (frontPanel.material as THREE.Material).dispose();
      (backPanel.material as THREE.Material).dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      threeSceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      panelGroupRef.current = null;
      panelMeshRef.current = null;
      contentGroupRef.current = null;
      panelTextRef.current = null;
    };
  }, [hasEnteredExperience]);

  useEffect(() => {
    return () => {
      if (speechPauseTimerRef.current) {
        window.clearTimeout(speechPauseTimerRef.current);
      }
    };
  }, []);

  if (appState === "intro") {
    return (
      <VoidIntro logoSrc="/logo1.jpeg" onComplete={() => setAppState("audio-unlock")} />
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {gate && (
        <FreemiumGate
          reason={gate}
          onUpgrade={() => {
            setGate(null);
            window.open("https://daod.app/upgrade", "_blank");
          }}
          onDismiss={() => setGate(null)}
        />
      )}

      <div ref={mountRef} className="absolute inset-0" />

      {appState === "audio-unlock" && (
        <div
          className={`absolute inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-black transition-opacity duration-400 ease-in-out ${isFadingOverlay ? "opacity-0" : "opacity-100"
            }`}
          onClick={handleUnlockAudio}
        >
          <svg
            width="150"
            height="150"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="mb-8 opacity-80"
          >
            <ellipse
              cx="50"
              cy="50"
              rx="40"
              ry="15"
              transform="rotate(30 50 50)"
              stroke="white"
              strokeWidth="2"
            />
            <ellipse
              cx="50"
              cy="50"
              rx="40"
              ry="15"
              transform="rotate(90 50 50)"
              stroke="white"
              strokeWidth="2"
            />
            <ellipse
              cx="50"
              cy="50"
              rx="40"
              ry="15"
              transform="rotate(150 50 50)"
              stroke="white"
              strokeWidth="2"
            />
          </svg>
          <div
            className="uppercase"
            style={{
              fontFamily: "'LemonWide', serif",
              fontSize: "40px",
              letterSpacing: "0.35em",
              color: "rgba(240, 237, 230, 0.45)"
            }}
          >
            tap anywhere to begin
          </div>
        </div>
      )}

      {(appState === "input" || appState === "loading" || appState === "error") && (
        <div className="pointer-events-none absolute inset-x-0 bottom-12 z-20 flex flex-col items-center gap-6 px-6">
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder={isListening ? "listening..." : "type a maths topic"}
            className="pointer-events-auto w-[400px] max-w-[90vw] border-0 border-b border-white/30 bg-transparent pb-3 text-center text-[16px] text-white outline-none placeholder:text-white/28"
            style={{ fontFamily: "Georgia, serif" }}
          />
          <div className="pointer-events-auto">
            <ThinkingDots visible={appState === "loading"} message="thinking..." />
          </div>
          {appState === "error" && (
            <button
              onClick={() => {
                setAppState("input");
                setPromptLabel(DEFAULT_LABEL);
                void transitionPanelText(
                  "ask a maths question to enter the void.",
                  false
                );
              }}
              className="pointer-events-auto text-sm text-white/55 transition hover:text-white"
            >
              try again
            </button>
          )}
        </div>
      )}

      {appState === "input" && (
        <TopicPills
          onSelect={(t) => {
            setTopic(t);
            void handleSend(t);
          }}
          disabled={false}
        />
      )}

      {appState === "playing" && (
        <button
          onClick={() => {
            cancelPlayback();
            setTopic("");
            setAppState("input");
            setPromptLabel(DEFAULT_LABEL);
            void transitionPanelText("ask a maths question to enter the void.", true);
          }}
          className="absolute right-6 top-6 z-20 text-2xl text-white/50 transition hover:text-white"
        >
          ✕
        </button>
      )}
    </div>
  );
}
