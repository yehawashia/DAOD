// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · the 3D world, in raw WebGL2 (no Three.js: ~20 KB instead of ~600 KB)
//
// Draw order (painter's, no depth buffer needed — everything is translucent):
//   1. background   one full-screen triangle: radial void gradient
//   2. floor        one quad: procedural grid + a scan line + light pool
//   3. dust         one draw of ~900 points, animated entirely on the GPU
//   4. reflection   the board again, mirrored under the floor, faded
//   5. board        smoked glass + the ink texture + chalk glow + pen light
//   6. presence     the DAOD trefoil, ~4k line vertices, animated on the GPU
//
// Six draw calls per frame. Nothing animates on the CPU except a few
// uniforms, and the ink texture is only re-uploaded when the board changes.
// ─────────────────────────────────────────────────────────────────────────────

const BOARD_W = 3.2, BOARD_H = 1.8;     // world units (16:9, matches 1600×900)
const BOARD_Y = 0.1, FLOOR_Y = -1.32;

// ── Shaders ──────────────────────────────────────────────────────────────────

const BG_VS = `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;
const BG_FS = `#version 300 es
precision mediump float;
in vec2 vUv; out vec4 o;
uniform vec2 uRes; uniform float uMood;
void main(){
  vec2 p = (vUv - vec2(0.5, 0.56)) * vec2(uRes.x/uRes.y, 1.0);
  float r = length(p);
  vec3 c = mix(vec3(0.045,0.046,0.05), vec3(0.0), smoothstep(0.0, 1.1, r));
  c += vec3(0.02,0.016,0.01) * uMood * exp(-r*3.0);          // a faint warmth while thinking
  // Ordered dither to kill gradient banding on 8-bit displays.
  float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453) / 255.0;
  o = vec4(c + d, 1.0);
}`;

// Generic transformed mesh (floor + board share it).
const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUv;
uniform mat4 uVP, uModel;
out vec2 vUv; out vec3 vWorld;
void main(){ vec4 w = uModel * vec4(aPos,1.0); vWorld = w.xyz; vUv = aUv; gl_Position = uVP * w; }`;

const FLOOR_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vWorld; out vec4 o;
uniform float uTime; uniform vec3 uCam; uniform float uInk;
float grid(vec2 p, float s){ vec2 g = abs(fract(p/s - 0.5) - 0.5) / fwidth(p/s); return 1.0 - min(min(g.x, g.y), 1.0); }
void main(){
  vec2 p = vWorld.xz;
  float fade = exp(-length(p - vec2(0.0, -0.4)) * 0.32);
  float g = grid(p, 0.5) * 0.55 + grid(p, 2.0) * 0.45;
  // The slow scan line from DAOD v1, now sweeping the floor toward the viewer.
  float scan = exp(-pow((p.y - (mod(uTime*0.35, 14.0) - 9.0)) * 3.0, 2.0)) * 0.6;
  // A pool of light under the glass that brightens as the board fills with ink.
  float pool = exp(-dot(p*vec2(0.55,1.4), p*vec2(0.55,1.4))) * (0.05 + 0.08*uInk);
  float a = (g * (0.10 + scan) ) * fade + pool;
  vec3 c = vec3(0.94, 0.93, 0.90);
  o = vec4(c * a, a);   // premultiplied
}`;

const BOARD_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vWorld; out vec4 o;
uniform sampler2D uInk;
uniform vec2 uSize;          // board size in world units
uniform vec3 uCam;
uniform float uTime;
uniform vec3 uPen;           // pen uv (x, y) and intensity
uniform vec3 uRim;           // rim colour: shifts with the tutor's state
uniform float uReflect;      // 0 = the board, >0 = its floor reflection strength
uniform float uFloorY;
float sdRound(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
void main(){
  vec2 p = (vUv - 0.5) * uSize;
  float d = sdRound(p, uSize*0.5, 0.06);
  float aa = fwidth(d) * 1.2;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  if (inside <= 0.0) discard;

  vec3 V = normalize(uCam - vWorld);
  float fres = pow(1.0 - clamp(abs(V.z), 0.0, 1.0), 3.0);

  // Smoked glass body, slightly lighter at the top like a soft overhead light.
  float body = 0.40 + 0.06 * vUv.y + fres * 0.35;
  vec3 glass = mix(vec3(0.030,0.032,0.036), vec3(0.075,0.078,0.085), vUv.y);
  // A faint dot grid: graph paper you only notice when you look.
  vec2 gp = vUv * vec2(40.0, 22.5);
  vec2 gd = abs(fract(gp) - 0.5) / fwidth(gp);
  float dots = (1.0 - min(length(gd) * 0.35, 1.0)) * 0.08;
  // A slow diagonal sheen sweeping across the glass.
  float phase = mod(uTime * 0.11, 3.0) * 2.4 - 3.0;
  float sheen = exp(-pow((p.x * 0.55 + p.y - phase) / 0.18, 2.0)) * 0.045;
  // Bright bevelled rim + a soft inner edge glow.
  float rim = (1.0 - smoothstep(0.0, aa * 2.5, abs(d + 0.006))) * 0.55;
  float inner = exp(-abs(d) * 26.0) * 0.10;

  vec2 iuv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 ink = texture(uInk, iuv);                                   // premultiplied
  // Chalk glow for free: sample blurrier mip levels of the same texture.
  vec4 glow = textureLod(uInk, iuv, 3.5) * 0.55 + textureLod(uInk, iuv, 5.0) * 0.45;

  // The pen: a small hot light where the tutor is writing.
  float pd = length((vUv - uPen.xy) * uSize);
  float pen = uPen.z * (exp(-pd*pd*900.0) * 1.2 + exp(-pd*14.0) * 0.18);

  vec3 col = glass * body + vec3(dots + sheen) + uRim * (rim + inner);
  float a = body * 0.62 + rim + inner * 0.5;
  col += ink.rgb + glow.rgb * 0.75 + vec3(1.0, 0.95, 0.85) * pen;
  a = clamp(a + ink.a + glow.a * 0.3 + pen, 0.0, 1.0);

  if (uReflect > 0.0) {
    // Mirror image under the floor: fades with depth below the floor plane.
    float k = uReflect * exp(-(uFloorY - vWorld.y) * 2.4);
    col *= k; a *= k;
  }
  o = vec4(col * inside, a * inside);
}`;

