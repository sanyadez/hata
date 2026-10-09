import { expect, test } from "bun:test";
import { changeAppearance, cleanAppearance, DEFAULT_APPEARANCE, imageType, wallpaperSvg, WALLPAPERS } from "../src/wallpapers";

test("built-in backgrounds are SVG pictures that come out the same every time", () => {
  expect(WALLPAPERS.length).toBeGreaterThanOrEqual(5);
  for (const id of WALLPAPERS) {
    const svg = wallpaperSvg(id)!;
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("<script");
    expect(svg.length).toBeLessThan(120_000);
    expect(wallpaperSvg(id)).toBe(svg);
  }
  expect(wallpaperSvg("nope")).toBeNull();
  expect(wallpaperSvg("constructor")).toBeNull();
});

test("a picture is told by how the file begins", () => {
  const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
  expect(imageType(bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF"))).toBe("jpg");
  expect(imageType(bytes([0x89], "PNG\r\n", [0x1a, 0x0a]))).toBe("png");
  expect(imageType(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 "))).toBe("webp");
  expect(imageType(bytes([0, 0, 0, 0x1c], "ftypavif"))).toBe("avif");
  expect(imageType(bytes("<svg xmlns"))).toBe("");
  expect(imageType(bytes("GIF89a"))).toBe("");
  expect(imageType(new Uint8Array(0))).toBe("");
});

test("the look changes field by field, and nonsense is refused", () => {
  const start = DEFAULT_APPEARANCE;
  expect(changeAppearance(start, { accent: "#3B82C4" })).toMatchObject({ accent: "#3b82c4", background: "" });
  expect(changeAppearance(start, { background: "#101820", wallpaper: "ocean", dim: 30 })).toMatchObject({ background: "#101820", wallpaper: "ocean", dim: 30 });
  expect(changeAppearance({ ...start, accent: "#3b82c4" }, { accent: "" })!.accent).toBe("");
  for (const bad of [{ accent: "red" }, { accent: "#fff" }, { background: 5 }, { wallpaper: "nope" }, { wallpaper: "custom" }, { dim: 95 }, { dim: 1.5 }, { dim: "40" }]) expect(changeAppearance(start, bad)).toBeNull();
  // the uploaded picture can be chosen once there is one, and is not set through a change
  const uploaded = { ...start, custom: "jpg" as const, stamp: 7 };
  expect(changeAppearance(uploaded, { wallpaper: "custom" })!.wallpaper).toBe("custom");
  expect(changeAppearance(start, { custom: "png", stamp: 9 })).toEqual(start);
});

test("saved settings are made whole", () => {
  expect(cleanAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
  expect(cleanAppearance({ accent: "#3b82c4", background: "blue", wallpaper: "dusk", dim: 500 })).toEqual({ ...DEFAULT_APPEARANCE, accent: "#3b82c4", wallpaper: "dusk" });
  expect(cleanAppearance({ wallpaper: "custom", custom: "webp", stamp: 3 })).toMatchObject({ wallpaper: "custom", custom: "webp", stamp: 3 });
  expect(cleanAppearance({ wallpaper: "custom", custom: "gif", stamp: 3 })).toEqual(DEFAULT_APPEARANCE);
});
