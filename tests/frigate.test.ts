import { describe, expect, test } from "bun:test";
import { EVENT_RE, eventsQuery, NAME_RE, readCameras, readEvent, tokenCookie, trouble } from "../src/frigate";

describe("reading Frigate", () => {
  test("cameras: the config says which, the stats how they are", () => {
    const config = { cameras: { front: { enabled: true, detect: { enabled: false } }, yard: {}, off: { enabled: false }, fresh: {} } };
    const stats = { cameras: { front: { camera_fps: 5.1 }, yard: { camera_fps: 0 }, off: { camera_fps: 0 } } };
    expect(readCameras(config, stats)).toEqual([
      { name: "front", enabled: true, detect: false, fps: 5.1, online: true },
      { name: "yard", enabled: true, detect: true, fps: 0, online: false },
      { name: "off", enabled: false, detect: true, fps: 0, online: false },
      { name: "fresh", enabled: true, detect: true, fps: null, online: false },
    ]);
    expect(readCameras(null, null)).toEqual([]);
  });

  test("an event, going on and finished", () => {
    expect(readEvent({ id: "1.2-abc", camera: "front", label: "person", start_time: 10, end_time: null, zones: ["door"], has_snapshot: true, has_clip: false, data: { top_score: 0.876 } })).toEqual({ id: "1.2-abc", camera: "front", label: "person", score: 88, start: 10000, end: null, zones: ["door"], snapshot: true, clip: false });
    expect(readEvent({ id: "1.2-a", sub_label: "Olia", label: "person", end_time: 20, top_score: 0.5 })).toMatchObject({ label: "Olia", score: 50, end: 20000, zones: [] });
    expect(readEvent({})).toMatchObject({ score: null, snapshot: false });
  });

  test("the session's cookie", () => {
    expect(tokenCookie(["other=1", "frigate_token=abc.def; HttpOnly; Path=/"])).toBe("frigate_token=abc.def");
    expect(tokenCookie(["frigate_token=; Max-Age=0"])).toBe("");
  });
});

describe("what is passed on", () => {
  test("names and ids that can go into a path", () => {
    expect(NAME_RE.test("front_door-1")).toBe(true);
    for (const bad of ["../config", "a/b", "a b", "", "a?x=1"]) expect(NAME_RE.test(bad)).toBe(false);
    expect(EVENT_RE.test("1793541789.123456-ab12cd")).toBe(true);
    for (const bad of ["../../api/config", "1.2-AB/..", "x", "1.2-a/snapshot"]) expect(EVENT_RE.test(bad)).toBe(false);
  });

  test("the events' filter", () => {
    expect(eventsQuery({})).toBe("limit=40");
    expect(eventsQuery({ limit: 1000, camera: "front", label: "person", before: 12.5 })).toBe("limit=100&cameras=front&labels=person&before=12.5");
    expect(eventsQuery({ camera: "a&b=c", label: "../x", before: "nope", limit: -1 })).toBe("limit=1");
  });
});

describe("what needs attention", () => {
  const base = { id: "1", name: "F", error: null, ready: true, cameras: [] };
  const camera = (name: string, enabled: boolean, fps: number | null) => ({ name, enabled, detect: true, fps, online: enabled && fps !== null && fps > 0 });
  test("a refused sign-in or a changed certificate at once, silence after five minutes", () => {
    expect(trouble({ ...base, error: { code: "frigate.badLogin", since: 0 } }, 1)[0]).toMatchObject({ severity: "danger", code: "frigate.badLogin" });
    expect(trouble({ ...base, error: { code: "frigate.certChanged", since: 0 } }, 1)[0]).toMatchObject({ severity: "danger", code: "frigate.certChanged" });
    expect(trouble({ ...base, error: { code: "frigate.noAnswer", since: 0 } }, 60_000)).toEqual([]);
    expect(trouble({ ...base, error: { code: "frigate.noAnswer", since: 0 } }, 6 * 60_000)[0]).toMatchObject({ code: "frigate.away" });
  });
  test("a camera without frames; one switched off or not known yet is not that", () => {
    const items = trouble({ ...base, cameras: [camera("a", true, 0), camera("b", true, 5), camera("c", false, 0), camera("d", true, null)] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "frigate:1:camera:a", code: "frigate.camera", detail: { camera: "a" } });
  });
});
