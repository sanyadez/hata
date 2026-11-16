import { expect, test } from "bun:test";
import { adaptersOf, blocked, cleanAddress, connectError, deviceOf, devicesOf, kindOf, pairError, pathOf, pinFor, sixDigits, type Objects } from "../src/bt";
import { decode, encode, firstType, marshal, typesOf, unmarshal, variant } from "../src/dbus";

const uuid = (short: string) => `0000${short}-0000-1000-8000-00805f9b34fb`;

const objects: Objects = {
  "/org/bluez": { "org.bluez.AgentManager1": {} },
  "/org/bluez/hci0": { "org.bluez.Adapter1": { Address: "AA:AA:AA:AA:AA:AA", Alias: "test", Powered: true, Discovering: true } },
  "/org/bluez/hci0/dev_11_22_33_44_55_66": {
    "org.bluez.Device1": { Address: "11:22:33:44:55:66", Name: "K380", Alias: "K380", Icon: "input-keyboard", Paired: true, Trusted: true, Connected: true, UUIDs: [uuid("1124")] },
    "org.bluez.Battery1": { Percentage: 70 },
  },
  "/org/bluez/hci0/dev_22_22_33_44_55_66": { "org.bluez.Device1": { Address: "22:22:33:44:55:66", Name: "JBL Go", Alias: "JBL Go", Icon: "audio-card", Paired: false, RSSI: -70, UUIDs: [uuid("110b")] } },
  "/org/bluez/hci0/dev_33_22_33_44_55_66": { "org.bluez.Device1": { Address: "33:22:33:44:55:66", Alias: "33-22-33-44-55-66", Paired: false, RSSI: -50 } },
  "/org/bluez/hci0/dev_44_22_33_44_55_66": { "org.bluez.Device1": { Address: "44:22:33:44:55:66", Name: "G10S", Alias: "G10S", Appearance: 0x0180, Paired: false, RSSI: -55, UUIDs: [uuid("1812")] } },
  "/org/bluez/hci0/dev_55_22_33_44_55_66": { "org.bluez.Device1": { Address: "55:22:33:44:55:66", Name: "Old", Alias: "Old", Paired: false } },
};

test("what BlueZ has becomes the adapter and the two lists", () => {
  expect(adaptersOf(objects)).toEqual([{ path: "/org/bluez/hci0", name: "test", address: "AA:AA:AA:AA:AA:AA", on: true, looking: true }]);
  const { devices, found } = devicesOf(objects);
  expect(devices.map((d) => d.name)).toEqual(["K380"]);
  expect(devices[0]).toMatchObject({ kind: "keyboard", battery: 70, connected: true, input: true, audio: false, signal: null });
  // the nearest first; one that does not say its name, or is not heard now, is not offered
  expect(found.map((d) => d.name)).toEqual(["G10S", "JBL Go"]);
  expect(found[0]!.kind).toBe("remote");
  expect(found[1]).toMatchObject({ kind: "speaker", audio: true, input: false });
  expect(pathOf(objects, "22:22:33:44:55:66")).toBe("/org/bluez/hci0/dev_22_22_33_44_55_66");
  expect(pathOf(objects, "99:22:33:44:55:66")).toBe("");
  expect(deviceOf(objects, "/org/bluez/hci0")).toBeNull();
});

test("what a device is", () => {
  expect(kindOf({ Icon: "audio-headset" })).toBe("headphones");
  expect(kindOf({ Appearance: 0x03c2 })).toBe("mouse");
  expect(kindOf({ UUIDs: [uuid("1124")] })).toBe("input");
  expect(kindOf({ UUIDs: [uuid("110b")] })).toBe("speaker");
  expect(kindOf({})).toBe("other");
});

