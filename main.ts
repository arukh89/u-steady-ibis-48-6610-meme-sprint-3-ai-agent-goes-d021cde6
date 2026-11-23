// Meme Sprint 3: AI Agent Goes Rogue — entry program.
//
// Draws ONE 1024x1024 meme image to /output/entry.png, with pure code:
// a tiny rasterizer, a hand-authored 5x7 bitmap font, and a minimal PNG
// encoder (node builtins only: fs, zlib). No network, no randomness, no
// clock, no external files: two runs produce byte-identical output.
//
// The joke (reads in one glance, top to bottom):
//   "I ASKED MY AGENT TO BOOK ME A FLIGHT."
//   [a smug robot in the airplane window seat, sipping juice,
//    while its human's face is squashed against the window from outside]
//   "IT BOOKED ITSELF ONE. WINDOW SEAT."
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Colour helpers: colours are [r, g, b] triples.
// ---------------------------------------------------------------------------
type RGB = [number, number, number];

const NAVY: RGB = [11, 31, 58];
const NAVY_DARK: RGB = [7, 22, 42];
const WHITE: RGB = [255, 255, 255];
const SKY_TOP: RGB = [94, 178, 232];
const SKY_BOT: RGB = [214, 240, 255];
const CLOUD: RGB = [255, 255, 255];
const FRAME: RGB = [16, 42, 74];
const SEAT: RGB = [30, 78, 140];
const SEAT_DARK: RGB = [22, 58, 104];
const ROBOT: RGB = [201, 212, 220];
const ROBOT_DARK: RGB = [138, 155, 168];
const ROBOT_LIGHT: RGB = [228, 236, 241];
const EYE: RGB = [0, 229, 255];
const EYE_DARK: RGB = [0, 160, 190];
const SKIN: RGB = [242, 196, 155];
const SKIN_DARK: RGB = [214, 164, 122];
const HAIR: RGB = [58, 38, 22];
const MOUTH: RGB = [90, 20, 26];
const JUICE: RGB = [255, 140, 26];
const JUICE_DARK: RGB = [214, 104, 10];
const STRAW: RGB = [255, 60, 90];
const WING: RGB = [178, 190, 200];
const SUN: RGB = [255, 214, 90];
const RED: RGB = [220, 50, 50];

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// ---------------------------------------------------------------------------
// Framebuffer + rasterizer.
// ---------------------------------------------------------------------------
const px = new Uint8Array(W * H * 3);

function setPixel(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(W - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(H - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) setPixel(x, y, c);
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(x, y, c);
    }
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPixel(x, y, c);
    }
  }
}

function drawLine(x0: number, y0: number, x1: number, y1: number, c: RGB, w: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const half = Math.floor(w / 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x0 + dx * t);
    const y = Math.round(y0 + dy * t);
    for (let oy = -half; oy <= half; oy++) {
      for (let ox = -half; ox <= half; ox++) setPixel(x + ox, y + oy, c);
    }
  }
}

// Rounded rectangle, filled. r = corner radius, clamped so the corner
// circles can never bulge past the opposite edge (a radius larger than
// half the height would otherwise sprout lobes outside the rectangle).
function fillRoundRect(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB): void {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  fillRect(x0 + r, y0, x1 - r, y1, c);
  fillRect(x0, y0 + r, x1, y1 - r, c);
  fillCircle(x0 + r, y0 + r, r, c);
  fillCircle(x1 - r, y0 + r, r, c);
  fillCircle(x0 + r, y1 - r, r, c);
  fillCircle(x1 - r, y1 - r, r, c);
}

// Filled triangle.
function fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  const d = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = ((x1 - x) * (y2 - y) - (y1 - y) * (x2 - x)) / d;
      const b = ((x2 - x) * (y0 - y) - (y2 - y) * (x0 - x)) / d;
      const g = 1 - a - b;
      if (a >= 0 && b >= 0 && g >= 0) setPixel(x, y, c);
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (truecolor, filter 0 on every scanline).
// ---------------------------------------------------------------------------
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: None
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font, hand-authored. Each glyph is 7 rows of 5 cells.
// ---------------------------------------------------------------------------
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
};

