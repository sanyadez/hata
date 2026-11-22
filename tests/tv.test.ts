import { expect, test } from "bun:test";
import { cleanOffset, browserCalls, browserSound, browserUnitText, browserHomeHtml, cleanShowTime, pointerCalls, cleanBookmarks, mediaScript } from "../src/tv";
import { cleanLink, isLink, linkName, probeArgs, sourceArgs, streamZero, cleanStart, keyframeArgs, mediaOf, prefsOf, prefValue, streamArgs, subsArgs, tracksOf, clickPacket, helloPacket, KEEP_WINDOW, KEEP_YES, pictureOf, advancedXml, cleanFolders, shortTitle, hwdbText, keymapXml, polkitRule, decodePackages, isOurs, monitorAudio, monitorName, playable, portIn, readDisplay, remoteCall, seconds, sourcesXml, takeJson, unitText } from "../src/tv";

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

test("the tracks of what plays, and the calls that choose them", () => {
  const props = {
    audiostreams: [{ index: 0, language: "ukr", name: "DUB", codec: "ac3", channels: 6 }, { index: 1, language: "eng", name: "Original", codec: "eac3", channels: 6 }, { nothing: 1 }],
    currentaudiostream: { index: 1, language: "eng", name: "Original" },
    subtitles: [{ index: 0, language: "ukr", name: "Forced" }, { index: 1, language: "eng", name: "Full" }],
    currentsubtitle: { index: 1, language: "eng", name: "Full" },
    subtitleenabled: true,
  };
  const tracks = tracksOf(props);
  expect(tracks.audio).toEqual([{ index: 0, language: "ukr", name: "DUB", codec: "ac3", channels: 6 }, { index: 1, language: "eng", name: "Original", codec: "eac3", channels: 6 }]);
  expect(tracks.audioNow).toBe(1);
  expect(tracks.subNow).toBe(1);
  expect(tracksOf({ ...props, subtitleenabled: false }).subNow).toBe(-1);
  expect(tracksOf(null)).toEqual({ audio: [], audioNow: -1, subs: [], subNow: -1 });
  expect(remoteCall("audio", 1, 0)).toEqual({ method: "Player.SetAudioStream", params: { playerid: 0, stream: 1 } });
  expect(remoteCall("audio", "1", 0)).toBeNull();
  expect(remoteCall("audio", 1, null)).toBeNull();
  expect(remoteCall("subtitle", "off", 1)).toEqual({ method: "Player.SetSubtitle", params: { playerid: 1, subtitle: "off" } });
  expect(remoteCall("subtitle", 2, 1)).toEqual({ method: "Player.SetSubtitle", params: { playerid: 1, subtitle: 2, enable: true } });
  expect(remoteCall("text", "Людина-павук", null)).toEqual({ method: "Input.SendText", params: { text: "Людина-павук", done: true } });
  expect(remoteCall("text", "", null)).toBeNull();
  expect(remoteCall("text", "a\nb", null)).toBeNull();
});

test("Kodi's settings the page shows, and only its values go back", () => {
  const prefs = prefsOf([
    { id: "locale.audiolanguage", value: "mediadefault", options: [{ label: "Media default", value: "mediadefault" }, { label: "Ukrainian", value: "Ukrainian" }] },
    { id: "audiooutput.passthrough", value: false },
    { id: "audiooutput.guisoundmode", value: 1, options: [{ label: "Never", value: 0 }] },
    { id: "screensaver.time", value: 3 },
    { id: "services.webserver", value: true },
  ]);
  expect(Object.keys(prefs)).toEqual(["locale.audiolanguage", "audiooutput.passthrough", "audiooutput.guisoundmode", "screensaver.time"]);
  expect(prefs["audiooutput.guisoundmode"]).toEqual({ value: true });
  expect(prefs["screensaver.time"]).toEqual({ value: 3 });
  expect(prefValue("locale.audiolanguage", "Ukrainian", prefs)).toBe("Ukrainian");
  expect(prefValue("locale.audiolanguage", "Klingon", prefs)).toBeUndefined();
  expect(prefValue("audiooutput.passthrough", true, prefs)).toBe(true);
  expect(prefValue("audiooutput.guisoundmode", false, prefs)).toBe(0);
  expect(prefValue("audiooutput.guisoundmode", 1, prefs)).toBeUndefined();
  expect(prefValue("screensaver.time", 10, prefs)).toBe(10);
  expect(prefValue("screensaver.time", 7, prefs)).toBeUndefined();
  expect(prefValue("services.webserver", true, prefs)).toBeUndefined();
  expect(prefValue("screensaver.mode", "", prefs)).toBeUndefined();
});

