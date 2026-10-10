import { expect, test } from "bun:test";
import { iconType } from "../src/apps";

const bytes = (text: string) => new TextEncoder().encode(text);

test("an icon is told by how the file begins, an SVG by its opening tag", () => {
  expect(iconType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
  expect(iconType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
  expect(iconType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("svg");
  expect(iconType(bytes('﻿<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "x" "y">\n<svg viewBox="0 0 1 1">'))).toBe("svg");
  expect(iconType(bytes("<html><svg></svg></html>"))).toBe("");
  expect(iconType(bytes("GIF89a"))).toBe("");
  expect(iconType(new Uint8Array())).toBe("");
});
