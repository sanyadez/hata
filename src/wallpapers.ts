/**
 * The backgrounds Hata comes with (pure): each one is an SVG drawn by a few lines of arithmetic from a
 * fixed seed, so the same picture comes out every time and no image file is shipped.
 */

const W = 1600;
const H = 1000;

/** A small seeded generator (mulberry32): the pictures must not change between runs */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
const n = (value: number) => String(Math.round(value * 10) / 10);

/** Soft glows of colour over a base: the look of a blurred photograph */
function glow(seed: number, base: string, colours: string[], count: number): string {
  const rand = random(seed);
  let defs = "";
  let shapes = `<rect width="${W}" height="${H}" fill="${base}"/>`;
  for (let i = 0; i < count; i++) {
    const colour = colours[i % colours.length]!;
    defs += `<radialGradient id="g${i}"><stop offset="0" stop-color="${colour}" stop-opacity="${n(0.5 + rand() * 0.4)}"/><stop offset="1" stop-color="${colour}" stop-opacity="0"/></radialGradient>`;
    shapes += `<ellipse cx="${n(rand() * W)}" cy="${n(rand() * H)}" rx="${n(380 + rand() * 520)}" ry="${n(300 + rand() * 420)}" fill="url(#g${i})"/>`;
  }
  return svg(`<defs>${defs}</defs>${shapes}`);
}

/** A wavy line across the picture at about `y`, as path commands */
function wave(rand: () => number, y: number, height: number): string {
  const waves = [0, 1, 2].map(() => ({ length: 500 + rand() * 900, shift: rand() * Math.PI * 2, part: 0.4 + rand() * 0.6 }));
  let path = "";
  for (let x = 0; x <= W; x += 40) {
    const lift = waves.reduce((sum, w) => sum + Math.sin((x / w.length) * Math.PI * 2 + w.shift) * w.part, 0) / waves.length;
    path += `${x === 0 ? "M" : "L"}${x} ${n(y + lift * height)}`;
  }
  return path;
}

/** Ridges one behind another under a sky: hills, dunes, the sea */
function ridges(seed: number, sky: [string, string], layers: string[], height: number): string {
  const rand = random(seed);
  let shapes = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  layers.forEach((colour, i) => {
    const y = H * (0.42 + (0.5 * i) / layers.length);
    shapes += `<path d="${wave(rand, y, height)}L${W} ${H}L0 ${H}Z" fill="${colour}"/>`;
  });
  return svg(shapes);
}

/** Thin lines following one another, like heights on a map */
function contours(seed: number, base: string, line: string, count: number): string {
  const rand = random(seed);
  const waves = [0, 1, 2].map(() => ({ length: 600 + rand() * 900, shift: rand() * Math.PI * 2, part: 0.5 + rand() * 0.5 }));
  let shapes = `<rect width="${W}" height="${H}" fill="${base}"/>`;
  for (let i = 0; i < count; i++) {
    const y = -80 + ((H + 160) * i) / (count - 1);
    let path = "";
    for (let x = 0; x <= W; x += 40) {
      // neighbouring lines drift apart slowly, which is what makes them read as a surface
      const lift = waves.reduce((sum, w, k) => sum + Math.sin((x / w.length) * Math.PI * 2 + w.shift + i * 0.11 * (k + 1)) * w.part, 0);
      path += `${x === 0 ? "M" : "L"}${x} ${n(y + lift * 46)}`;
    }
    shapes += `<path d="${path}" fill="none" stroke="${line}" stroke-width="1.4" stroke-opacity="${n(0.25 + 0.5 * Math.abs(Math.sin(i * 0.37)))}"/>`;
  }
  return svg(shapes);
}

const MAKERS: Record<string, () => string> = {
  dusk: () => glow(11, "#17110f", ["#f5a524", "#d9486e", "#6b3fa0", "#c2571a"], 7),
  aurora: () => glow(27, "#06131a", ["#1fbf8f", "#2f7fd6", "#7a4fd0", "#12a3a8"], 7),
  mist: () => glow(5, "#e9e4dd", ["#f7c89a", "#b9d3ee", "#e7b6c9", "#cfe3c7"], 8),
  dunes: () => ridges(42, ["#2b1a2e", "#e08a4a"], ["#b5613a", "#8f4630", "#6a3128", "#47211f", "#2a1516"], 60),
  ocean: () => ridges(8, ["#0a1a2e", "#1f5f8b"], ["#1b5c85", "#16496f", "#113958", "#0c2a43", "#081c2f"], 34),
  contours: () => contours(19, "#121416", "#6fa8e8", 34),
};

export const WALLPAPERS = Object.keys(MAKERS);

const made = new Map<string, string>();

/** The SVG of a built-in background; null when there is none by this name */
export function wallpaperSvg(id: string): string | null {
  if (!Object.hasOwn(MAKERS, id)) return null;
  if (!made.has(id)) made.set(id, MAKERS[id]!());
  return made.get(id)!;
}

/** What kind of picture these bytes are, by how the file begins; "" — not one we show */
export function imageType(head: Uint8Array): "jpg" | "png" | "webp" | "avif" | "" {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpg";
  if (head[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "avif";
  return "";
}

export const IMAGE_MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" } as const;

export interface Appearance {
  /** `#rrggbb`, or "" for Hata's own */
  accent: string;
  background: string;
  /** "" — none, "custom" — the uploaded picture, otherwise the name of a built-in one */
  wallpaper: string;
  /** How much of the background colour lies over the picture, percent */
  dim: number;
  /** The kind of the uploaded picture ("" — none uploaded) and when it came, for the browser's cache */
  custom: "" | keyof typeof IMAGE_MIME;
  stamp: number;
}

export const DEFAULT_APPEARANCE: Appearance = { accent: "", background: "", wallpaper: "", dim: 60, custom: "", stamp: 0 };

const COLOUR_RE = /^#[0-9a-f]{6}$/;

/**
 * Applies a change of the look to what is saved; null when the change makes no sense. The uploaded
 * picture itself (`custom`, `stamp`) is not set this way.
 */
export function changeAppearance(now: Appearance, patch: Record<string, unknown>): Appearance | null {
  const next = { ...now };
  for (const key of ["accent", "background"] as const) {
    if (!(key in patch)) continue;
    const value = typeof patch[key] === "string" ? (patch[key] as string).toLowerCase() : null;
    if (value === null || (value !== "" && !COLOUR_RE.test(value))) return null;
    next[key] = value;
  }
  if ("wallpaper" in patch) {
    const value = patch.wallpaper;
    if (typeof value !== "string" || (value !== "" && value !== "custom" && !WALLPAPERS.includes(value))) return null;
    if (value === "custom" && !now.custom) return null;
    next.wallpaper = value;
  }
  if ("dim" in patch) {
    const value = patch.dim;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 90) return null;
    next.dim = value;
  }
  return next;
}

/** What was saved, made whole: a file written by an older version has none of this, a hand-edited one anything */
export function cleanAppearance(saved: unknown): Appearance {
  const raw = (typeof saved === "object" && saved !== null ? saved : {}) as Record<string, unknown>;
  const custom = typeof raw.custom === "string" && Object.hasOwn(IMAGE_MIME, raw.custom) ? (raw.custom as Appearance["custom"]) : "";
  const base = { ...DEFAULT_APPEARANCE, custom, stamp: custom && typeof raw.stamp === "number" ? raw.stamp : 0 };
  let next = base;
  // each field on its own: one bad value must not cost the others
  for (const key of ["accent", "background", "wallpaper", "dim"]) if (key in raw) next = changeAppearance(next, { [key]: raw[key] }) ?? next;
  return next;
}