test("a file read for the browser's player, and the programs' arguments", () => {
  const media = mediaOf({
    format: { duration: "8700.5" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1012 },
      { codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
      { codec_type: "audio", codec_name: "ac3", channels: 6, tags: { language: "ukr", title: "DUB" } },
      { codec_type: "audio", codec_name: "aac", channels: 2, tags: { LANGUAGE: "eng" } },
      { codec_type: "subtitle", codec_name: "subrip", tags: { language: "ukr", title: "Full" } },
      { codec_type: "subtitle", codec_name: "hdmv_pgs_subtitle", tags: { language: "eng" } },
    ],
  });
  expect(media.duration).toBe(8700.5);
  expect(media.video).toEqual({ codec: "h264", width: 1920, height: 1012, n: 0 });
  expect(media.audio).toEqual([{ index: 0, language: "ukr", name: "DUB", codec: "ac3", channels: 6 }, { index: 1, language: "eng", name: "", codec: "aac", channels: 2 }]);
  expect(media.subs.map((one) => [one.index, one.text])).toEqual([[0, true], [1, false]]);
  expect(mediaOf(null)).toEqual({ duration: 0, video: null, audio: [], subs: [] });
  // asked a little past the keyframe so that ffmpeg lands on it; the sound padded back to a quarter second before it
  expect(streamArgs("/a b/-x.mkv", "12.5", 1).join(" ")).toContain("-ss 12.640 -i /a b/-x.mkv -map 0:v:0 -map 0:a:1? -c:v copy");
  expect(streamArgs("/f.mkv", "12.5", 0).join(" ")).toContain("first_pts=-18720");
  expect(streamArgs("/f.mkv", "0", 0).join(" ")).toContain("-nostdin -i /f.mkv");
  expect(streamArgs("/f.mkv", "0", 0).join(" ")).toContain("first_pts=-12000");
  expect(subsArgs("/f.mkv", "0", 2).slice(4)).toEqual(["-copyts", "-i", "/f.mkv", "-map", "0:s:2", "-f", "webvtt", "pipe:1"]);
  expect(subsArgs("/f.mkv", "12.5", 2).slice(4, 7)).toEqual(["-ss", "7.500", "-copyts"]);
  expect(streamZero("12.5")).toBeCloseTo(12.5 - 0.25 - 0.021333, 5);
  expect(keyframeArgs("/f.mkv", 61.25)).toContain("61.250%+#1");
  expect(cleanStart("1234.567")).toBe("1234.567");
  expect(cleanStart("-1")).toBeNull();
  expect(cleanStart("1e5")).toBeNull();
  expect(cleanStart(5)).toBeNull();
});

test("an address instead of a file: what is let through, how it is named, how the programs open it", () => {
  expect(cleanLink(" https://example.com/a/film.m3u8?key=1 ")).toBe("https://example.com/a/film.m3u8?key=1");
  expect(cleanLink("http://192.168.1.5:8080/live")).toBe("http://192.168.1.5:8080/live");
  for (const bad of ["", "/etc/passwd", "file:///etc/passwd", "ftp://example.com/a.mp4", "concat:a|b", "-i", "https://", "https://exa mple.com/a", "https://example.com/a\nb", "javascript:alert(1)", 5, null, "https://example.com/" + "a".repeat(2000)]) expect(cleanLink(bad)).toBeNull();
  expect(isLink("HTTPS://example.com/a")).toBe(true);
  expect(isLink("/DATA/a.mkv")).toBe(false);
  // neither a sign-in nor a key goes into the log or a title
  expect(linkName("https://user:secret@example.com/video/My%20Film.m3u8?token=abc#x")).toBe("example.com/video/My Film.m3u8");
  expect(linkName("https://example.com/")).toBe("example.com");
  expect(linkName("nothing")).toBe("");
  // a playlist from the network may name a file of this server: only the web's protocols are opened
  expect(sourceArgs("https://example.com/a.m3u8")).toEqual(["-protocol_whitelist", "http,https,tcp,tls,crypto", "-rw_timeout", "20000000", "-i", "https://example.com/a.m3u8"]);
  expect(sourceArgs("/DATA/a.mkv")).toEqual(["-i", "/DATA/a.mkv"]);
  expect(probeArgs("https://example.com/a.m3u8").join(" ")).toContain("-show_programs -protocol_whitelist http,https,tcp,tls,crypto");
  expect(streamArgs("https://example.com/a.m3u8", "0", 2, 1).join(" ")).toContain("-i https://example.com/a.m3u8 -map 0:v:1 -map 0:a:2? -c:v copy");
  expect(subsArgs("https://example.com/a.vtt", "0", 0).join(" ")).toContain("-protocol_whitelist http,https,tcp,tls,crypto");
  expect(keyframeArgs("/f.mkv", 5, 2)).toContain("v:2");
});