const DUST_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aSeed;
uniform mat4 uVP; uniform float uTime, uPx, uMotion;
out float vA;
void main(){
  vec3 p = aPos;
  float t = uTime * uMotion;
  p.x += sin(t * 0.07 * aSeed.x + aSeed.y * 6.28) * 0.35;
  p.y = mod(p.y + t * 0.025 * aSeed.z + 1.6, 5.2) - 1.6;        // rise slowly and wrap
  p.z += cos(t * 0.05 * aSeed.y + aSeed.x * 6.28) * 0.25;
  vec4 c = uVP * vec4(p, 1.0);
  gl_Position = c;
  gl_PointSize = clamp((1.2 + aSeed.x * 2.2) * uPx * 7.0 / c.w, 1.0, 8.0);   // uPx = canvas height / 900
  vA = (0.25 + 0.75 * aSeed.z) * (0.55 + 0.45 * sin(uTime * (0.6 + aSeed.y) + aSeed.x * 40.0));
  vA *= smoothstep(9.0, 2.0, c.w);                                // fade with distance
}`;
const DUST_FS = `#version 300 es
precision mediump float;
in float vA; out vec4 o;
void main(){ vec2 q = gl_PointCoord - 0.5; float a = exp(-dot(q,q) * 18.0) * vA * 0.5; o = vec4(vec3(0.95,0.93,0.88) * a, 0.0); }`;

const PRESENCE_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aInfo;   // info: x = position along lobe (−1 = outer ring), y = lobe index
uniform mat4 uVP; uniform vec3 uAt; uniform float uScale, uTime, uSpin, uLevel, uActive;
out float vA;
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }
void main(){
  vec3 p = aPos;
  float s = aInfo.x;
  if (s >= 0.0) {
    // Inner loops ripple outward while the tutor is thinking or speaking.
    float k = aInfo.y * 2.094 + 1.571;
    vec2 dir = vec2(cos(k), sin(k));
    p.xy += dir * sin(uTime * 4.0 - s * 9.0) * 0.035 * uActive * s;
    p.z  += sin(uTime * 2.3 + s * 7.0 + aInfo.y) * 0.04 * uActive;
  }
  float breathe = 1.0 + 0.025 * sin(uTime * 1.2) + uLevel * 0.16;
  p = rotY(sin(uTime*0.23)*0.35 + uLevel*0.2) * rotX(0.22 + sin(uTime*0.17)*0.1) * rotZ(uSpin) * (p * breathe);
  gl_Position = uVP * vec4(uAt + p * uScale, 1.0);
  vA = s < 0.0 ? 0.9 : 0.30 + 0.25 * sin(uTime * 3.0 - s * 6.0) * uActive;
}`;
const PRESENCE_FS = `#version 300 es
precision mediump float;
in float vA; out vec4 o; uniform float uBright; uniform vec3 uTint;
void main(){ float a = vA * uBright; o = vec4(uTint * a, 0.0); }`;

