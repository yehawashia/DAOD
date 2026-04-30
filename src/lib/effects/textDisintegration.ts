import * as THREE from "three";

const GRID_COLS = 40;
const GRID_ROWS = 25;

type ActiveEffect = {
  cancel: () => void;
  finished: Promise<void>;
};

let activeRunId = 0;
let activeEffect: ActiveEffect | null = null;

function randomInRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomSpread(range: number) {
  return (Math.random() - 0.5) * range;
}

function buildGeometry(panelWidth: number, panelHeight: number) {
  // Safety: clamp to world-unit panel dimensions if screen pixels are accidentally passed in
  const safeW = panelWidth > 200 ? 80 : panelWidth;
  const safeH = panelHeight > 200 ? 55 : panelHeight;
  panelWidth = safeW;
  panelHeight = safeH;

  const cellWidth = panelWidth / GRID_COLS;
  const cellHeight = panelHeight / GRID_ROWS;
  const quadCount = GRID_COLS * GRID_ROWS;
  const triangleCount = quadCount * 2;
  const vertexCount = triangleCount * 3;

  const positions = new Float32Array(vertexCount * 3);
  const centroids = new Float32Array(vertexCount * 3);
  const animations = new Float32Array(vertexCount * 2);
  const control0 = new Float32Array(vertexCount * 3);
  const control1 = new Float32Array(vertexCount * 3);
  const endPositions = new Float32Array(vertexCount * 3);

  const maxDist = Math.sqrt(
    Math.pow(panelWidth / 2, 2) + Math.pow(panelHeight / 2, 2)
  );

  let vertexOffset = 0;
  let maxDelay = 0;
  let maxDuration = 0;

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const x0 = -panelWidth / 2 + col * cellWidth;
      const x1 = x0 + cellWidth;
      const y0 = panelHeight / 2 - row * cellHeight;
      const y1 = y0 - cellHeight;
      const centroid = new THREE.Vector3(
        (x0 + x1) / 2,
        (y0 + y1) / 2,
        0.6
      );

      const distFromCenter = centroid.length() / maxDist;
      const delay = distFromCenter * 1.5 + Math.random() * 0.3;
      const duration = randomInRange(1.5, 3.0);
      maxDelay = Math.max(maxDelay, delay);
      maxDuration = Math.max(maxDuration, duration);

      const c0 = centroid.clone().add(
        new THREE.Vector3(
          randomInRange(-30, 30),
          randomInRange(0, 40),
          randomInRange(20, 60)
        )
      );
      const c1 = centroid.clone().add(
        new THREE.Vector3(
          randomInRange(-60, 60),
          randomInRange(-20, 80),
          randomInRange(40, 100)
        )
      );
      const endPosition = centroid.clone().add(
        new THREE.Vector3(
          randomSpread(120),
          randomInRange(-30, 60),
          randomInRange(20, 80)
        )
      );

      const vertices = [
        new THREE.Vector3(x0, y0, 0.6),
        new THREE.Vector3(x1, y0, 0.6),
        new THREE.Vector3(x0, y1, 0.6),
        new THREE.Vector3(x1, y0, 0.6),
        new THREE.Vector3(x1, y1, 0.6),
        new THREE.Vector3(x0, y1, 0.6),
      ];

      vertices.forEach((vertex) => {
        positions.set([vertex.x, vertex.y, vertex.z], vertexOffset * 3);
        centroids.set([centroid.x, centroid.y, centroid.z], vertexOffset * 3);
        animations.set([delay, duration], vertexOffset * 2);
        control0.set([c0.x, c0.y, c0.z], vertexOffset * 3);
        control1.set([c1.x, c1.y, c1.z], vertexOffset * 3);
        endPositions.set(
          [endPosition.x, endPosition.y, endPosition.z],
          vertexOffset * 3
        );
        vertexOffset += 1;
      });
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aCentroid", new THREE.BufferAttribute(centroids, 3));
  geometry.setAttribute("aAnimation", new THREE.BufferAttribute(animations, 2));
  geometry.setAttribute("aControl0", new THREE.BufferAttribute(control0, 3));
  geometry.setAttribute("aControl1", new THREE.BufferAttribute(control1, 3));
  geometry.setAttribute("aEndPosition", new THREE.BufferAttribute(endPositions, 3));

  return {
    geometry,
    totalDuration: maxDelay + maxDuration,
  };
}

