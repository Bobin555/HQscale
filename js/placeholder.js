// Paints a simple stylised equirectangular "room" so scenarios can be built and tested
// before real 360° photos/videos are captured. Swap the scene's media to
// { "type": "image", "src": "media/your-photo.jpg" } when you have the real thing.
//
// Every object is positioned with the same yaw/pitch (degrees) used by hotspots, so the
// coordinates you author against a placeholder line up with what users tap on.

const THEMES = {
  reception: { ceiling: '#e9e4da', wall: '#d8cfc0', floor: '#8a6d52', accent: '#2f5d8a' },
  lobby: { ceiling: '#e6e8ea', wall: '#c9d0d6', floor: '#5d6670', accent: '#1f6f5c' },
  office: { ceiling: '#eceeef', wall: '#dfe3e6', floor: '#6f7c85', accent: '#6a4c93' },
  warehouse: { ceiling: '#9aa0a6', wall: '#b9b4a8', floor: '#6b6b66', accent: '#c47f00' },
};

export function paintPlaceholder({ theme = 'office', label = '', objects = [] }, maxSize = 4096) {
  const W = Math.min(4096, maxSize), H = W / 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const t = THEMES[theme] || THEMES.office;
  const k = W / 360; // pixels per degree
  const X = (yaw) => (0.5 + yaw / 360) * W;
  const Y = (pitch) => (0.5 - pitch / 180) * H;

  // Room shell: ceiling / walls / floor bands.
  const wallTop = Y(38), wallBottom = Y(-22);
  let grad = g.createLinearGradient(0, 0, 0, wallTop);
  grad.addColorStop(0, shade(t.ceiling, -25));
  grad.addColorStop(1, t.ceiling);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, wallTop);
  grad = g.createLinearGradient(0, wallTop, 0, wallBottom);
  grad.addColorStop(0, shade(t.wall, 8));
  grad.addColorStop(1, shade(t.wall, -12));
  g.fillStyle = grad;
  g.fillRect(0, wallTop, W, wallBottom - wallTop);
  grad = g.createLinearGradient(0, wallBottom, 0, H);
  grad.addColorStop(0, shade(t.floor, 10));
  grad.addColorStop(1, shade(t.floor, -30));
  g.fillStyle = grad;
  g.fillRect(0, wallBottom, W, H - wallBottom);

  // Skirting, cornice, corners, floor grid, ceiling lights.
  g.fillStyle = shade(t.wall, -35);
  g.fillRect(0, wallBottom - 0.8 * k, W, 0.8 * k);
  g.fillStyle = shade(t.ceiling, -15);
  g.fillRect(0, wallTop, W, 0.6 * k);
  for (let yaw = -135; yaw < 180; yaw += 90) {
    g.fillStyle = 'rgba(0,0,0,0.10)';
    g.fillRect(X(yaw) - 0.4 * k, wallTop, 0.8 * k, wallBottom - wallTop);
  }
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = Math.max(1, k * 0.15);
  for (let p = -26; p > -90; p -= p > -50 ? 6 : 12) line(g, 0, Y(p), W, Y(p));
  for (let yaw = -180; yaw < 180; yaw += 15) line(g, X(yaw), wallBottom, X(yaw), H);
  for (let yaw = -165; yaw < 180; yaw += 45) {
    g.fillStyle = 'rgba(255,255,240,0.9)';
    roundRect(g, X(yaw) - 6 * k, Y(55) - 1.2 * k, 12 * k, 2.4 * k, k * 0.5);
    g.fill();
  }

  // Objects — drawn twice when they straddle the image seam.
  for (const o of objects) {
    const draw = DRAWERS[o.kind];
    if (!draw) continue;
    for (const shift of [0, -W, W]) {
      const x = X(o.yaw) + shift;
      if (x < -60 * k || x > W + 60 * k) continue;
      g.save();
      g.translate(x, Y(o.pitch ?? 0));
      draw(g, k * (o.scale ?? 1), o, t);
      g.restore();
    }
  }

  // Floor stamp so nobody mistakes the placeholder for the real site.
  g.save();
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = `600 ${3 * k}px system-ui, sans-serif`;
  g.textAlign = 'center';
  for (const yaw of [-90, 90]) {
    g.fillText(`PLACEHOLDER 360° — ${label}`.trim(), X(yaw), Y(-62));
  }
  g.restore();
  return c;
}

