import { expect, test } from "bun:test";
import { cleanShares, hasInclude, HATA_CONF, nameFor, parseUsers, shareName, smbConf, withInclude, withoutInclude, writablePath } from "../src/smbconf";

test("shareName: letters of any alphabet, digits, spaces; nothing Samba reads as its own", () => {
  expect(shareName("  Media  ")).toBe("Media");
  expect(shareName("Фото   2026")).toBe("Фото 2026");
  expect(shareName("my.files-1_a")).toBe("my.files-1_a");
  for (const bad of ["", " ", "a/b", "a\\b", "[x]", "50%", "hidden$", "name.", ".hidden", "global", "Homes", "IPC$", "x".repeat(41), 5, null]) expect(shareName(bad)).toBeNull();
});

test("nameFor: the folder's own name, tidied, and never one that is taken", () => {
  expect(nameFor("/DATA/Media", [])).toBe("Media");
  expect(nameFor("/DATA/Media", ["media"])).toBe("Media 2");
  expect(nameFor("/DATA/Media", ["Media", "Media 2"])).toBe("Media 3");
  expect(nameFor("/DATA/.cache [old]%", [])).toBe("cache old");
  expect(nameFor("/mnt/Фото", [])).toBe("Фото");
  expect(nameFor("/mnt/$$$", [])).toBe("Shared");
  expect(nameFor("/mnt/global", [])).toBe("Shared");
  expect(shareName(nameFor("/mnt/" + "long name ".repeat(9), ["x"]))).not.toBeNull();
});

test("writablePath: what would change the meaning of Samba's file is refused", () => {
  expect(writablePath("/DATA/My Films (2026)")).toBe(true);
  for (const bad of ["DATA", "/DATA/%U", "/DATA/a\\", "/DATA/a\nguest ok = yes", "/DATA/a "]) expect(writablePath(bad)).toBe(false);
});

test("cleanShares: what is not a share is dropped, names and folders are unique", () => {
  expect(
    cleanShares([
      { name: "Media", path: "/DATA/Media", guest: true },
      { name: "media", path: "/DATA/Other" },
      { name: "Again", path: "/DATA/Media" },
      { name: "bad/name", path: "/DATA/x" },
      { name: "Docs", path: "/DATA/%U" },
      { name: "Docs", path: "/DATA/Docs", readOnly: true, extra: 1 },
      null,
      "x",
    ]),
  ).toEqual([
    { name: "Media", path: "/DATA/Media", guest: true, readOnly: false },
    { name: "Docs", path: "/DATA/Docs", guest: false, readOnly: true },
  ]);
  expect(cleanShares(undefined)).toEqual([]);
});

test("smbConf: a share with a password, a share for everyone", () => {
  const conf = smbConf([
    { name: "Media", path: "/DATA/Media", guest: false, readOnly: false },
    { name: "Films for all", path: "/DATA/My Films", guest: true, readOnly: true },
  ]);
  expect(conf).toBe(`# Written by Hata: the folders shared over the network.
# Changes made here by hand are overwritten; shares of your own belong in smb.conf.

[global]
   map to guest = Bad User

[Media]
   path = /DATA/Media
   browseable = yes
   read only = no
   guest ok = no
   valid users = hata
   force user = root
   inherit owner = yes
   inherit permissions = yes
   map archive = no

[Films for all]
   path = /DATA/My Films
   browseable = yes
   read only = yes
   guest ok = yes
   force user = root
   inherit owner = yes
   inherit permissions = yes
   map archive = no
`);
  // Samba's own settings are touched only for the sake of a share without a password
  expect(smbConf([{ name: "Media", path: "/DATA/Media", guest: false, readOnly: false }])).not.toContain("[global]");
  expect(smbConf([])).not.toContain("[");
});

test("withInclude / withoutInclude: one line at the end of Samba's file, taken out without a trace", () => {
  const theirs = "[global]\n   workgroup = HOME\n\n[printers]\n   path = /var/tmp\n";
  const ours = withInclude(theirs);
  expect(ours).toBe(`${theirs}\n# The folders shared from Hata\ninclude = ${HATA_CONF}\n`);
  expect(hasInclude(theirs)).toBe(false);
  expect(hasInclude(ours)).toBe(true);
  expect(withInclude(ours)).toBe(ours);
  expect(withoutInclude(ours)).toBe(theirs);
  expect(withoutInclude(theirs)).toBe(theirs);
  // written by hand with other spacing, it is still the same line
  expect(hasInclude(`[global]\n\tinclude  =  ${HATA_CONF}\n`)).toBe(true);
  // no smb.conf at all (Arch): the least Samba starts with
  expect(withInclude(null)).toStartWith("[global]\n");
  expect(hasInclude(withInclude(null))).toBe(true);
});

test("parseUsers: the names of pdbedit -L", () => {
  expect(parseUsers("hata:999:\noleksandr:1000:Oleksandr\n")).toEqual(["hata", "oleksandr"]);
  expect(parseUsers("")).toEqual([]);
});
