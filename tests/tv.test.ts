import { expect, test } from "bun:test";
import { clickPacket, helloPacket, KEEP_WINDOW, KEEP_YES, pictureOf, advancedXml, cleanFolders, shortTitle, hwdbText, keymapXml, polkitRule, decodePackages, isOurs, monitorAudio, monitorName, playable, portIn, readDisplay, remoteCall, seconds, sourcesXml, takeJson, unitText } from "../src/tv";

function edid(name: string, audio: boolean): Uint8Array {
  const data = new Uint8Array(256);
  data.set([0, 0, 0, 0xfc, 0], 54 + 36);
  data.set([...(name + "\n").padEnd(13, " ")].map((ch) => ch.charCodeAt(0)), 54 + 36 + 5);
  data[128] = 2;
  data[131] = audio ? 0x40 : 0;
  return data;
}

test("a screen is read from what the system says about its connector", () => {
  expect(monitorName(edid("DELL U2415", true))).toBe("DELL U2415");
  expect(monitorAudio(edid("X", true))).toBe(true);
  expect(monitorAudio(edid("X", false))).toBe(false);
  expect(monitorName(new Uint8Array(0))).toBe("");
  expect(readDisplay("card0-HDMI-A-1", "connected\n", "1920x1080\n1280x720\n", edid("TV", true))).toEqual({ name: "HDMI-A-1", connected: true, mode: "1920x1080", monitor: "TV", audio: true });
  expect(readDisplay("card0-DP-1", "disconnected\n", "", new Uint8Array(0)).connected).toBe(false);
});

test("the folders become Kodi's places, with names that cannot break the file", () => {
  const text = sourcesXml(["/DATA/Media/Films", "/mnt/disk/Tom & <Jerry>/"]);
  expect(text.startsWith("<!-- Written by Hata")).toBe(true);
  expect(text).toContain('<name>Films</name><path pathversion="1">/DATA/Media/Films/</path>');
  expect(text).toContain("<name>Tom &amp; &lt;Jerry&gt;</name>");
  expect(text.match(/<source>/g)?.length).toBe(6);
  expect(isOurs(text)).toBe(true);
  expect(isOurs("")).toBe(true);
  expect(isOurs("<sources></sources>")).toBe(false);
  expect(cleanFolders(["/a/", "/a", "relative", 5, "/b"])).toEqual(["/a", "/b"]);
});

test("Kodi's control port is Hata's, or the one a hand-made file names", () => {
  expect(portIn(advancedXml(9391))).toBe(9391);
  expect(portIn("<advancedsettings><jsonrpc><tcpport> 9099 </tcpport></jsonrpc></advancedsettings>")).toBe(9099);
  expect(portIn("<advancedsettings></advancedsettings>")).toBeNull();
});

test("the service runs Kodi as its own user on a console of its own", () => {
  const unit = unitText();
  expect(unit).toContain("User=hata-tv");
  expect(unit).toContain("TTYPath=/dev/tty7");
  expect(unit).toContain("PAMName=login");
  expect(unit).toContain("--windowing=gbm");
  expect(unit).not.toContain("User=root");
});

test("the driver for decoding goes by who made the card", () => {
  expect(decodePackages("0x8086")).toContain("intel-media-va-driver");
  expect(decodePackages("0x1002")).toEqual(["mesa-va-drivers"]);
  expect(decodePackages("")).toEqual([]);
});

test("answers that arrive glued together or cut are told apart", () => {
  const first = takeJson('{"id":1,"result":"pong"}{"jsonrpc":"2.0","method":"Player.OnPlay","params":{"data":{"t":"a}b"}}}{"id":2,"res');
  expect(first.values).toEqual([{ id: 1, result: "pong" }, { jsonrpc: "2.0", method: "Player.OnPlay", params: { data: { t: "a}b" } } }]);
  expect(first.rest).toBe('{"id":2,"res');
  expect(takeJson(first.rest + 'ult":[1,2]}').values).toEqual([{ id: 2, result: [1, 2] }]);
});

test("the remote's buttons are Kodi's calls, and only those", () => {
  expect(remoteCall("up", undefined, null)).toEqual({ method: "Input.Up" });
  expect(remoteCall("playpause", undefined, null)).toBeNull();
  expect(remoteCall("playpause", undefined, 1)).toEqual({ method: "Player.PlayPause", params: { playerid: 1 } });
  expect(remoteCall("rewind", undefined, 1)).toEqual({ method: "Player.Seek", params: { playerid: 1, value: { seconds: -30 } } });
  expect(remoteCall("seek", 250, 1)).toEqual({ method: "Player.Seek", params: { playerid: 1, value: { percentage: 100 } } });
  expect(remoteCall("volume", "37.6", null)).toEqual({ method: "Application.SetVolume", params: { volume: 38 } });
  expect(remoteCall("volume", "loud", null)).toBeNull();
  expect(remoteCall("System.Shutdown", undefined, 1)).toBeNull();
  expect(seconds({ hours: 1, minutes: 2, seconds: 3, milliseconds: 400 })).toBe(3723);
});