// ── Tiny matrix helpers (column-major, like GLSL) ───────────────────────────
const M = {
  perspective(/** @type {number} */ fovy, /** @type {number} */ aspect, /** @type {number} */ near, /** @type {number} */ far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(/** @type {number[]} */ e, /** @type {number[]} */ t) {
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = zz, xy = 0, xz = -zx;                       // up = +y
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  },
  mul(/** @type {Float32Array} */ a, /** @type {Float32Array} */ b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  translate(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); },
  scale(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) { return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]); },
};

/**
 * @typedef {object} FrameState  what the rest of the app tells the renderer each frame
 * @property {'idle'|'listening'|'thinking'|'speaking'|'paused'} mode
 * @property {number} level        0..1 loudness of whoever is talking
 * @property {number[]|null} pen  pen tip on the 1600×900 board, or null
 * @property {number} ink          0..1 how full the board is (for the floor glow)
 */

export class Scene {
  /** @param {HTMLCanvasElement} canvas @param {HTMLCanvasElement} inkCanvas */
  constructor(canvas, inkCanvas) {
    this.canvas = canvas;
    this.inkCanvas = inkCanvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = this.maxDpr;
    this.frameMs = 16;
    this.slowFor = 0; this.fastFor = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Camera: orbit angles, eased toward targets (never snapped).
    this.cam = { yaw: 0, pitch: 0.07, zoom: 1, tYaw: 0, tPitch: 0.07, tZoom: 1, px: 0, py: 0 };
    this.lastInput = 0;
    // Presence smoothing.
    this.spin = 0; this.level = 0; this.active = 0; this.bright = 0.6; this.penA = 0;
    this.penUv = [0.5, 0.5];
    this.rim = [0.94, 0.93, 0.9]; this.mood = 0;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.init(); this.lost = false; });
    this.init();
    this.bindInput();
  }

  init() {
    const gl = this.gl;
    this.pBg = program(gl, BG_VS, BG_FS);
    this.pFloor = program(gl, MESH_VS, FLOOR_FS);
    this.pBoard = program(gl, MESH_VS, BOARD_FS);
    this.pDust = program(gl, DUST_VS, DUST_FS);
    this.pPresence = program(gl, PRESENCE_VS, PRESENCE_FS);
    this.vaoEmpty = gl.createVertexArray();

    // Unit quad (−0.5..0.5) in XY with UVs; scaled per use.
    this.quad = vao(gl, [[0, 3, new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0])],
      [1, 2, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])]]);

    // Dust: positions in a box around the board, plus per-particle random seeds.
    const N = matchMedia('(max-width: 700px)').matches ? 450 : 900;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N * 3);
    let r = 1234567;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);   // deterministic
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rnd() - 0.5) * 12; pos[i * 3 + 1] = rnd() * 5.2 - 1.6; pos[i * 3 + 2] = (rnd() - 0.75) * 9;
      seed[i * 3] = rnd(); seed[i * 3 + 1] = rnd(); seed[i * 3 + 2] = rnd();
    }
    this.dust = vao(gl, [[0, 3, pos], [1, 3, seed]]);
    this.dustN = N;

    // Presence: the DAOD trefoil, built as line segments.
    const tre = trefoil();
    this.presence = vao(gl, [[0, 3, tre.pos], [1, 2, tre.info]]);
    this.presenceN = tre.count;

    // Ink texture: immutable storage with a full mip chain (for the glow).
    this.inkTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.inkTex);
    const w = this.inkCanvas.width, h = this.inkCanvas.height;
    this.inkLevels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, this.inkLevels, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    this.inkDirty = true;
  }

  /** Mark the ink canvas as changed: it is uploaded on the next frame. */
  inkChanged() { this.inkDirty = true; }

  // ── Input: drag to orbit, wheel/pinch to zoom, double-click to reset ──────
  bindInput() {
    const c = this.canvas;
    /** @type {Map<number,{x:number,y:number}>} */ const pts = new Map();
    let pinch = 0;
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.lastInput = performance.now(); });
    c.addEventListener('pointermove', (e) => {
      // Gentle parallax follows the pointer even without dragging.
      this.cam.px = (e.clientX / innerWidth - 0.5); this.cam.py = (e.clientY / innerHeight - 0.5);
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      this.lastInput = performance.now();
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a2, b2] = [...pts.values()];
        const d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (pinch && d0) this.cam.tZoom = clamp(this.cam.tZoom * (d0 / d1), 0.6, 1.5);
        pinch = 1;
        return;
      }
      this.cam.tYaw = clamp(this.cam.tYaw - (e.clientX - prev.x) * 0.0045, -0.75, 0.75);
      this.cam.tPitch = clamp(this.cam.tPitch + (e.clientY - prev.y) * 0.0035, -0.2, 0.5);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    const up = (/** @type {PointerEvent} */ e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.lastInput = performance.now(); this.cam.tZoom = clamp(this.cam.tZoom * Math.exp(e.deltaY * 0.0012), 0.6, 1.5); }, { passive: false });
    c.addEventListener('dblclick', () => this.resetView());
  }
  resetView() { Object.assign(this.cam, { tYaw: 0, tPitch: 0.07, tZoom: 1 }); }

  // ── Frame ──────────────────────────────────────────────────────────────────

  /**
   * @param {number} dt seconds since last frame (clamped by the caller)
   * @param {number} time seconds since start
   * @param {FrameState} s
   */
  render(dt, time, s) {
    if (this.lost) return;
    const gl = this.gl;
    this.adapt(dt);
    this.resize();
    const W = this.canvas.width, H = this.canvas.height, aspect = W / H;

    // Ease everything toward its target: exponential smoothing, frame-rate independent.
    const ease = (/** @type {number} */ tau) => 1 - Math.exp(-dt / tau);
    const c = this.cam, k = ease(0.22);
    const idle = !this.reduced && performance.now() - this.lastInput > 2500;
    const sway = idle ? Math.sin(time * 0.11) * 0.05 : 0, swayP = idle ? Math.sin(time * 0.083) * 0.018 : 0;
    c.yaw += (c.tYaw + sway + c.px * 0.06 - c.yaw) * k;
    c.pitch += (c.tPitch + swayP + c.py * 0.03 - c.pitch) * k;
    c.zoom += (c.tZoom - c.zoom) * k;

    // Fit the board (plus the presence beside it) to the viewport.
    const fov = 0.62, tanY = Math.tan(fov / 2);
    const narrow = aspect < 1;
    const needW = BOARD_W + (narrow ? 0.25 : 1.3), needH = BOARD_H + (narrow ? 1.2 : 1.0);
    const dist = Math.max(needH / 2 / tanY, needW / 2 / (tanY * aspect)) * c.zoom;
    const target = [narrow ? 0 : 0.16, BOARD_Y, 0];   // nudge right so board + presence sit centred together
    const eye = [target[0] + dist * Math.cos(c.pitch) * Math.sin(c.yaw), target[1] + dist * Math.sin(c.pitch), target[2] + dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
    // Shift the image up a touch in clip space so the board clears the input dock.
    const shift = M.translate(0, narrow ? 0.08 : 0.1, 0);
    const vp = M.mul(shift, M.mul(M.perspective(fov, aspect, 0.05, 60), M.lookAt(eye, target)));

    // Tutor state → presence + rim colour.
    const speaking = s.mode === 'speaking', thinking = s.mode === 'thinking', listening = s.mode === 'listening';
    this.level += (s.level - this.level) * ease(0.08);
    this.active += ((speaking || thinking ? 1 : listening ? 0.6 : 0.15) - this.active) * ease(0.4);
    this.bright += ((thinking ? 1.0 : speaking ? 0.85 + this.level * 0.4 : listening ? 0.9 : 0.55) - this.bright) * ease(0.3);
    this.spin += dt * (thinking ? 1.6 : speaking ? 0.35 + this.level * 0.6 : 0.12);
    const rimTarget = listening ? [0.55, 0.8, 1.0] : thinking ? [1.0, 0.82, 0.5] : [0.94, 0.93, 0.9];
    for (let i = 0; i < 3; i++) this.rim[i] += (rimTarget[i] - this.rim[i]) * ease(0.35);
    this.mood += ((thinking ? 1 : 0) - this.mood) * ease(0.5);
    if (s.pen) { this.penUv[0] += (s.pen[0] / 1600 - this.penUv[0]) * ease(0.03); this.penUv[1] += (1 - s.pen[1] / 900 - this.penUv[1]) * ease(0.03); }
    this.penA += ((s.pen ? 1 : 0) - this.penA) * ease(s.pen ? 0.05 : 0.25);

    // Upload the ink only when the board actually changed.
    if (this.inkDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.inkTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.inkCanvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.inkDirty = false;
    }

    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);

    // 1 · background
    gl.disable(gl.BLEND);
    use(gl, this.pBg, { uRes: [W, H], uMood: this.mood });
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied alpha

    // 2 · floor: the unit quad rotated flat (x → x, y → −z) and scaled up.
    const floorModel = new Float32Array([40, 0, 0, 0, 0, 0, -40, 0, 0, 1, 0, 0, 0, FLOOR_Y, -6, 1]);
    use(gl, this.pFloor, { uVP: vp, uModel: floorModel, uTime: time, uCam: eye, uInk: s.ink });
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 3 · dust (additive)
    gl.blendFunc(gl.ONE, gl.ONE);
    use(gl, this.pDust, { uVP: vp, uTime: time, uPx: H / 900, uMotion: this.reduced ? 0.15 : 1 });
    gl.bindVertexArray(this.dust);
    gl.drawArrays(gl.POINTS, 0, this.dustN);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // 4 + 5 · board reflection, then the board
    const boardModel = M.mul(M.translate(0, BOARD_Y, 0), M.scale(BOARD_W, BOARD_H, 1));
    const mirror = M.mul(M.translate(0, 2 * FLOOR_Y, 0), M.mul(M.scale(1, -1, 1), boardModel));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inkTex);
    const common = { uVP: vp, uInk: 0, uSize: [BOARD_W, BOARD_H], uCam: eye, uTime: time, uPen: [this.penUv[0], this.penUv[1], this.penA], uRim: this.rim, uFloorY: FLOOR_Y };
    gl.bindVertexArray(this.quad);
    use(gl, this.pBoard, { ...common, uModel: mirror, uReflect: 0.2 });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    use(gl, this.pBoard, { ...common, uModel: boardModel, uReflect: 0 });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 6 · presence: floats off the board's top-right corner (above it on phones).
    gl.blendFunc(gl.ONE, gl.ONE);
    const at = narrow ? [BOARD_W / 2 - 0.3, BOARD_Y + BOARD_H / 2 + 0.36, 0.2] : [BOARD_W / 2 + 0.3, BOARD_Y + BOARD_H / 2 - 0.2, 0.22];
    use(gl, this.pPresence, { uVP: vp, uAt: at, uScale: narrow ? 0.2 : 0.24, uTime: time, uSpin: this.spin, uLevel: this.level, uActive: this.active,
      uBright: this.bright, uTint: listening ? [0.75, 0.88, 1.0] : thinking ? [1.0, 0.9, 0.72] : [0.95, 0.93, 0.88] });
    gl.bindVertexArray(this.presence);
    gl.drawArrays(gl.LINES, 0, this.presenceN);
    gl.bindVertexArray(null);
  }

  /**
   * Adaptive resolution: if frames are slow for a while, render fewer pixels;
   * if they're fast for a while, step back up. Keeps weak laptops smooth.
   * @param {number} dt
   */
  adapt(dt) {
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    if (this.frameMs > 24) { this.slowFor += dt; this.fastFor = 0; } else if (this.frameMs < 13) { this.fastFor += dt; this.slowFor = 0; } else { this.slowFor = this.fastFor = 0; }
    if (this.slowFor > 1.5 && this.dpr > 0.75) { this.dpr = Math.max(0.75, this.dpr - 0.25); this.slowFor = 0; }
    if (this.fastFor > 6 && this.dpr < this.maxDpr) { this.dpr = Math.min(this.maxDpr, this.dpr + 0.25); this.fastFor = 0; }
  }
  resize() {
    const w = Math.round(this.canvas.clientWidth * this.dpr), h = Math.round(this.canvas.clientHeight * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }
}

