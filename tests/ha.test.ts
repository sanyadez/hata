import { expect, test } from "bun:test";
import { actionsOf, areaOf, cleanPeople, cleanUrl, lowBatteries, sees, serviceOf, show, trouble, updatesOf, type RawState } from "../src/ha";

const state = (entity_id: string, s: string, attributes: Record<string, unknown> = {}, last_changed = "2026-10-24T09:00:00Z"): RawState => ({ entity_id, state: s, attributes, last_changed });

test("an address as typed becomes the origin of the API", () => {
  expect(cleanUrl("192.168.1.5")).toBe("http://192.168.1.5:8123");
  expect(cleanUrl("homeassistant.local:8123/")).toBe("http://homeassistant.local:8123");
  expect(cleanUrl("https://ha.example.com")).toBe("https://ha.example.com");
  expect(cleanUrl("http://192.168.1.5:8123/lovelace/0")).toBeNull();
  expect(cleanUrl("https://user:pw@ha.example.com")).toBeNull();
  expect(cleanUrl("ftp://ha")).toBeNull();
  expect(cleanUrl("ha example")).toBeNull();
  expect(cleanUrl(5)).toBeNull();
});

test("what a press can do follows the domain and what the entity supports", () => {
  expect(actionsOf(state("switch.kettle", "off"))).toEqual(["toggle"]);
  expect(actionsOf(state("light.desk", "on", { supported_color_modes: ["onoff"] }))).toEqual(["toggle"]);
  expect(actionsOf(state("light.bed", "on", { supported_color_modes: ["brightness"] }))).toEqual(["toggle", "brightness"]);
  expect(actionsOf(state("cover.garage", "closed", { supported_features: 3 }))).toEqual(["open", "close"]);
  expect(actionsOf(state("cover.blinds", "open", { supported_features: 15 }))).toEqual(["open", "close", "stop"]);
  expect(actionsOf(state("lock.door", "locked"))).toEqual(["lock", "unlock"]);
  expect(actionsOf(state("scene.evening", "unknown"))).toEqual(["run"]);
  expect(actionsOf(state("button.restart", "unknown"))).toEqual(["press"]);
  // a thermostat with one number to set, and one with a range (heat and cool) — the second has no press
  expect(actionsOf(state("climate.room", "heat", { supported_features: 1, temperature: 21, min_temp: 7, max_temp: 35 }))).toEqual(["temperature"]);
  expect(actionsOf(state("climate.ecobee", "heat_cool", { supported_features: 2, temperature: null, target_temp_low: 20 }))).toEqual([]);
  expect(actionsOf(state("media_player.tv", "off", { supported_features: 128 | 256 | 1 | 16384 }))).toEqual(["toggle", "playPause"]);
  expect(actionsOf(state("vacuum.robot", "docked", { supported_features: 8192 | 16 }))).toEqual(["start", "dock"]);
  expect(actionsOf(state("sensor.temp", "21.4"))).toEqual([]);
});

test("a press becomes a service of Home Assistant, and nothing else", () => {
  const bed = state("light.bed", "on", { supported_color_modes: ["brightness"] });
  expect(serviceOf(bed, "toggle")).toEqual({ domain: "light", service: "toggle", data: {} });
  expect(serviceOf(bed, "brightness", 40)).toEqual({ domain: "light", service: "turn_on", data: { brightness_pct: 40 } });
  expect(serviceOf(bed, "brightness", 0)).toEqual({ domain: "light", service: "turn_off", data: {} });
  expect(serviceOf(bed, "brightness", 140)).toBeNull();
  expect(serviceOf(bed, "brightness", "40")).toBeNull();
  expect(serviceOf(bed, "unlock")).toBeNull();
  expect(serviceOf(bed, { evil: 1 })).toBeNull();
  expect(serviceOf(state("valve.garden", "open", { supported_features: 3 }), "close")).toEqual({ domain: "valve", service: "close_valve", data: {} });
  expect(serviceOf(state("cover.blinds", "open", { supported_features: 15 }), "stop")).toEqual({ domain: "cover", service: "stop_cover", data: {} });
  expect(serviceOf(state("media_player.tv", "off", { supported_features: 384 }), "toggle")).toEqual({ domain: "media_player", service: "turn_on", data: {} });
  expect(serviceOf(state("scene.evening", "x"), "run")).toEqual({ domain: "scene", service: "turn_on", data: {} });
  const room = state("climate.room", "heat", { supported_features: 1, temperature: 21, min_temp: 7, max_temp: 35 });
  expect(serviceOf(room, "temperature", 21.54)).toEqual({ domain: "climate", service: "set_temperature", data: { temperature: 21.5 } });
  expect(serviceOf(room, "temperature", 40)).toBeNull();
});

test("a state is told to a tile with what it needs", () => {
  const s = show(state("light.bed", "on", { friendly_name: "Bed Light", brightness: 102, supported_color_modes: ["brightness"] }), "Bedroom");
  expect(s).toEqual({ id: "light.bed", name: "Bed Light", domain: "light", state: "on", unit: "", kind: "", area: "Bedroom", actions: ["toggle", "brightness"], at: Date.parse("2026-10-24T09:00:00Z"), brightness: 40 });
  expect(show(state("light.bed", "off", { brightness: null })).brightness).toBeUndefined();
  const t = show(state("sensor.out", "15.6", { unit_of_measurement: "°C", device_class: "temperature" }));
  expect([t.name, t.unit, t.kind, t.actions]).toEqual(["sensor.out", "°C", "temperature", []]);
  const c = show(state("climate.room", "heat", { supported_features: 1, temperature: 21, current_temperature: 25, min_temp: 7, max_temp: 35 }));
  expect([c.target, c.current, c.min, c.max, c.step]).toEqual([21, 25, 7, 35, 0.5]);
});

