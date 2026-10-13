import { expect, test } from "bun:test";
import { versionOf } from "../src/tools";

test("versionOf: the version in what a program prints about itself", () => {
  expect(versionOf("Docker version 29.9.0, build abc123")).toBe("29.9.0");
  expect(versionOf("nmcli tool, version 1.52.1")).toBe("1.52.1");
  expect(versionOf("Version 4.22.4-Debian-4.22.4+dfsg-1")).toBe("4.22.4-Debian-4.22.4+dfsg-1");
  expect(versionOf("smartctl 7.4 2023-08-01 r5530 [x86_64-linux-6.12] (local build)")).toBe("7.4");
  expect(versionOf("wpa_supplicant v2.10\nCopyright (c) 2003-2022")).toBe("2.10");
  expect(versionOf("mergerfs v2.40.2")).toBe("2.40.2");
  expect(versionOf("OpenSSH_10.0p2 Debian-7, OpenSSL 3.5.1 1 Jul 2025")).toBe("10.0p2");
  expect(versionOf("snapraid vnone by Andrea Mazzoleni, http://www.snapraid.it")).toBe("");
  expect(versionOf("")).toBe("");
});
