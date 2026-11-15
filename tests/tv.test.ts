import { expect, test } from "bun:test";
import { advancedXml, cleanFolders, hwdbText, keymapXml, polkitRule, decodePackages, isOurs, monitorAudio, monitorName, playable, portIn, readDisplay, remoteCall, seconds, sourcesXml, takeJson, unitText } from "../src/tv";

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