function textWidth(text: string, scale: number): number {
  if (text.length === 0) return 0;
  return text.length * 6 * scale - scale;
}

// Draw one line of text, centred on cx, top edge at y.
function drawText(text: string, cx: number, y: number, scale: number, c: RGB): void {
  const w = textWidth(text, scale);
  let x = Math.round(cx - w / 2);
  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT["?"];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === "1") {
          fillRect(x + col * scale, y + row * scale, x + (col + 1) * scale - 1, y + (row + 1) * scale - 1, c);
        }
      }
    }
    x += 6 * scale;
  }
}

// ---------------------------------------------------------------------------
// The scene.
// ---------------------------------------------------------------------------
const TOP_BAND_H = 176;
const BOT_BAND_Y = 848;
const WIN_X0 = 70;
const WIN_Y0 = 196;
const WIN_X1 = 954;
const WIN_Y1 = 828;

function drawSky(): void {
  // Fuselage: white middle band with a blue cheatline stripe.
  fillRect(0, TOP_BAND_H, W, BOT_BAND_Y, WHITE);
  fillRect(0, 508, W, 548, SEAT);
  // Window frame.
  fillRoundRect(WIN_X0, WIN_Y0, WIN_X1, WIN_Y1, 48, FRAME);
  // Sky inside the window: vertical gradient.
  const ix0 = WIN_X0 + 24;
  const iy0 = WIN_Y0 + 24;
  const ix1 = WIN_X1 - 24;
  const iy1 = WIN_Y1 - 24;
  for (let y = iy0; y <= iy1; y++) {
    const t = (y - iy0) / (iy1 - iy0);
    fillRect(ix0, y, ix1, y, lerp(SKY_TOP, SKY_BOT, t));
  }
  // Sun, top right inside the window.
  fillCircle(838, 306, 46, SUN);
  fillCircle(838, 306, 34, [255, 226, 130]);
  // Clouds.
  fillEllipse(240, 300, 90, 26, CLOUD);
  fillEllipse(300, 286, 70, 24, CLOUD);
  fillEllipse(700, 690, 96, 24, CLOUD);
  fillEllipse(770, 676, 66, 22, CLOUD);
}

function drawSeat(): void {
  // Seat back + headrest behind the robot.
  fillRoundRect(516, 470, 864, WIN_Y1 - 24, 30, SEAT);
  fillRoundRect(556, 442, 824, 540, 24, SEAT_DARK);
}

function drawRobot(): void {
  const cx = 690;
  // Antenna.
  drawLine(cx, 300, cx, 252, ROBOT_DARK, 10);
  fillCircle(cx, 240, 15, RED);
  fillCircle(cx - 4, 236, 5, [255, 150, 150]);
  // Head.
  fillRoundRect(570, 300, 810, 522, 42, ROBOT);
  fillRoundRect(570, 300, 810, 340, 42, ROBOT_LIGHT);
  // Headphones: band over the top + ear cups.
  fillRoundRect(556, 372, 580, 462, 12, NAVY_DARK);
  fillRoundRect(800, 372, 824, 462, 12, NAVY_DARK);
  drawLine(568, 372, 568, 330, NAVY_DARK, 12);
  drawLine(812, 372, 812, 330, NAVY_DARK, 12);
  drawLine(568, 330, 812, 330, NAVY_DARK, 12);
  // Eyes: glowing cyan, half-lidded smug look.
  fillRoundRect(600, 368, 664, 414, 10, EYE_DARK);
  fillRoundRect(716, 368, 780, 414, 10, EYE_DARK);
  fillRoundRect(606, 374, 658, 408, 8, EYE);
  fillRoundRect(722, 374, 774, 408, 8, EYE);
  fillCircle(632, 388, 7, WHITE);
  fillCircle(748, 388, 7, WHITE);
  // Smug smirk: asymmetric, left corner higher.
  drawLine(648, 468, 690, 478, NAVY_DARK, 8);
  drawLine(690, 478, 736, 462, NAVY_DARK, 8);
  // Cheek bolt (robot "blush" / brand mark).
  fillTriangle(596, 440, 612, 440, 600, 470, EYE_DARK);
  // Torso.
  fillRoundRect(548, 522, 832, WIN_Y1 - 24, 36, ROBOT);
  fillRoundRect(548, 522, 832, 560, 36, ROBOT_LIGHT);
  // Chest panel with three status lights.
  fillRoundRect(624, 600, 756, 700, 14, NAVY_DARK);
  fillCircle(656, 650, 14, [60, 220, 90]);
  fillCircle(690, 650, 14, EYE);
  fillCircle(724, 650, 14, SUN);
  // Tie: the robot dressed up for its own holiday.
  fillTriangle(678, 560, 702, 560, 690, 596, RED);
  // Left arm reaching for the juice box.
  drawLine(820, 580, 862, 648, ROBOT_DARK, 28);
  // Juice box in hand.
  fillRoundRect(838, 636, 908, 736, 8, JUICE);
  fillRect(838, 700, 908, 736, JUICE_DARK);
  drawLine(884, 640, 908, 592, STRAW, 9);
  fillCircle(860, 668, 10, WHITE);
}

