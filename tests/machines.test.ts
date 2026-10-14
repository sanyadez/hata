import { expect, test } from "bun:test";
import { broadcastOf, magicPacket } from "../src/machines";

test("the magic packet is six 0xFF and the address sixteen times", () => {
  const p = magicPacket("aa:bb:cc:dd:ee:0f");
  expect(p.length).toBe(102);
  expect([...p.subarray(0, 6)]).toEqual([255, 255, 255, 255, 255, 255]);
  for (let i = 0; i < 16; i++) expect([...p.subarray(6 + i * 6, 12 + i * 6)]).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x0f]);
  expect(magicPacket("AA-BB-CC-DD-EE-0F")).toEqual(p);
  expect(() => magicPacket("aa:bb:cc")).toThrow();
  expect(() => magicPacket("zz:bb:cc:dd:ee:ff")).toThrow();
});

test("the broadcast address of a home network", () => {
  expect(broadcastOf("192.168.1.42", "255.255.255.0")).toBe("192.168.1.255");
  expect(broadcastOf("10.1.2.3", "255.255.0.0")).toBe("10.1.255.255");
  expect(broadcastOf("172.16.5.9", "255.255.255.252")).toBe("172.16.5.11");
});
