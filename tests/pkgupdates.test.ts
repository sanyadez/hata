import { expect, test } from "bun:test";
import { parseAptSimulation, parseDnfCheck } from "../src/pkgupdates";

test("parseAptSimulation: what apt-get -s upgrade would install", () => {
  const out = `Reading package lists...
Building dependency tree...
Calculating upgrade...
The following packages will be upgraded:
  libc6 docker-ce
Inst libc6 [2.41-12] (2.41-12+deb13u1 Debian:13.2/stable, Debian-Security:13/stable-security [amd64]) []
Inst docker-ce [5:28.5.1-1~debian.13~trixie] (5:28.5.2-1~debian.13~trixie Docker CE:trixie [amd64])
Inst linux-image-6.12.57+deb13-amd64 (6.12.57-1 Debian:13.2/stable [amd64])
Conf libc6 (2.41-12+deb13u1 Debian:13.2/stable, Debian-Security:13/stable-security [amd64])
Conf docker-ce (5:28.5.2-1~debian.13~trixie Docker CE:trixie [amd64])`;
  expect(parseAptSimulation(out)).toEqual([
    { name: "libc6", from: "2.41-12", to: "2.41-12+deb13u1", security: true },
    { name: "docker-ce", from: "5:28.5.1-1~debian.13~trixie", to: "5:28.5.2-1~debian.13~trixie", security: false },
    { name: "linux-image-6.12.57+deb13-amd64", from: "", to: "6.12.57-1", security: false },
  ]);
  expect(parseAptSimulation("0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.")).toEqual([]);
});

test("parseDnfCheck: what dnf check-update lists", () => {
  const out = `
bash.x86_64                     5.2.26-3.fc40                 updates
kernel-core.x86_64              6.11.4-201.fc40               updates

Obsoleting Packages
grub2-tools.x86_64              1:2.06-123.fc40               updates
`;
  expect(parseDnfCheck(out)).toEqual([
    { name: "bash", from: "", to: "5.2.26-3.fc40", security: false },
    { name: "kernel-core", from: "", to: "6.11.4-201.fc40", security: false },
  ]);
});