test("a film that comes in several sizes: the largest picture and the sound that goes with it", () => {
  const stream = (index: number, type: string, more: Record<string, unknown> = {}) => ({ index, codec_type: type, codec_name: type === "video" ? "h264" : "aac", ...more });
  const streams = [stream(0, "video", { width: 854, height: 480 }), stream(1, "audio", { channels: 2 }), stream(2, "video", { width: 1920, height: 1080 }), stream(3, "audio", { channels: 2 }), stream(4, "video", { width: 1280, height: 720 }), stream(5, "audio", { channels: 2 })];
  const media = mediaOf({ format: { duration: "100" }, streams, programs: [{ streams: [streams[0], streams[1]] }, { streams: [streams[2], streams[3]] }, { streams: [streams[4], streams[5]] }] });
  expect(media.video).toEqual({ codec: "h264", width: 1920, height: 1080, n: 1 });
  expect(media.audio.map((one) => one.index)).toEqual([1]);
  // one program, or none: every sound is offered, counted as the programs count it
  expect(mediaOf({ streams, programs: [{ streams }] }).audio.map((one) => one.index)).toEqual([0, 1, 2]);
  // a cover picture in front of the film is not the film
  expect(mediaOf({ streams: [{ codec_type: "video", codec_name: "mjpeg", width: 3000, height: 3000, disposition: { attached_pic: 1 } }, stream(1, "video", { width: 640, height: 360 })] }).video?.n).toBe(1);
});

test("the sound offset: steps of 25 ms, two seconds either way", () => {
  expect(cleanOffset(-160)).toBe(-0.15);
  expect(cleanOffset(0)).toBe(0);
  expect(cleanOffset(2000)).toBe(2);
  expect(cleanOffset(2500)).toBeNull();
  expect(cleanOffset("100")).toBeNull();
});

