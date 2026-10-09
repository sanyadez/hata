import { expect, test } from "bun:test";
import { dumpCompose, parseCompose } from "../src/appform";
import type { ContainerInspect, ContainerSummary } from "../src/docker";
import { composeFromContainers, foreign, freeName, safeName, serviceFromContainer } from "../src/import";

const ID = "3f2a9c1d5e7b" + "0".repeat(52);

const container = (over: Partial<ContainerInspect> = {}, host: Record<string, unknown> = {}): ContainerInspect => ({
  Id: ID,
  Name: "/qbittorrent",
  Image: "sha256:abc",
  State: { Running: true },
  Config: { Image: "linuxserver/qbittorrent:5.0", Hostname: "3f2a9c1d5e7b", Env: ["PATH=/usr/bin", "TZ=Europe/Kyiv", "PASSWORD=pa$$word"], Cmd: ["/init"], Labels: { maintainer: "ls" } },
  HostConfig: { NetworkMode: "bridge", RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 }, PortBindings: {}, ...host },
  Mounts: [],
  NetworkSettings: { Networks: { bridge: {} } },
  ...over,
});
const image: ContainerInspect["Config"] = { Image: "", Env: ["PATH=/usr/bin"], Cmd: ["/init"], Labels: { maintainer: "ls" } };

test("what the container only inherited from its image stays out of the file", () => {
  const { service } = serviceFromContainer(container(), image);
  expect(service).toEqual({
    image: "linuxserver/qbittorrent:5.0",
    container_name: "qbittorrent",
    restart: "unless-stopped",
    // a literal dollar must not start a compose variable
    environment: { TZ: "Europe/Kyiv", PASSWORD: "pa$$$$word" },
    network_mode: "bridge",
  });
  // without the image nothing can be told apart, so everything is written down
  const blind = serviceFromContainer(container(), null).service;
  expect(blind.command).toEqual(["/init"]);
  expect(blind.environment.PATH).toBe("/usr/bin");
  expect(blind.labels).toEqual({ maintainer: "ls" });
});

test("ports, folders and volumes come over; volumes are named so that the data is reused", () => {
  const c = container(
    {
      Mounts: [
        { Type: "bind", Source: "/DATA/Downloads", Destination: "/downloads", RW: true },
        { Type: "bind", Source: "/etc/localtime", Destination: "/etc/localtime", RW: false },
        { Type: "volume", Name: "qbt_config", Source: "/var/lib/docker/volumes/qbt_config/_data", Destination: "/config", RW: true },
        { Type: "volume", Name: "9".repeat(64), Source: "", Destination: "/cache", RW: true },
      ],
    },
    {
      PortBindings: {
        "8080/tcp": [{ HostIp: "", HostPort: "8181" }],
        "6881/udp": [{ HostIp: "0.0.0.0", HostPort: "6881" }],
        "9000/tcp": [{ HostIp: "127.0.0.1", HostPort: "9000" }, { HostIp: "::1", HostPort: "" }],
        "7000/tcp": [{ HostIp: "", HostPort: "" }],
      },
      Tmpfs: { "/run": "size=64m", "/tmp": "" },
    },
  );
  const draft = serviceFromContainer(c, image);
  expect(draft.service.ports).toEqual(["8181:8080", "6881:6881/udp", "127.0.0.1:9000:9000", "[::1]::9000", "7000"]);
  expect(draft.service.volumes).toEqual(["/DATA/Downloads:/downloads", "/etc/localtime:/etc/localtime:ro", "qbt_config:/config", `${"9".repeat(64)}:/cache`]);
  expect(draft.service.tmpfs).toEqual(["/run:size=64m", "/tmp"]);
  expect(draft.volumes).toEqual(["qbt_config", "9".repeat(64)]);
});

test("networks: the default bridge is kept, named networks are joined as they are", () => {
  expect(serviceFromContainer(container({}, { NetworkMode: "host" }), image).service.network_mode).toBe("host");
  const shared = serviceFromContainer(container({}, { NetworkMode: "container:abc" }), image);
  expect(shared.service.network_mode).toBeUndefined();
  expect(shared.warnings).toEqual(["sharedNetwork"]);

  const named = serviceFromContainer(
    container({ Config: { Image: "x", Hostname: "torrent" }, NetworkSettings: { Networks: { proxy: { Aliases: ["qbittorrent", "3f2a9c1d5e7b"] }, lan: { Aliases: ["qb"], IPAMConfig: { IPv4Address: "10.0.0.5" } } } } }, { NetworkMode: "proxy" }),
    image,
  );
  expect(named.service.networks).toEqual({ proxy: {}, lan: { aliases: ["qb"], ipv4_address: "10.0.0.5" } });
  expect(named.service.hostname).toBe("torrent");
  expect(named.networks).toEqual(["proxy", "lan"]);
  expect(serviceFromContainer(container({ NetworkSettings: { Networks: { proxy: {} } } }, { NetworkMode: "proxy" }), image).service.networks).toEqual(["proxy"]);
});