test("addresses, codes and PINs", () => {
  expect(cleanAddress("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
  expect(cleanAddress("aa:bb")).toBe("");
  expect(cleanAddress("../../etc")).toBe("");
  expect(sixDigits(4521)).toBe("004521");
  expect(pinFor({ kind: "keyboard", input: true }, () => 0.123456)).toEqual({ pin: "123456", show: true });
  expect(pinFor({ kind: "speaker", input: false })).toEqual({ pin: "0000", show: false });
});

test("failures in Hata's words", () => {
  expect(pairError("org.bluez.Error.AuthenticationTimeout")).toBe("bluetooth.pair.timeout");
  expect(pairError("something.else")).toBe("bluetooth.pair.failed");
  expect(connectError("org.bluez.Error.Failed", "br-connection-profile-unavailable")).toBe("bluetooth.noProfile");
  expect(connectError("org.bluez.Error.Failed", "br-connection-page-timeout")).toBe("bluetooth.unreachable");
  expect(connectError("org.bluez.Error.Failed", "Host is down")).toBe("bluetooth.unreachable");
  expect(connectError("org.bluez.Error.Failed", "other")).toBe("bluetooth.connectFailed");
});

test("the kernel's radio switches", () => {
  expect(blocked([{ type: "wlan\n", soft: "1\n", hard: "0\n" }, { type: "bluetooth\n", soft: "1\n", hard: "0\n" }])).toEqual({ soft: true, hard: false });
  expect(blocked([{ type: "wlan\n", soft: "1\n", hard: "1\n" }])).toEqual({ soft: false, hard: false });
});

test("D-Bus signatures", () => {
  expect(typesOf("sa{sv}as(ia(yv))x")).toEqual(["s", "a{sv}", "as", "(ia(yv))", "x"]);
  expect(firstType("a{sa{sv}}u")).toBe("a{sa{sv}}");
  expect(() => typesOf("a{sv")).toThrow();
  expect(() => typesOf("z")).toThrow();
});

test("D-Bus values there and back, with the padding the format asks for", () => {
  // the example every description of the format has: a byte, then a 32-bit number on a boundary of four
  expect([...marshal("yu", [1, 2])]).toEqual([1, 0, 0, 0, 2, 0, 0, 0]);
  expect([...marshal("s", ["hi"])]).toEqual([2, 0, 0, 0, 0x68, 0x69, 0]);
  // an array of 64-bit numbers: its length does not count the padding before the first one
  expect([...marshal("at", [[5]])]).toEqual([8, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0]);
  const signature = "ybnqiuxtdsoga{sv}a(sy)av";
  const values = [200, true, -2, 65000, -5, 4000000000, -(2 ** 40), 2 ** 41, 0.25, "слово", "/a/b", "as", { one: variant("as", ["x"]), two: variant("b", false) }, [["k", 1]], [variant("u", 7), variant("(si)", ["z", 3])]];
  expect(unmarshal(signature, marshal(signature, values))).toEqual([200, true, -2, 65000, -5, 4000000000, -(2 ** 40), 2 ** 41, 0.25, "слово", "/a/b", "as", { one: ["x"], two: false }, [["k", 1]], [7, ["z", 3]]]);
});

test("a D-Bus message there and back, whole or in pieces", () => {
  const bytes = encode({ type: 1, serial: 9, destination: "org.bluez", path: "/org/bluez/hci0", interface: "org.freedesktop.DBus.Properties", member: "Set", signature: "ssv", body: ["org.bluez.Adapter1", "Powered", variant("b", true)] });
  expect(bytes[0]).toBe(0x6c);
  expect(decode(bytes.subarray(0, 10))).toBeNull();
  expect(decode(bytes.subarray(0, bytes.length - 1))).toBeNull();
  const two = new Uint8Array(bytes.length * 2);
  two.set(bytes);
  two.set(bytes, bytes.length);
  const got = decode(two)!;
  expect(got.used).toBe(bytes.length);
  expect(got.message).toMatchObject({ type: 1, serial: 9, member: "Set", destination: "org.bluez", path: "/org/bluez/hci0", body: ["org.bluez.Adapter1", "Powered", true] });
});

test("a big-endian D-Bus message is read too", () => {
  // a signal with one string, as a big-endian sender writes it
  const fields = [1, 1, 0x6f, 0, 0, 0, 0, 2, 0x2f, 0x61, 0, 0, 0, 0, 0, 0, 8, 1, 0x67, 0, 1, 0x73, 0];
  const header = [0x42, 4, 0, 1, 0, 0, 0, 7, 0, 0, 0, 3, 0, 0, 0, fields.length, ...fields];
  while (header.length % 8) header.push(0);
  const got = decode(Uint8Array.from([...header, 0, 0, 0, 2, 0x68, 0x69, 0]))!;
  expect(got.message).toMatchObject({ type: 4, serial: 3, path: "/a", body: ["hi"] });
});