// ── Geometry: the DAOD mark ─────────────────────────────────────────────────
/**
 * Three ellipses at 120° (the logo's thick rings, drawn as a few close
 * concentric loops) filled with nested "spirograph" loops that swell toward
 * each lobe's tip, with a little depth so it reads as a 3D object.
 */
function trefoil() {
  /** @type {number[]} */ const pos = [];
  /** @type {number[]} */ const info = [];
  const seg = (/** @type {number[][]} */ ring, /** @type {number} */ s, /** @type {number} */ lobe) => {
    for (let i = 0; i + 1 < ring.length; i++) { pos.push(...ring[i], ...ring[i + 1]); info.push(s, lobe, s, lobe); }
  };
  for (let k = 0; k < 3; k++) {
    const th = Math.PI / 2 + k * (2 * Math.PI / 3), dx = Math.cos(th), dy = Math.sin(th);
    // Outer ring: 3 nearly coincident loops to read as a bold stroke.
    for (const off of [0, 0.006, 0.012]) {
      const ring = [];
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2, ea = 0.52 + off, eb = 0.2 + off;
        const lx = Math.cos(a) * ea, ly = Math.sin(a) * eb;
        ring.push([dx * (lx + 0.36) - dy * ly, dy * (lx + 0.36) + dx * ly, Math.sin(a * 2 + k) * 0.03]);
      }
      seg(ring, -1, k);
    }
    // Inner loops along the lobe.
    const L = 24;
    for (let j = 0; j < L; j++) {
      const s = j / (L - 1), d = 0.04 + s * 0.6;
      const r = 0.035 + 0.11 * Math.sin(Math.PI * Math.pow(s, 0.75)), asp = 0.5 + 0.2 * Math.sin(s * 5);
      const rot = th + Math.sin(s * 6 + k) * 0.8, cr = Math.cos(rot), sr = Math.sin(rot);
      const ring = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2, lx = Math.cos(a) * r, ly = Math.sin(a) * r * asp;
        ring.push([dx * d + cr * lx - sr * ly, dy * d + sr * lx + cr * ly, 0.08 * Math.sin(s * Math.PI * 2 + k * 2) + Math.sin(a) * 0.02]);
      }
      seg(ring, s, k);
    }
  }
  return { pos: new Float32Array(pos), info: new Float32Array(info), count: pos.length / 3 };
}