test("the rest of `docker run`: devices, limits, health check, what cannot be carried", () => {
  const c = container(
    { Config: { Image: "x", User: "1000:1000", Tty: true, StopTimeout: 30, Healthcheck: { Test: ["CMD-SHELL", "curl -f http://localhost/ || echo $HOME"], Interval: 30e9, Timeout: 500e6, Retries: 3 } } },
    {
      Privileged: true,
      CapAdd: ["NET_ADMIN"],
      Devices: [{ PathOnHost: "/dev/dri", PathInContainer: "/dev/dri", CgroupPermissions: "rwm" }, { PathOnHost: "/dev/ttyUSB0", PathInContainer: "/dev/zigbee", CgroupPermissions: "rw" }],
      DeviceRequests: [{ Driver: "nvidia", Count: -1, Capabilities: [["gpu"]] }],
      ExtraHosts: ["host.docker.internal:host-gateway"],
      ShmSize: 67108864,
      Memory: 536870912,
      NanoCpus: 1500000000,
      RestartPolicy: { Name: "on-failure", MaximumRetryCount: 5 },
      Ulimits: [{ Name: "nofile", Soft: 1024, Hard: 4096 }, { Name: "nproc", Soft: 512, Hard: 512 }],
      Links: ["/db:/app/db"],
      VolumesFrom: ["data"],
    },
  );
  const { service, warnings } = serviceFromContainer(c, image);
  expect(service).toMatchObject({
    user: "1000:1000",
    tty: true,
    stop_grace_period: "30s",
    restart: "on-failure:5",
    privileged: true,
    cap_add: ["NET_ADMIN"],
    devices: ["/dev/dri:/dev/dri", "/dev/ttyUSB0:/dev/zigbee:rw"],
    deploy: { resources: { reservations: { devices: [{ driver: "nvidia", count: "all", capabilities: ["gpu"] }] } } },
    extra_hosts: ["host.docker.internal:host-gateway"],
    mem_limit: 536870912,
    cpus: 1.5,
    ulimits: { nofile: { soft: 1024, hard: 4096 }, nproc: 512 },
    healthcheck: { test: ["CMD-SHELL", "curl -f http://localhost/ || echo $$HOME"], interval: "30s", timeout: "500ms", retries: 3 },
  });
  expect(service.shm_size).toBeUndefined();
  expect(warnings).toEqual(["links", "volumesFrom"]);
});

test("the app's file: external volumes and networks, a tile from CasaOS's old labels, valid YAML", () => {
  const legacy = container({
    Config: { Image: "linuxserver/qbittorrent:5.0", Labels: { origin: "local", name: "qBittorrent", icon: "https://cdn.example/qb.png", web: "8181", index: "/ui", desc: "torrents" } },
    Mounts: [{ Type: "volume", Name: "qbt_config", Source: "", Destination: "/config", RW: true }],
    NetworkSettings: { Networks: { proxy: {} } },
  }, { NetworkMode: "proxy" });
  const { compose } = composeFromContainers("qbittorrent", [{ inspect: legacy, image }]);
  expect(compose.volumes).toEqual({ qbt_config: { external: true } });
  expect(compose.networks).toEqual({ proxy: { external: true } });
  expect(compose["x-casaos"]).toEqual({ main: "qbittorrent", title: { en_us: "qBittorrent" }, icon: "https://cdn.example/qb.png", port_map: "8181", index: "/ui" });
  expect(parseCompose(dumpCompose(compose))).toEqual(compose);
  // a container that CasaOS did not label gets no tile block
  expect(composeFromContainers("x", [{ inspect: container(), image }]).compose["x-casaos"]).toBeUndefined();
});

test("a compose project without its file: services keep their names, generated container names are dropped", () => {
  const labels = (service: string) => ({ "com.docker.compose.project": "blog", "com.docker.compose.service": service, "com.docker.compose.version": "2.30" });
  const web = container({ Name: "/blog-web-1", Config: { Image: "ghost:5", Labels: labels("web") } });
  const db = container({ Name: "/blog_database", Config: { Image: "mysql:8", Labels: labels("db") } });
  const { compose } = composeFromContainers("blog", [{ inspect: web, image: null }, { inspect: db, image: null }]);
  expect(Object.keys(compose.services)).toEqual(["web", "db"]);
  expect(compose.services.web.container_name).toBeUndefined();
  expect(compose.services.db.container_name).toBe("blog_database");
  expect(compose.services.web.labels).toBeUndefined();
});

test("names", () => {
  expect(safeName("/My_App.v2")).toBe("my_app-v2");
  expect(safeName("--")).toBe("app");
  expect(freeName("memos", ["memos", "memos-2"])).toBe("memos-3");
  expect(freeName("memos", [])).toBe("memos");
});

test("what is not an app yet: projects started elsewhere and containers on their own", () => {
  const c = (name: string, labels: Record<string, string> = {}): ContainerSummary => ({ Id: name, Names: ["/" + name], Image: "i", State: "running", Status: "Up", Labels: labels, Ports: [] });
  const of = (project: string, files = "") => ({ "com.docker.compose.project": project, "com.docker.compose.project.config_files": files, "com.docker.compose.project.working_dir": "/srv/" + project });
  const found = foreign([c("memos-1", of("memos")), c("b-web", of("blog", "/srv/blog/a.yml,/srv/blog/b.yml")), c("b-db", of("blog", "/srv/blog/a.yml,/srv/blog/b.yml")), c("lonely"), c("a-1", of("alpha"))], ["memos"]);
  expect(found.projects.map((p) => [p.name, p.containers.length, p.files, p.workingDir])).toEqual([
    ["alpha", 1, [], "/srv/alpha"],
    ["blog", 2, ["/srv/blog/a.yml", "/srv/blog/b.yml"], "/srv/blog"],
  ]);
  expect(found.single.map((x) => x.Id)).toEqual(["lonely"]);
});