test("updates: those offered, Home Assistant itself first", () => {
  const list = updatesOf([
    state("update.zigbee_firmware", "on", { friendly_name: "Plug firmware", installed_version: "1.0", latest_version: "1.1", supported_features: 1 }, "2026-10-24T08:00:00Z"),
    state("update.home_assistant_core_update", "on", { friendly_name: "Home Assistant Core Update", title: "Home Assistant Core", installed_version: "2026.10.0", latest_version: "2026.10.1", supported_features: 1 | 8 | 4, release_url: "https://www.home-assistant.io/blog", in_progress: false }),
    state("update.adguard", "off", { installed_version: "1", latest_version: "1" }),
    state("update.esp", "on", { friendly_name: "ESP", installed_version: "1", latest_version: "2", supported_features: 0, release_url: "javascript:alert(1)" }),
  ]);
  expect(list.map((u) => u.entity)).toEqual(["update.home_assistant_core_update", "update.esp", "update.zigbee_firmware"]);
  expect(list[0]).toMatchObject({ install: true, backup: true, running: false, url: "https://www.home-assistant.io/blog", latest: "2026.10.1" });
  expect(list[1]).toMatchObject({ install: false, backup: false, url: "" });
});

test("batteries that want changing", () => {
  expect(
    lowBatteries([
      state("sensor.door_battery", "12", { device_class: "battery", friendly_name: "Door battery" }),
      state("sensor.co2_battery", "99", { device_class: "battery" }),
      state("sensor.gone_battery", "unavailable", { device_class: "battery" }),
      state("binary_sensor.remote_battery", "on", { device_class: "battery", friendly_name: "Remote" }),
      state("binary_sensor.ok_battery", "off", { device_class: "battery" }),
      state("sensor.humidity", "10", { device_class: "humidity" }),
    ]),
  ).toEqual([
    { entity: "sensor.door_battery", name: "Door battery", level: 12 },
    { entity: "binary_sensor.remote_battery", name: "Remote", level: null },
  ]);
});

test("an entity's room is its own, else its device's", () => {
  const devices = new Map<string, string | null>([["d1", "kitchen"], ["d2", null]]);
  const areas = new Map([["kitchen", "Kitchen"], ["hall", "Hall"]]);
  expect(areaOf({ di: "d1" }, devices, areas)).toBe("Kitchen");
  expect(areaOf({ ai: "hall", di: "d1" }, devices, areas)).toBe("Hall");
  expect(areaOf({ di: "d2" }, devices, areas)).toBe("");
  expect(areaOf({}, devices, areas)).toBe("");
});

test("who sees the tiles of a server", () => {
  const id = "9973f4ab-4016-4262-996c-59edd51a9df7";
  expect(cleanPeople("all")).toBe("all");
  expect(cleanPeople([id, id, "nope", 5])).toEqual([id]);
  expect(cleanPeople("everyone")).toEqual([]);
  expect(sees([], { id, role: "admin" })).toBe(true);
  expect(sees([], { id, role: "member" })).toBe(false);
  expect(sees([id], { id, role: "member" })).toBe(true);
  expect(sees("all", { id: "x", role: "guest" })).toBe(true);
});

test("what is worth the person's attention", () => {
  const base = { id: "8bf90303", name: "Home", error: null, ready: true, updates: [], low: [] };
  expect(trouble(base)).toEqual([]);
  // away for a minute is nothing yet; for ten minutes it is
  expect(trouble({ ...base, error: { code: "ha.unreachable", since: 1_000_000 } }, 1_060_000)).toEqual([]);
  expect(trouble({ ...base, error: { code: "ha.unreachable", since: 1_000_000 } }, 1_600_000)).toEqual([{ id: "ha:8bf90303", severity: "warn", code: "ha.away", detail: { host: "8bf90303", name: "Home" } }]);
  expect(trouble({ ...base, error: { code: "ha.badToken", since: 1_000_000 } }, 1_000_001)[0]!.code).toBe("ha.badToken");
  // what it said last is not told while it is away, nor before it was read
  expect(trouble({ ...base, ready: false, low: [{ entity: "sensor.b", name: "B", level: 5 }] })).toEqual([]);
  const updates = updatesOf([state("update.a", "on", { title: "Core", installed_version: "1", latest_version: "2" }, "2026-10-24T08:00:00Z"), state("update.b", "on", { installed_version: "1", latest_version: "3" }, "2026-10-24T10:00:00Z")]);
  const items = trouble({ ...base, updates, low: [{ entity: "sensor.b", name: "B", level: 5 }, { entity: "binary_sensor.r", name: "R", level: null }] });
  expect(items).toEqual([
    { id: "ha:8bf90303:updates", severity: "warn", code: "ha.updates", detail: { host: "8bf90303", name: "Home", n: 2, update: "Core", version: "2" }, at: Date.parse("2026-10-24T10:00:00Z") },
    { id: "ha:8bf90303:battery:sensor.b", severity: "warn", code: "ha.battery", detail: { host: "8bf90303", name: "Home", device: "B", level: 5 } },
    { id: "ha:8bf90303:battery:binary_sensor.r", severity: "warn", code: "ha.batteryLow", detail: { host: "8bf90303", name: "Home", device: "R", level: "" } },
  ]);
});
