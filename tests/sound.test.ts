import { expect, test } from "bun:test";
import { cleanLink, musicCommand, musicUnit, nameOf, nowOf, outputFor, outputsOf, parseCards, queueOf, takeLines } from "../src/sound";

const CARDS = ` 0 [PCH            ]: HDA-Intel - HDA Intel PCH
                      HDA Intel PCH at 0xf7210000 irq 50
 1 [HDMI           ]: HDA-Intel - HDA Intel HDMI
                      HDA Intel HDMI at 0xf7214000 irq 53
 2 [Device         ]: USB-Audio - USB Composite Device
                      HAOBO Technology USB Composite Device at usb-0000:00:14.0-4, full speed
 3 [Device_1       ]: USB-Audio - USB PnP Sound Device
                      C-Media Electronics Inc. USB PnP Sound Device at usb-0000:00:14.0-1, full speed
`;

test("the sound outputs of a server", () => {
  const cards = parseCards(CARDS);
  expect(cards.map((c) => [c.index, c.id, c.usb])).toEqual([[0, "PCH", false], [1, "HDMI", false], [2, "Device", true], [3, "Device_1", true]]);
  // the remote with a microphone (card 2) plays nothing: it has no device that plays, so it is not an output
  const pcms = [{ card: 0, device: 0, name: "ALC283 Analog" }, { card: 1, device: 3, name: "HDMI 0" }, { card: 1, device: 7, name: "HDMI 1" }, { card: 3, device: 0, name: "USB Audio" }];
  const outputs = outputsOf(cards, pcms, [{ address: "11:22:33:44:55:66", name: "JBL Go" }]);
  expect(outputs).toEqual([
    { id: "bluealsa:DEV=11:22:33:44:55:66,PROFILE=a2dp", kind: "bluetooth", name: "JBL Go" },
    { id: "plughw:CARD=Device_1,DEV=0", kind: "usb", name: "USB PnP Sound Device" },
    { id: "plughw:CARD=PCH,DEV=0", kind: "analog", name: "HDA Intel PCH" },
    { id: "plughw:CARD=HDMI,DEV=3", kind: "hdmi", name: "HDMI 0" },
    { id: "plughw:CARD=HDMI,DEV=7", kind: "hdmi", name: "HDMI 1" },
  ]);
  expect(outputFor("plughw:CARD=HDMI,DEV=3", outputs)).toBe("plughw:CARD=HDMI,DEV=3");
  // a speaker that is gone: the first output that is not the TV's
  expect(outputFor("bluealsa:DEV=99:22:33:44:55:66,PROFILE=a2dp", outputs.slice(1))).toBe("plughw:CARD=Device_1,DEV=0");
  expect(outputFor("", outputs.slice(3))).toBe("plughw:CARD=HDMI,DEV=3");
  expect(outputFor("", [])).toBe("");
});

test("the player's service", () => {
  const unit = musicUnit();
  expect(unit).toContain("User=hata-music");
  expect(unit).toContain("--input-ipc-server=/run/hata-music/mpv.sock");
  expect(unit).toContain("--ytdl=no");
  expect(unit).toContain("--no-config");
});

test("what mpv says, line by line", () => {
  const got = takeLines('{"event":"pause"}\n{"request_id":3,"error":"success","data":5}\nnot json\n{"request_');
  expect(got.messages).toEqual([{ event: "pause" }, { request_id: 3, error: "success", data: 5 }]);
  expect(got.rest).toBe('{"request_');
});

test("links and names", () => {
  expect(cleanLink("https://radio.example/stream.mp3")).toBe("https://radio.example/stream.mp3");
  expect(cleanLink("file:///etc/passwd")).toBe("");
  expect(cleanLink("ftp://x/y")).toBe("");
  expect(cleanLink(5)).toBe("");
  expect(nameOf("/DATA/Music/Океан Ельзи/01 Обійми.flac")).toBe("01 Обійми");
  expect(nameOf("https://radio.example/live?token=1")).toBe("radio.example/live");
});

test("the queue and what plays", () => {
  expect(queueOf([{ filename: "/m/a.mp3", current: true, playing: true }, { filename: "https://r.example/s", title: "Radio R" }, {}])).toEqual([
    { title: "a", where: "/m", link: false, current: true },
    { title: "Radio R", where: "", link: true, current: false },
    { title: "", where: "", link: false, current: false },
  ]);
  const props = { idle: false, path: "/m/a.mp3", title: "a.mp3", metadata: { Title: "Song", ARTIST: "Band", album: "Disc" }, position: 12.5, duration: 200, paused: false };
  expect(nowOf(props)).toEqual({ title: "Song", by: "Band · Disc", link: false, position: 12.5, duration: 200, paused: false });
  expect(nowOf({ ...props, metadata: null })!.title).toBe("a");
  // a station names the song and itself; it has no length
  expect(nowOf({ idle: false, path: "https://r.example/s", title: "https://r.example/s", metadata: { "icy-title": "Band - Song", "icy-name": "Radio R" }, position: 3, duration: 19.5, paused: true })).toEqual({ title: "Band - Song", by: "Radio R", link: true, position: 3, duration: 0, paused: true });
  expect(nowOf({ ...props, idle: true })).toBeNull();
});

test("the player's buttons", () => {
  expect(musicCommand("playpause", undefined, 3)).toEqual(["cycle", "pause"]);
  expect(musicCommand("seek", 61.7, 3)).toEqual(["seek", 61, "absolute"]);
  expect(musicCommand("volume", 140, 3)).toBeNull();
  expect(musicCommand("jump", 2, 3)).toEqual(["set_property", "playlist-pos", 2]);
  expect(musicCommand("jump", 3, 3)).toBeNull();
  expect(musicCommand("remove", -1, 3)).toBeNull();
  expect(musicCommand("quit", undefined, 3)).toBeNull();
  expect(musicCommand("run", "rm -rf /", 3)).toBeNull();
});
