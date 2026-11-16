import { expect, test } from "bun:test";
import { parseCpuInfo, parseDmiMemory } from "../src/hardware";

test("cores and threads are told apart by the socket and the core's number", () => {
  const one = (n: number, core: number) => `processor\t: ${n}\nmodel name\t: Intel(R) Core(TM) i3-4010U CPU @ 1.70GHz\nphysical id\t: 0\ncore id\t\t: ${core}\n`;
  expect(parseCpuInfo([one(0, 0), one(1, 1), one(2, 0), one(3, 1)].join("\n"))).toEqual({ cpu: "Intel Core i3-4010U @ 1.70GHz", cores: 2, threads: 4 });
  // ARM names no cores: one per thread
  expect(parseCpuInfo("processor\t: 0\nBogoMIPS\t: 108\n\nprocessor\t: 1\nBogoMIPS\t: 108\n\nModel\t\t: Raspberry Pi 4 Model B\n")).toEqual({ cpu: "Raspberry Pi 4 Model B", cores: 2, threads: 2 });
});

/** A memory device structure as the firmware writes it, followed by its strings */
function device(sizeMb: number, type: number, speed: number, extended = 0): number[] {
  const s = new Array(0x22).fill(0);
  s[0] = 17;
  s[1] = 0x22;
  s[0x0c] = sizeMb & 0xff;
  s[0x0d] = sizeMb >> 8;
  s[0x12] = type;
  s[0x15] = speed & 0xff;
  s[0x16] = speed >> 8;
  for (let i = 0; i < 4; i++) s[0x1c + i] = (extended >> (8 * i)) & 0xff;
  return [...s, ...new TextEncoder().encode("DIMM A"), 0, 0];
}

test("memory modules of the firmware's table: sizes, kinds, speeds, empty slots", () => {
  const table = new Uint8Array([0, 5, 0, 0, 1, 0, 0, ...device(8192, 0x18, 1600), ...device(0, 0x02, 0), ...device(0x7fff, 0x1a, 3200, 65536), 127, 4, 0, 0, 0, 0]);
  expect(parseDmiMemory(table)).toEqual({
    slots: 3,
    modules: [
      { size: 8 * 1024 ** 3, type: "DDR3", speed: 1600 },
      { size: 64 * 1024 ** 3, type: "DDR4", speed: 3200 },
    ],
  });
  expect(parseDmiMemory(new Uint8Array([17, 2]))).toEqual({ modules: [], slots: 0 });
});