test("the browser on the screen: its sound, its service, what a page may ask of it", () => {
  // Kodi's name of an output is ALSA's own between "ALSA:" and the bar
  expect(browserSound("ALSA:hdmi:CARD=HDMI,DEV=0|HDA Intel")).toBe("hdmi:CARD=HDMI,DEV=0");
  expect(browserSound("ALSA:bluealsa|Bluetooth Audio")).toBe("bluealsa");
  expect(browserSound("ALSA:default")).toBe("");
  expect(browserSound("PIPEWIRE:x")).toBe("");
  // nothing that would be read as another word of the service's command line
  expect(browserSound("ALSA:hdmi; rm -rf /|x")).toBe("");
  expect(browserSound("ALSA:a b")).toBe("");
  const unit = browserUnitText("hdmi:CARD=HDMI,DEV=0");
  // it and the player never have the screen together, and the one that leaves stops first
  expect(unit).toContain("Conflicts=getty@tty7.service hata-tv.service");
  expect(unit).toMatch(/^After=.* hata-tv\.service$/m);
  expect(unit).toContain("ExecStart=/usr/bin/cage -- /usr/bin/chromium --kiosk");
  expect(unit).toContain("--alsa-output-device=hdmi:CARD=HDMI,DEV=0 file:///var/lib/hata-tv/screen.html");
  // the console is not shown between the player and the browser: neither service switches to it when it stops
  expect(unit).not.toContain("chvt 1");
  expect(unitText()).not.toContain("chvt 1");
  expect(browserHomeHtml("uk", "a<b", 'x"y')).toContain("a&lt;b");
  expect(browserHomeHtml("uk", "a", 'x"y')).toContain("x&quot;y");
  expect(unit).toContain("--remote-debugging-port=9393");
  // never started with the server: after a restart the screen is the player's
  expect(unit).not.toContain("[Install]");
  expect(browserUnitText("")).not.toContain("alsa-output-device");
  expect(cleanShowTime(undefined)).toBe(0);
  expect(cleanShowTime(0)).toBe(0);
  expect(cleanShowTime(30)).toBe(30);
  expect(cleanShowTime(4)).toBeNull();
  expect(cleanShowTime(1.5)).toBeNull();
  expect(cleanShowTime("30")).toBeNull();
  expect(cleanShowTime(86401)).toBeNull();
  expect(browserCalls("reload", undefined)).toEqual([{ method: "Page.reload" }]);
  expect(browserCalls("text", "привіт")).toEqual([{ method: "Input.insertText", params: { text: "привіт" } }]);
  expect(browserCalls("text", "")).toBeNull();
  expect(browserCalls("text", "a\x00b")).toBeNull();
  // a page of Hata's cannot make the browser run a script of its choosing
  expect(browserCalls("Runtime.evaluate", "alert(1)")).toBeNull();
  expect(browserCalls("navigate", "file:///etc/passwd")).toBeNull();
});

test("a press on the picture of the screen lands at that place of the page", () => {
  const size = { width: 1920, height: 1080 };
  const calls = pointerCalls("click", { x: 0.5, y: 0.25 }, size)!;
  expect(calls.map((c) => c.params!.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
  expect(calls[1]!.params).toMatchObject({ x: 960, y: 270, button: "left" });
  expect(pointerCalls("wheel", { x: 0.1, y: 0.9, dy: -300 }, size)).toEqual([{ method: "Input.dispatchMouseEvent", params: { type: "mouseWheel", x: 192, y: 972, deltaX: 0, deltaY: -300 } }]);
  // outside the picture, without a place, a page not known yet
  expect(pointerCalls("click", { x: 1.2, y: 0 }, size)).toBeNull();
  expect(pointerCalls("click", null, size)).toBeNull();
  expect(pointerCalls("click", { x: 0.5, y: 0.5 }, { width: 0, height: 0 })).toBeNull();
  expect(pointerCalls("wheel", { x: 0.5, y: 0.5, dy: "x" }, size)).toBeNull();
  expect(pointerCalls("drag", { x: 0.5, y: 0.5 }, size)).toBeNull();
});

test("bookmarks of the screen and the script that drives a page's video", () => {
  expect(cleanBookmarks([{ name: " Films\n here ", url: "https://a.example/x" }, { url: "https://a.example/x" }, { name: "", url: "http://b.example" }, { name: "bad", url: "javascript:alert(1)" }, null, 5])).toEqual([
    { name: "Films here", url: "https://a.example/x" },
    { name: "b.example", url: "http://b.example/" },
  ]);
  expect(cleanBookmarks("x")).toEqual([]);
  // on the screen's own page a name cannot become markup
  expect(browserHomeHtml("en", "hata", "", [{ name: "<b>x", url: "https://a.example/?a=1&b=2" }])).toContain('<a href="https://a.example/?a=1&amp;b=2">&lt;b&gt;x<span>');
  // what comes from a request goes into the script only as a number
  expect(mediaScript("skip", 30)).toContain("v.currentTime + 30)");
  expect(mediaScript("skip", "1); alert(1")).toContain("v.currentTime + 0)");
  expect(mediaScript("seek", 50)).toContain("v.duration * 0.5");
  expect(mediaScript("volume", 400)).toContain("v.volume = v.volume");
  expect(mediaScript("nonsense")).toContain("try {  } catch");
  // the script is one expression that runs
  expect(() => new Function("document", "return " + mediaScript("play"))({ querySelectorAll: () => [] })).not.toThrow();
});