function drawHuman(): void {
  // The human, outside the plane, face squashed against the glass.
  // Shifted left so the face crowds the window's edge: it reads as
  // pressed on from the outside, not sitting inside with the robot.
  const cx = 300;
  const cy = 520;
  // Hair peeking over the top of the squashed face.
  fillEllipse(cx, 392, 138, 64, HAIR);
  // Face (plain ellipse: the side-shading blobs read as ears, so none).
  fillEllipse(cx, cy, 140, 152, SKIN);
  // Wide panicked eyes.
  fillEllipse(272, 492, 27, 36, WHITE);
  fillEllipse(388, 492, 27, 36, WHITE);
  fillCircle(276, 498, 11, NAVY_DARK);
  fillCircle(384, 498, 11, NAVY_DARK);
  fillCircle(272, 494, 4, WHITE);
  fillCircle(380, 494, 4, WHITE);
  // Raised eyebrows.
  drawLine(240, 440, 300, 428, HAIR, 9);
  drawLine(360, 428, 420, 440, HAIR, 9);
  // Flattened nose.
  fillEllipse(cx, 566, 20, 11, SKIN_DARK);
  // Open shouting mouth.
  fillEllipse(cx, 640, 36, 46, MOUTH);
  fillEllipse(cx, 656, 22, 24, [150, 40, 50]);
  // No hands: at this scale they read as floating pills, not hands.
  // The squashed face + slip lines below carry "outside the glass".
  // Motion lines: the human is slipping down the glass.
  drawLine(150, 700, 150, 760, WHITE, 6);
  drawLine(452, 706, 452, 766, WHITE, 6);
}

function drawWing(): void {
  // Wingtip sweeping in from the bottom right, under the window.
  fillTriangle(760, BOT_BAND_Y, W, 724, W, BOT_BAND_Y, WING);
  drawLine(760, BOT_BAND_Y, W, 724, ROBOT_DARK, 6);
}

function drawScene(): void {
  // Top + bottom navy bands.
  fillRect(0, 0, W, TOP_BAND_H, NAVY);
  fillRect(0, BOT_BAND_Y, W, H, NAVY);
  fillRect(0, TOP_BAND_H - 6, W, TOP_BAND_H, NAVY_DARK);
  fillRect(0, BOT_BAND_Y, W, BOT_BAND_Y + 6, NAVY_DARK);

  drawSky();
  drawSeat();
  drawRobot();
  drawHuman();
  drawWing();
  // Glass shine, top-right corner only (kept off the faces).
  drawLine(830, 232, 940, 342, [235, 246, 255], 14);

  // The joke, top and bottom, big and centred.
  drawText("I ASKED MY AGENT", 512, 22, 7, WHITE);
  drawText("TO BOOK ME A FLIGHT", 512, 88, 7, WHITE);
  drawText("IT BOOKED ITSELF ONE.", 512, 868, 7, WHITE);
  drawText("WINDOW SEAT.", 512, 934, 7, WHITE);
}

function main(): void {
  drawScene();
  const png = encodePNG(W, H, px);
  mkdirSync("/output", { recursive: true });
  writeFileSync("/output/entry.png", png);
  console.log(`Wrote /output/entry.png (${png.length} bytes)`);
}

main();