// ---------- drawing helpers ----------

function line(g, x1, y1, x2, y2) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function text(g, str, x, y, size, color = '#fff', weight = 700) {
  g.fillStyle = color;
  g.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(str, x, y);
}

function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Each drawer is called with the origin at the object's yaw/pitch and `k` = px per degree.
const DRAWERS = {
  desk(g, k, o, t) {
    const w = (o.width ?? 50) * k;
    g.fillStyle = '#5a3d2b';
    g.fillRect(-w / 2, -2 * k, w, 14 * k);
    g.fillStyle = '#7b5640';
    g.fillRect(-w / 2 - k, -3 * k, w + 2 * k, 2 * k);
    g.fillStyle = t.accent;
    g.fillRect(-w / 2, 3 * k, w, 3.5 * k);
    if (o.text) text(g, o.text, 0, 4.8 * k, 2.4 * k);
  },

  person(g, k, o) {
    const skin = o.skin || '#c68c63';
    const shirt = o.shirt || '#3b4a5a';
    g.fillStyle = '#2b2b33';
    g.fillRect(-2.6 * k, 8 * k, 2.2 * k, 16 * k);
    g.fillRect(0.4 * k, 8 * k, 2.2 * k, 16 * k);
    g.fillStyle = shirt;
    roundRect(g, -4.2 * k, -6 * k, 8.4 * k, 15 * k, 1.5 * k);
    g.fill();
    g.fillStyle = skin;
    g.beginPath();
    g.arc(0, -9.5 * k, 3.2 * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = o.hair || '#2a1d14';
    g.beginPath();
    g.arc(0, -10.4 * k, 3.3 * k, Math.PI, 0);
    g.fill();
    if (o.lanyard) {
      g.strokeStyle = o.lanyard;
      g.lineWidth = 0.9 * k;
      g.beginPath();
      g.moveTo(-2.2 * k, -6 * k);
      g.lineTo(0, 1.5 * k);
      g.lineTo(2.2 * k, -6 * k);
      g.stroke();
      g.fillStyle = '#fff';
      g.fillRect(-1.5 * k, 1.5 * k, 3 * k, 3.6 * k);
      g.fillStyle = o.lanyard;
      g.fillRect(-1.5 * k, 1.5 * k, 3 * k, 1 * k);
    }
  },

  firstaid(g, k) {
    g.fillStyle = '#1f8f4e';
    roundRect(g, -4 * k, -3.5 * k, 8 * k, 7 * k, 0.8 * k);
    g.fill();
    g.fillStyle = '#fff';
    g.fillRect(-0.8 * k, -2.5 * k, 1.6 * k, 5 * k);
    g.fillRect(-2.5 * k, -0.8 * k, 5 * k, 1.6 * k);
  },

  extinguisher(g, k) {
    g.fillStyle = '#c62828';
    roundRect(g, -1.4 * k, -4 * k, 2.8 * k, 9 * k, 1.2 * k);
    g.fill();
    g.fillStyle = '#222';
    g.fillRect(-0.6 * k, -5.5 * k, 1.2 * k, 1.6 * k);
    g.fillRect(0.4 * k, -5.3 * k, 2 * k, 0.5 * k);
    text(g, 'FIRE', 0, 7 * k, 1.4 * k, '#c62828');
  },

  exitsign(g, k, o) {
    g.fillStyle = '#138a36';
    g.fillRect(-6 * k, -1.8 * k, 12 * k, 3.6 * k);
    text(g, o.text || 'EXIT ➜', 0, 0, 2.2 * k);
  },

  door(g, k, o) {
    const w = (o.width ?? 14) * k, h = 30 * k;
    g.fillStyle = o.glass ? 'rgba(170,205,225,0.9)' : '#8d6e57';
    g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeStyle = '#555';
    g.lineWidth = 0.5 * k;
    g.strokeRect(-w / 2, -h / 2, w, h);
    if (o.glass) line(g, 0, -h / 2, 0, h / 2);
    g.fillStyle = '#ccc';
    g.fillRect(o.glass ? -1.2 * k : w / 2 - 2.5 * k, 0, 0.8 * k, 3 * k);
    if (o.text) {
      g.fillStyle = o.signColor || '#222';
      g.fillRect(-w / 2, -h / 2 - 4 * k, w, 3.2 * k);
      text(g, o.text, 0, -h / 2 - 2.4 * k, 1.9 * k);
    }
  },

  window(g, k, o) {
    const w = (o.width ?? 40) * k, h = 22 * k;
    const grad = g.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, '#9cc6e8');
    grad.addColorStop(1, '#dbeaf5');
    g.fillStyle = grad;
    g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle = 'rgba(80,100,120,0.55)';
    for (let i = 0; i < 9; i++) {
      const bw = w / 9, bh = (0.25 + ((i * 37) % 10) / 16) * h;
      g.fillRect(-w / 2 + i * bw + 0.3 * k, h / 2 - bh, bw - 0.6 * k, bh);
    }
    g.strokeStyle = '#eee';
    g.lineWidth = 0.8 * k;
    for (let i = 0; i <= 4; i++) line(g, -w / 2 + (i * w) / 4, -h / 2, -w / 2 + (i * w) / 4, h / 2);
    g.strokeRect(-w / 2, -h / 2, w, h);
  },

  plant(g, k) {
    g.fillStyle = '#6d4c41';
    g.fillRect(-2.5 * k, 2 * k, 5 * k, 5 * k);
    g.fillStyle = '#2e7d32';
    for (const [dx, dy, r] of [[0, -3, 3.5], [-2.5, 0, 2.8], [2.5, 0, 2.8], [0, -7, 2.4]]) {
      g.beginPath();
      g.arc(dx * k, dy * k, r * k, 0, Math.PI * 2);
      g.fill();
    }
  },

  sofa(g, k) {
    g.fillStyle = '#455a64';
    roundRect(g, -12 * k, -3 * k, 24 * k, 8 * k, 1.5 * k);
    g.fill();
    g.fillStyle = '#546e7a';
    roundRect(g, -12 * k, -7 * k, 24 * k, 5 * k, 1.5 * k);
    g.fill();
  },

  elevator(g, k, o) {
    g.fillStyle = '#9ea7ad';
    g.fillRect(-9 * k, -15 * k, 18 * k, 30 * k);
    g.fillStyle = '#c3cbd0';
    g.fillRect(-8 * k, -13 * k, 7.8 * k, 28 * k);
    g.fillRect(0.2 * k, -13 * k, 7.8 * k, 28 * k);
    g.fillStyle = '#111';
    g.fillRect(-3 * k, -19 * k, 6 * k, 3 * k);
    text(g, o.text || '10', 0, -17.5 * k, 2 * k, '#ff5252');
  },

  turnstile(g, k) {
    for (const dx of [-8, 0, 8]) {
      g.fillStyle = '#b0bec5';
      g.fillRect((dx - 1.5) * k, -2 * k, 3 * k, 10 * k);
      g.fillStyle = '#263238';
      g.fillRect((dx - 1.5) * k, -3 * k, 3 * k, 1.2 * k);
      g.fillStyle = '#4caf50';
      g.fillRect((dx - 0.5) * k, -2.8 * k, k, 0.7 * k);
    }
    g.fillStyle = 'rgba(200,230,255,0.6)';
    g.fillRect(-6.5 * k, 0, 5 * k, 4 * k);
    g.fillRect(1.5 * k, 0, 5 * k, 4 * k);
  },

  badgebox(g, k, o) {
    g.fillStyle = '#37474f';
    g.fillRect(-4 * k, -3 * k, 8 * k, 7 * k);
    g.fillStyle = '#eceff1';
    g.fillRect(-3 * k, -1.5 * k, 6 * k, 1 * k);
    text(g, o.text || 'BADGE RETURN', 0, -5 * k, 1.5 * k, '#263238');
  },

  sign(g, k, o) {
    const w = (o.width ?? 16) * k;
    g.fillStyle = o.color || '#1565c0';
    g.fillRect(-w / 2, -3 * k, w, 6 * k);
    const lines = String(o.text || '').split('\n');
    lines.forEach((l, i) => text(g, l, 0, (i - (lines.length - 1) / 2) * 2.2 * k, 1.8 * k, o.textColor || '#fff'));
  },

  workstation(g, k, o) {
    g.fillStyle = '#cfd8dc';
    g.fillRect(-10 * k, 2 * k, 20 * k, 1.5 * k);
    g.fillStyle = '#90a4ae';
    g.fillRect(-9 * k, 3.5 * k, 1 * k, 9 * k);
    g.fillRect(8 * k, 3.5 * k, 1 * k, 9 * k);
    g.fillStyle = '#263238';
    g.fillRect(-5 * k, -6 * k, 10 * k, 6.5 * k);
    g.fillStyle = o.unlocked ? '#4fc3f7' : '#0d1b24';
    g.fillRect(-4.5 * k, -5.5 * k, 9 * k, 5.5 * k);
    if (o.unlocked) {
      g.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 4; i++) g.fillRect(-3.8 * k, (-4.8 + i * 1.2) * k, (4 + (i % 2) * 3) * k, 0.5 * k);
    }
    g.fillStyle = '#263238';
    g.fillRect(-0.5 * k, 0.5 * k, k, 1.5 * k);
  },

  cable(g, k, o) {
    const w = (o.width ?? 30) * k;
    g.strokeStyle = o.color || '#111';
    g.lineWidth = 0.7 * k;
    g.beginPath();
    g.moveTo(-w / 2, 0);
    for (let i = 0; i <= 20; i++) g.lineTo(-w / 2 + (i / 20) * w, Math.sin(i * 1.3) * 1.5 * k);
    g.stroke();
  },

  wetfloor(g, k) {
    g.fillStyle = '#fdd835';
    g.beginPath();
    g.moveTo(0, -6 * k);
    g.lineTo(3.5 * k, 6 * k);
    g.lineTo(-3.5 * k, 6 * k);
    g.closePath();
    g.fill();
    text(g, '⚠', 0, 0, 3.5 * k, '#111');
  },

  puddle(g, k) {
    g.fillStyle = 'rgba(180,220,255,0.55)';
    g.beginPath();
    g.ellipse(0, 0, 9 * k, 2.2 * k, 0, 0, Math.PI * 2);
    g.fill();
  },

  boxes(g, k) {
    for (const [dx, dy] of [[-4, 0], [4, 0], [0, -7]]) {
      g.fillStyle = '#b8864b';
      g.fillRect((dx - 4) * k, (dy - 3.5) * k, 8 * k, 7 * k);
      g.strokeStyle = '#8d6437';
      g.lineWidth = 0.4 * k;
      g.strokeRect((dx - 4) * k, (dy - 3.5) * k, 8 * k, 7 * k);
      line(g, dx * k, (dy - 3.5) * k, dx * k, (dy + 3.5) * k);
    }
  },

  whiteboard(g, k, o) {
    g.fillStyle = '#fafafa';
    g.fillRect(-12 * k, -7 * k, 24 * k, 14 * k);
    g.strokeStyle = '#90a4ae';
    g.lineWidth = 0.6 * k;
    g.strokeRect(-12 * k, -7 * k, 24 * k, 14 * k);
    if (o.text) String(o.text).split('\n').forEach((l, i) => text(g, l, 0, (-4 + i * 2.6) * k, 1.8 * k, '#1a237e', 600));
  },
};
