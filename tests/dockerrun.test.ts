import { expect, test } from "bun:test";
import { applyEdit, blankCompose } from "../src/appedit";
import { parseDockerRun, shellWords, type RunImport } from "../src/dockerrun";

test("a command line split the way a shell splits it", () => {
  expect(shellWords(`docker run -e "A=two words" -e 'B=it''s' \\\n  -e C=a\\ b -e D="say \\"hi\\"" -e E="" img`)).toEqual(["docker", "run", "-e", "A=two words", "-e", "B=its", "-e", "C=a b", "-e", 'D=say "hi"', "-e", "E=", "img"]);
});

test("a docker run from a README becomes the form", () => {
  const run = parseDockerRun(`sudo docker run -d \\
    --name=Jellyfin \\
    -p 8096:8096 -p 127.0.0.1:8920:8920 -p 7359:7359/udp --publish 1900/udp \\
    -v /srv/jellyfin/config:/config -v media:/media:ro \\
    -e PUID=1000 -e "JELLYFIN_PublishedServerUrl=http://example.com" \\
    --device /dev/dri/renderD128:/dev/dri/renderD128 --device=/dev/dri/card0 \\
    --restart unless-stopped --net=host --privileged --cap-add=cap_sys_nice \\
    -h jelly -m 2g --cpu-shares 512 \\
    jellyfin/jellyfin:latest --nowebclient "--log dir"`) as RunImport;
  expect(run.name).toBe("jellyfin");
  expect(run.ignored).toEqual([]);
  expect(run.edit.web).toEqual({ scheme: "http", host: "", port: "8096", path: "/" });
  expect(run.edit.services).toEqual([
    {
      name: "jellyfin",
      image: "jellyfin/jellyfin:latest",
      network: "host",
      ports: [
        { host: "8096", container: "8096", protocol: "tcp" },
        { host: "8920", container: "8920", protocol: "tcp" },
        { host: "7359", container: "7359", protocol: "udp" },
        { host: "", container: "1900", protocol: "udp" },
      ],
      volumes: [{ host: "/srv/jellyfin/config", container: "/config" }, { host: "media", container: "/media" }],
      envs: [{ name: "PUID", value: "1000" }, { name: "JELLYFIN_PublishedServerUrl", value: "http://example.com" }],
      devices: [{ host: "/dev/dri/renderD128", container: "/dev/dri/renderD128" }, { host: "/dev/dri/card0", container: "/dev/dri/card0" }],
      command: ["--nowebclient", "--log dir"],
      privileged: true,
      memory: 2048,
      cpuShares: 512,
      restart: "unless-stopped",
      capAdd: ["SYS_NICE"],
      hostname: "jelly",
    },
  ]);
});

test("short options written together; what has no field is named, not lost", () => {
  const run = parseDockerRun("docker run -itdp 8080:80 --rm --label a=b -u 1000:1000 --read-only -p 8000-8010:8000-8010 -e HOME --pull always ghcr.io/Some_Org/My.App:1.2@sha256:abc") as RunImport;
  expect(run.name).toBe("my-app");
  expect(run.edit.services[0]).toMatchObject({ image: "ghcr.io/Some_Org/My.App:1.2@sha256:abc", ports: [{ host: "8080", container: "80", protocol: "tcp" }], restart: "unless-stopped", command: [] });
  expect(run.ignored).toEqual(["--label a=b", "-u 1000:1000", "--read-only", "-p 8000-8010:8000-8010", "-e HOME", "--pull always"]);
});

test("what is read goes through the form into a compose file", () => {
  const run = parseDockerRun("docker run -d --name whoami -p 8088:80 -e NAME=x traefik/whoami --verbose") as RunImport;
  const compose = blankCompose(run.name);
  expect(applyEdit(compose, run.edit, "en")).toBeNull();
  expect(compose).toEqual({ name: "whoami", services: { whoami: { image: "traefik/whoami", restart: "unless-stopped", ports: ["8088:80"], environment: { NAME: "x" }, command: ["--verbose"] } }, "x-casaos": { port_map: "8088" } });
});

test("not a docker run", () => {
  expect(parseDockerRun("docker compose up -d")).toBe("run.notRun");
  expect(parseDockerRun("rm -rf /")).toBe("run.notRun");
  expect(parseDockerRun("docker run -d -p 80:80")).toBe("run.noImage");
  expect(parseDockerRun(5)).toBe("run.notRun");
});