test("what can be sent to the screen is told by the file's name", () => {
  expect(playable("Film (2020).MKV")).toBe(true);
  expect(playable("song.flac")).toBe(true);
  expect(playable("photo.jpeg")).toBe(true);
  expect(playable("notes.txt")).toBe(false);
  expect(playable("archive.zip")).toBe(false);
});

test("the buttons of Android remotes are read as the keys the player knows", () => {
  const text = hwdbText();
  expect(text).toContain("evdev:input:b*\n KEYBOARD_KEY_c0041=enter\n KEYBOARD_KEY_c0040=compose\n");
  // a remote's power button must never reach the system as the server's own
  expect(text).toContain("evdev:input:b0003*\n KEYBOARD_KEY_c0030=reserved");
  expect(text).toContain("evdev:input:b0005*\n KEYBOARD_KEY_c0030=reserved");
  expect(text.startsWith("# Written by Hata")).toBe(true);
});

test("the player cannot be left or the server powered off from the sofa", () => {
  expect(advancedXml(9391)).toContain("<showexitbutton>false</showexitbutton>");
  expect(keymapXml()).toContain('<Home><keyboard><end mod="ctrl">noop</end></keyboard></Home>');
  expect(keymapXml()).toContain("<power>noop</power>");
  expect(polkitRule()).toContain('subject.user == "hata-tv"');
  expect(polkitRule()).toContain("polkit.Result.NO");
});

test("a file's name is said as the film's name", () => {
  expect(shortTitle("Coyote.vs.Acme.(2026).WEB-DL.1080p.2xUkr.Eng.mkv")).toBe("Coyote vs Acme");
  expect(shortTitle("Spider-Man Brand New Day (2026) iMAX WEB-DLRip 1080p_grab777.mkv")).toBe("Spider-Man Brand New Day");
  expect(shortTitle("The.Show.S02E07.1080p.WEB.h264.mkv")).toBe("The Show S02E07");
  expect(shortTitle("[Group] Some_Anime_-_12_[720p].mkv")).toBe("Some Anime - 12");
  expect(shortTitle("Тестовий фільм.mp4")).toBe("Тестовий фільм");
  expect(shortTitle("2001.A.Space.Odyssey.1968.BDRip.mkv")).toBe("2001 A Space Odyssey");
  expect(shortTitle("Dune: Part Two")).toBe("Dune: Part Two");
  expect(shortTitle("song.flac")).toBe("song");
});

test("the picture's choices are read from Kodi's own settings", () => {
  const list = [
    { id: "videoscreen.resolution", value: 18, options: [{ label: "640x480p ", value: 38 }, { label: "1280x720p ", value: 29 }, { label: "1920x1080p ", value: 18 }, { label: "1920x1080i ", value: 20 }, { label: "odd", value: 1 }] },
    { id: "videoscreen.screenmode", value: "DESKTOP", options: [{ label: "50.00", value: "0192001080050.00000pstd" }, { label: "59.94", value: "0192001080059.94006pstd" }, { label: "60.00", value: "DESKTOP" }] },
  ];
  const picture = pictureOf(list, 0)!;
  expect(picture.resolution.value).toBe(18);
  expect(picture.resolution.options.map((o) => o.label)).toEqual(["1920×1080", "1920×1080i", "1280×720", "640×480"]);
  expect(picture.rate).toEqual({ value: "DESKTOP", options: [{ label: "60", value: "DESKTOP" }, { label: "59.94", value: "0192001080059.94006pstd" }, { label: "50", value: "0192001080050.00000pstd" }] });
  expect(picture.match).toBe(false);
  expect(pictureOf(list, 2)!.match).toBe(true);
  // a rate chosen once is kept by the mode's full name, which the list may spell as the screen's own
  list[1]!.value = "0192001080060.00000pstd";
  expect(pictureOf(list, 0)!.rate.value).toBe("DESKTOP");
  list[1]!.value = "0192001080050.00000pstd";
  expect(pictureOf(list, 0)!.rate.value).toBe("0192001080050.00000pstd");
  expect(pictureOf([], 0)).toBeNull();
  expect(pictureOf(null, 0)).toBeNull();
});

test("a button of Kodi's window is pressed by a packet of its event port", () => {
  const packet = clickPacket(KEEP_WINDOW, KEEP_YES);
  expect(new TextDecoder().decode(packet.subarray(0, 4))).toBe("XBMC");
  expect([...packet.subarray(4, 8)]).toEqual([2, 0, 0, 0x0a]);
  const size = (packet[16]! << 8) | packet[17]!;
  expect(packet.length).toBe(32 + size);
  expect(packet[32]).toBe(1);
  expect(new TextDecoder().decode(packet.subarray(33, -1))).toBe("SendClick(10100,11)");
  expect(packet.at(-1)).toBe(0);
  const hello = helloPacket();
  expect([...hello.subarray(6, 8)]).toEqual([0, 1]);
  expect(new TextDecoder().decode(hello.subarray(32, 36))).toBe("Hata");
});