// ── GL plumbing ──────────────────────────────────────────────────────────────
/** @param {WebGL2RenderingContext} gl @param {string} vs @param {string} fs */
function program(gl, vs, fs) {
  const p = /** @type {WebGLProgram} */ (gl.createProgram());
  for (const [type, src] of /** @type {[number,string][]} */ ([[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]])) {
    const sh = /** @type {WebGLShader} */ (gl.createShader(type));
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  // Cache uniform locations once.
  /** @type {Record<string, {loc: WebGLUniformLocation, type: number}>} */
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = /** @type {WebGLActiveInfo} */ (gl.getActiveUniform(p, i));
    u[info.name] = { loc: /** @type {WebGLUniformLocation} */ (gl.getUniformLocation(p, info.name)), type: info.type };
  }
  return { p, u };
}

/** Bind a program and set uniforms by name, inferring the setter from the GLSL type. */
function use(/** @type {WebGL2RenderingContext} */ gl, /** @type {{p:WebGLProgram,u:Record<string,{loc:WebGLUniformLocation,type:number}>}} */ prog, /** @type {Record<string,any>} */ vals) {
  gl.useProgram(prog.p);
  for (const name in vals) {
    const u = prog.u[name];
    if (!u) continue;
    const v = vals[name];
    switch (u.type) {
      case gl.FLOAT: gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      case gl.SAMPLER_2D: case gl.INT: gl.uniform1i(u.loc, v); break;
    }
  }
}

/** @param {WebGL2RenderingContext} gl @param {[number, number, Float32Array][]} attrs [location, size, data] */
function vao(gl, attrs) {
  const v = gl.createVertexArray();
  gl.bindVertexArray(v);
  for (const [loc, size, data] of attrs) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
  gl.bindVertexArray(null);
  return v;
}
const clamp = (/** @type {number} */ v, /** @type {number} */ a, /** @type {number} */ b) => Math.max(a, Math.min(b, v));