function createMaterial(panelWidth: number, panelHeight: number) {
  const safeW = panelWidth > 200 ? 80 : panelWidth;
  const safeH = panelHeight > 200 ? 55 : panelHeight;
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uPanelSize: { value: new THREE.Vector2(safeW, safeH) },
    },
    vertexShader: `
      uniform float uTime;

      attribute vec2 aAnimation;
      attribute vec3 aCentroid;
      attribute vec3 aControl0;
      attribute vec3 aControl1;
      attribute vec3 aEndPosition;

      varying float vProgress;

      vec3 cubicBezier(vec3 p0, vec3 c0, vec3 c1, vec3 p1, float t) {
        float t2 = t * t;
        float t3 = t2 * t;
        float mt = 1.0 - t;
        float mt2 = mt * mt;
        float mt3 = mt2 * mt;
        return mt3 * p0 + 3.0 * mt2 * t * c0 + 3.0 * mt * t2 * c1 + t3 * p1;
      }

      float easeOutCubic(float t) {
        return 1.0 - pow(1.0 - t, 3.0);
      }

      void main() {
        float delay = aAnimation.x;
        float duration = aAnimation.y;
        float elapsed = max(0.0, uTime - delay);
        float tProgress = easeOutCubic(clamp(elapsed / duration, 0.0, 1.0));
        vProgress = tProgress;

        vec3 tPosition = position - aCentroid;
        tPosition *= (1.0 - tProgress);
        tPosition += aCentroid;
        tPosition += cubicBezier(vec3(0.0), aControl0, aControl1, aEndPosition, tProgress);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(tPosition, 1.0);
      }
    `,
    fragmentShader: `
      varying float vProgress;

      void main() {
        float alpha = 1.0 - smoothstep(0.6, 1.0, vProgress);
        if (alpha < 0.01) discard;
        vec3 color = vec3(0.95, 0.93, 0.88);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

export function cancelActiveTextDisintegration() {
  activeEffect?.cancel();
  activeEffect = null;
}

export function disintegrateAndResolve(
  scene: THREE.Scene,
  panelWidth: number,
  panelHeight: number,
  panelWorldMatrix: THREE.Matrix4,
  onReady: () => void
): ActiveEffect {
  const runId = ++activeRunId;
  cancelActiveTextDisintegration();

  const safeW = panelWidth > 200 || panelWidth <= 0 ? 80 : panelWidth;
  const safeH = panelHeight > 200 || panelHeight <= 0 ? 55 : panelHeight;

  console.log("[dis] using dimensions:", safeW, "x", safeH);
  console.log(
    "[dis] matrix translation:",
    panelWorldMatrix.elements[12],
    panelWorldMatrix.elements[13],
    panelWorldMatrix.elements[14]
  );

  const { geometry, totalDuration } = buildGeometry(safeW, safeH);
  const material = createMaterial(safeW, safeH);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.applyMatrix4(panelWorldMatrix);
  scene.add(mesh);

  let rafId = 0;
  let done = false;
  const startedAt = performance.now();

  const cleanup = () => {
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  };

  // Extract the resolver so `finish` and `update` can be defined outside the
  // Promise constructor, avoiding the temporal dead zone that occurs when
  // `finished` is referenced inside its own `new Promise()` callback.
  let resolveFinished!: () => void;
  const finished = new Promise<void>((r) => {
    resolveFinished = r;
  });

  const finish = () => {
    if (done) return;
    done = true;
    window.cancelAnimationFrame(rafId);
    cleanup();
    if (activeEffect?.finished === finished) {
      activeEffect = null;
    }
    if (activeRunId === runId) {
      onReady();
    }
    resolveFinished();
  };

  const update = (now: number) => {
    if (activeRunId !== runId) {
      finish();
      return;
    }

    const delta = (now - startedAt) / 1000;
    material.uniforms.uTime.value = delta * 1.2;
    if (delta * 1.2 >= totalDuration) {
      finish();
      return;
    }

    rafId = window.requestAnimationFrame(update);
  };

  rafId = window.requestAnimationFrame(update);

  // `finished` is fully assigned before this point — no TDZ
  activeEffect = {
    cancel: finish,
    finished,
  };

  return activeEffect;
}
