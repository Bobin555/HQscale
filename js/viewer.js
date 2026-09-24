// Lightweight 360° (equirectangular) viewer built on raw WebGL — no dependencies.
//
// Conventions used everywhere in the app:
//   yaw   — degrees, 0 = centre of the panorama image, positive = turn right (-180..180)
//   pitch — degrees, 0 = horizon, positive = look up (-90..90)
// So a point at pixel (x, y) of a W×H equirectangular image is at
//   yaw = (x / W - 0.5) * 360,  pitch = (0.5 - y / H) * 180

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function dirFromYawPitch(yaw, pitch) {
  const y = yaw * DEG, p = pitch * DEG;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
}

export function yawPitchFromDir([x, y, z]) {
  return { yaw: Math.atan2(x, -z) / DEG, pitch: Math.asin(clamp(y, -1, 1)) / DEG };
}

/** Great-circle distance in degrees between two {yaw, pitch} points. */
export function angularDistance(a, b) {
  const da = dirFromYawPitch(a.yaw, a.pitch), db = dirFromYawPitch(b.yaw, b.pitch);
  return Math.acos(clamp(da[0] * db[0] + da[1] * db[1] + da[2] * db[2], -1, 1)) / DEG;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

const VERT2 = `#version 300 es
in vec2 aPos; out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Ray per pixel -> equirectangular lookup. Gradients are computed seam-safely so
// mipmapping doesn't draw a line where the image wraps around.
const FRAG2 = `#version 300 es
precision highp float;
in vec2 vNdc; out vec4 outColor;
uniform sampler2D uTex; uniform vec3 uF, uR, uU; uniform vec2 uScale;
const float PI = 3.141592653589793;
void main() {
  vec3 d = normalize(uF + uR * vNdc.x * uScale.x + uU * vNdc.y * uScale.y);
  vec2 uv = vec2(atan(d.x, -d.z) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI);
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  float u2 = fract(uv.x + 0.5);
  float gx2 = dFdx(u2), gy2 = dFdy(u2);
  if (abs(gx2) < abs(gx.x)) gx.x = gx2;
  if (abs(gy2) < abs(gy.x)) gy.x = gy2;
  outColor = textureGrad(uTex, uv, gx, gy);
}`;

const VERT1 = `attribute vec2 aPos; varying vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG1 = `precision highp float;
varying vec2 vNdc;
uniform sampler2D uTex; uniform vec3 uF, uR, uU; uniform vec2 uScale;
const float PI = 3.141592653589793;
void main() {
  vec3 d = normalize(uF + uR * vNdc.x * uScale.x + uU * vNdc.y * uScale.y);
  gl_FragColor = texture2D(uTex, vec2(atan(d.x, -d.z) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI));
}`;

export class PanoViewer {
  constructor(container, { minFov = 35, maxFov = 100 } = {}) {
    this.container = container;
    this.minFov = minFov;
    this.maxFov = maxFov;
    this.yaw = 0;
    this.pitch = 0;
    this.fov = 75;
    this.markers = [];
    this.tapHandlers = new Set();
    this.viewHandlers = new Set();
    this.video = null;
    this.dirty = true;
    this.velocity = { yaw: 0, pitch: 0 };
    this.anim = null;
    this.gyro = null;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pano-canvas';
    this.overlay = document.createElement('div');
    this.overlay.className = 'pano-overlay';
    container.append(this.canvas, this.overlay);

    this.#initGL();
    this.#bindInput();
    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(container);
    this.#resize();
    this.raf = requestAnimationFrame(this.#frame);
  }

  #initGL() {
    const opts = { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    let gl = this.canvas.getContext('webgl2', opts);
    this.isGL2 = !!gl;
    if (!gl) gl = this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL is not available on this device/browser.');
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, this.isGL2 ? VERT2 : VERT1));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, this.isGL2 ? FRAG2 : FRAG1));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = Object.fromEntries(['uF', 'uR', 'uU', 'uScale', 'uTex'].map((n) => [n, gl.getUniformLocation(prog, n)]));
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 22, 28, 255]));
    this.#setTexParams(false);
  }

  #setTexParams(mipmaps) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.isGL2 ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  /** Shrinks an image/canvas to fit the GPU's max texture size (common on phones: 4096). */
  #fitSource(source, w, h) {
    const max = Math.min(this.maxTextureSize, 8192);
    if (w <= max && h <= max) return source;
    const s = Math.min(max / w, max / h);
    const c = document.createElement('canvas');
    c.width = Math.floor(w * s);
    c.height = Math.floor(h * s);
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  #uploadStatic(source, w, h) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.#fitSource(source, w, h));
    if (this.isGL2) gl.generateMipmap(gl.TEXTURE_2D);
    this.#setTexParams(this.isGL2);
    this.dirty = true;
  }

  /**
   * Show a panorama. Accepts:
   *   { type: 'image', src }                     — equirectangular JPG/PNG/WebP
   *   { type: 'video', src, loop?, muted? }      — equirectangular MP4/WebM
   *   { type: 'canvas', canvas }                 — pre-rendered canvas (used for placeholders)
   */
  async load(media) {
    this.#stopVideo();
    if (media.type === 'canvas') {
      this.#uploadStatic(media.canvas, media.canvas.width, media.canvas.height);
      return;
    }
    if (media.type === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.src = media.src;
      await img.decode();
      this.#uploadStatic(img, img.naturalWidth, img.naturalHeight);
      return;
    }
    if (media.type === 'video') {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.src = media.src;
      v.loop = media.loop !== false;
      v.muted = media.muted !== false;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      this.video = v;
      await new Promise((resolve, reject) => {
        v.addEventListener('loadeddata', resolve, { once: true });
        v.addEventListener('error', () => reject(new Error(`Could not load video ${media.src}`)), { once: true });
      });
      this.#setTexParams(false);
      await v.play().catch(() => {}); // autoplay may need a user gesture; resumed on next tap
      return;
    }
    throw new Error(`Unsupported media type "${media.type}"`);
  }

  #stopVideo() {
    if (!this.video) return;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video = null;
  }

  get isVideoPaused() { return !this.video || this.video.paused; }
  toggleVideo() {
    if (!this.video) return;
    if (this.video.paused) this.video.play(); else this.video.pause();
  }

  // ---------- camera ----------

  #basis() {
    const f = dirFromYawPitch(this.yaw, this.pitch);
    const r = norm(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    const tanHalf = Math.tan((this.fov * DEG) / 2);
    return { f, r, u, sx: tanHalf * this.aspect, sy: tanHalf };
  }

  setView({ yaw = this.yaw, pitch = this.pitch, fov = this.fov } = {}) {
    this.anim = null;
    this.yaw = ((yaw + 540) % 360) - 180;
    this.pitch = clamp(pitch, -89, 89);
    this.fov = clamp(fov, this.minFov, this.maxFov);
    this.dirty = true;
  }

  /** Smoothly turn the camera to face a point (used for hints / reveals). */
  lookAt({ yaw, pitch = 0 }, duration = 900) {
    let dy = ((yaw - this.yaw + 540) % 360) - 180;
    this.anim = { from: { yaw: this.yaw, pitch: this.pitch }, dy, dp: pitch - this.pitch, t0: performance.now(), duration };
    this.velocity = { yaw: 0, pitch: 0 };
  }

  /** Screen point (client px) -> {yaw, pitch}. */
  screenToYawPitch(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const { f, r, u, sx, sy } = this.#basis();
    return yawPitchFromDir(norm([0, 1, 2].map((i) => f[i] + r[i] * nx * sx + u[i] * ny * sy)));
  }

  /** {yaw, pitch} -> container px, or null when behind the camera. */
  yawPitchToScreen(yaw, pitch) {
    const d = dirFromYawPitch(yaw, pitch);
    const { f, r, u, sx, sy } = this.#basis();
    const z = dot(d, f);
    if (z <= 0.05) return null;
    const nx = dot(d, r) / (z * sx), ny = dot(d, u) / (z * sy);
    return { x: ((nx + 1) / 2) * this.width, y: ((1 - ny) / 2) * this.height, visible: Math.abs(nx) <= 1.05 && Math.abs(ny) <= 1.05 };
  }

  // ---------- markers (DOM elements pinned to a yaw/pitch) ----------

  addMarker({ yaw, pitch, el }) {
    const m = { yaw, pitch, el };
    el.classList.add('pano-marker');
    this.overlay.append(el);
    this.markers.push(m);
    this.dirty = true;
    return m;
  }

  removeMarker(m) {
    m.el.remove();
    this.markers = this.markers.filter((x) => x !== m);
  }

  clearMarkers() {
    this.markers.forEach((m) => m.el.remove());
    this.markers = [];
  }

  #updateMarkers() {
    for (const m of this.markers) {
      const p = this.yawPitchToScreen(m.yaw, m.pitch);
      if (!p) { m.el.style.visibility = 'hidden'; continue; }
      m.el.style.visibility = 'visible';
      m.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
  }

  // ---------- events ----------

  onTap(fn) { this.tapHandlers.add(fn); return () => this.tapHandlers.delete(fn); }
  onViewChange(fn) { this.viewHandlers.add(fn); return () => this.viewHandlers.delete(fn); }

  #bindInput() {
    const el = this.canvas;
    const pointers = new Map();
    let drag = null, pinch = null;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.anim = null;
      this.velocity = { yaw: 0, pitch: 0 };
      if (pointers.size === 1) {
        drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), t: performance.now(), moved: 0 };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: this.fov };
        drag = null;
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.setView({ fov: pinch.fov * (pinch.d / d) });
        return;
      }
      if (!drag) return;
      const k = this.fov / this.height; // degrees per pixel
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      const now = performance.now();
      const dt = Math.max(1, now - drag.t);
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0));
      this.setView({ yaw: this.yaw - dx * k, pitch: this.pitch + dy * k });
      this.velocity = { yaw: (-dx * k) / dt, pitch: (dy * k) / dt };
      drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
      if (this.gyro) this.gyro.offset -= dx * k;
    });

    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
      if (!drag) return;
      const isTap = drag.moved < 8 && performance.now() - drag.t0 < 600;
      if (isTap) {
        this.velocity = { yaw: 0, pitch: 0 };
        if (this.video?.paused) this.video.play().catch(() => {});
        const yp = this.screenToYawPitch(e.clientX, e.clientY);
        const rect = this.container.getBoundingClientRect();
        this.tapHandlers.forEach((fn) => fn({ ...yp, x: e.clientX - rect.left, y: e.clientY - rect.top }));
      } else if (performance.now() - drag.t > 80) {
        this.velocity = { yaw: 0, pitch: 0 }; // finger rested before release: no fling
      }
      drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setView({ fov: this.fov * Math.exp(e.deltaY * 0.001) });
    }, { passive: false });

    el.tabIndex = 0;
    el.setAttribute('aria-label', '360° view. Drag or use arrow keys to look around, + and - to zoom.');
    el.addEventListener('keydown', (e) => {
      const step = 5;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (map[e.key]) {
        e.preventDefault();
        this.setView({ yaw: this.yaw + map[e.key][0], pitch: this.pitch + map[e.key][1] });
      } else if (e.key === '+' || e.key === '=') this.setView({ fov: this.fov - 5 });
      else if (e.key === '-') this.setView({ fov: this.fov + 5 });
    });
  }

  // ---------- gyroscope (look around by moving the phone) ----------

  static get gyroSupported() { return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window; }

  async enableGyro() {
    if (this.gyro) return true;
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      // iOS: must be called from a user gesture.
      const res = await DOE.requestPermission().catch(() => 'denied');
      if (res !== 'granted') return false;
    }
    this.gyro = { offset: null, handler: null };
    this.gyro.handler = (e) => {
      if (e.alpha == null) return;
      const { yaw, pitch } = orientationToYawPitch(e.alpha, e.beta, e.gamma, screenAngle());
      if (this.gyro.offset == null) this.gyro.offset = this.yaw - yaw; // keep current view when switching on
      this.anim = null;
      this.velocity = { yaw: 0, pitch: 0 };
      this.yaw = ((yaw + this.gyro.offset + 540) % 360) - 180;
      this.pitch = clamp(pitch, -89, 89);
      this.dirty = true;
    };
    window.addEventListener('deviceorientation', this.gyro.handler);
    return true;
  }

  disableGyro() {
    if (!this.gyro) return;
    window.removeEventListener('deviceorientation', this.gyro.handler);
    this.gyro = null;
  }

  // ---------- render ----------

  #resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap for battery / low-end GPUs
    const { width, height } = this.container.getBoundingClientRect();
    this.width = width;
    this.height = height;
    this.aspect = width / Math.max(1, height);
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    // On portrait phones widen the vertical FOV a little so there's more to see.
    this.maxFov = this.aspect < 0.8 ? 110 : 100;
    this.dirty = true;
  }

  #frame = (now) => {
    this.raf = requestAnimationFrame(this.#frame);
    if (this.anim) {
      const t = clamp((now - this.anim.t0) / this.anim.duration, 0, 1);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.yaw = ((this.anim.from.yaw + this.anim.dy * e + 540) % 360) - 180;
      this.pitch = this.anim.from.pitch + this.anim.dp * e;
      this.dirty = true;
      if (t >= 1) this.anim = null;
    } else if (Math.abs(this.velocity.yaw) + Math.abs(this.velocity.pitch) > 0.001) {
      // Fling inertia after a drag.
      this.yaw = ((this.yaw + this.velocity.yaw * 16 + 540) % 360) - 180;
      this.pitch = clamp(this.pitch + this.velocity.pitch * 16, -89, 89);
      this.velocity.yaw *= 0.92;
      this.velocity.pitch *= 0.92;
      this.dirty = true;
    }

    const videoFrame = this.video && this.video.readyState >= 2 && !this.video.paused;
    if (!this.dirty && !videoFrame) return;
    const gl = this.gl;
    if (videoFrame || (this.video && this.dirty && this.video.readyState >= 2)) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
    }
    const { f, r, u, sx, sy } = this.#basis();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform3fv(this.u.uF, f);
    gl.uniform3fv(this.u.uR, r);
    gl.uniform3fv(this.u.uU, u);
    gl.uniform2f(this.u.uScale, sx, sy);
    gl.uniform1i(this.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.#updateMarkers();
    if (this.dirty) this.viewHandlers.forEach((fn) => fn({ yaw: this.yaw, pitch: this.pitch, fov: this.fov }));
    this.dirty = false;
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.disableGyro();
    this.#stopVideo();
    this.canvas.remove();
    this.overlay.remove();
  }
}

function screenAngle() {
  return (screen.orientation && screen.orientation.angle) || window.orientation || 0;
}

// Device orientation (W3C Z-X'-Y'' Euler angles) -> the direction the back camera faces.
function orientationToYawPitch(alpha, beta, gamma, orient) {
  const q = quatFromEuler(beta * DEG, alpha * DEG, -gamma * DEG); // YXZ order
  const q1 = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // -90° about X: camera looks out of the back of the device
  const s = -orient * DEG / 2;
  const q2 = [0, 0, Math.sin(s), Math.cos(s)]; // compensate screen rotation
  const qq = quatMul(quatMul(q, q1), q2);
  return yawPitchFromDir(quatRotate(qq, [0, 0, -1]));
}

function quatFromEuler(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
}

function quatMul([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatRotate([qx, qy, qz, qw], [x, y, z]) {
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}
