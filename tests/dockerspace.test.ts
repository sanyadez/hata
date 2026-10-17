import { expect, test } from "bun:test";
import type { ContainerSummary, DiskUsage } from "../src/docker";
import { describeSpace } from "../src/dockerspace";

const id = (n: number) => "sha256:" + String(n).repeat(64).slice(0, 64);
const container = (name: string, image: string, over: Partial<ContainerSummary> = {}): ContainerSummary => ({ Id: name.padEnd(64, "0"), Names: ["/" + name], Image: "", ImageID: image, State: "running", Status: "", Labels: {}, Ports: [], ...over });

test("describeSpace: who uses each image and volume, the unused and largest first", () => {
  const df: DiskUsage = {
    Images: [
      { Id: id(1), RepoTags: ["docker.io/library/nginx:latest", "nginx:1.27"], RepoDigests: null, Created: 1, Size: 200, Containers: 1, Labels: null },
      // left by an update: no name any more
      { Id: id(2), RepoTags: ["<none>:<none>"], RepoDigests: ["nginx@sha256:aa"], Created: 2, Size: 190, Containers: 0, Labels: null },
      // an installed app that was brought down: its compose file still names the image
      { Id: id(3), RepoTags: ["ghcr.io/immich-app/immich-server:release"], RepoDigests: null, Created: 3, Size: 900, Containers: 0, Labels: null },
      { Id: id(4), RepoTags: ["adminer:latest"], RepoDigests: null, Created: 4, Size: 100, Containers: 0, Labels: null },
    ],
    Volumes: [
      { Name: "web_data", Driver: "local", Mountpoint: "/x", CreatedAt: "2026-10-01", Labels: { "com.docker.compose.project": "web" }, UsageData: { Size: 5000, RefCount: 1 } },
      { Name: "gone_db", Driver: "local", Mountpoint: "/y", Labels: { "com.docker.compose.project": "gone" }, UsageData: { Size: 7000, RefCount: 0 } },
      { Name: "f".repeat(64), Driver: "local", Mountpoint: "/z", Labels: { "com.docker.volume.anonymous": "" }, UsageData: null },
    ],
    BuildCache: [{ Size: 30, InUse: false }, { Size: 5, InUse: true }],
  };
  const containers = [container("web-nginx-1", id(1), { Labels: { "com.docker.compose.project": "web" }, Mounts: [{ Type: "volume", Name: "web_data", Destination: "/data" }] }), container("stray", id(1), { State: "exited" })];
  const space = describeSpace(df, containers, { immich: ["ghcr.io/immich-app/immich-server:release"], tools: ["adminer"] });

  expect(space.images.map((i) => i.name)).toEqual(["ghcr.io/immich-app/immich-server:release", "", "adminer:latest", "nginx:latest"]);
  const nginx = space.images.find((i) => i.id === id(1))!;
  expect(nginx.more).toEqual(["nginx:1.27"]);
  expect(nginx.used).toEqual([{ container: "web-nginx-1", app: "web", running: true }, { container: "stray", app: "", running: false }]);
  expect(space.images.find((i) => i.id === id(3))!.wanted).toEqual(["immich"]);
  // a reference without a tag means latest
  expect(space.images.find((i) => i.id === id(4))!.wanted).toEqual(["tools"]);
  expect(space.images.find((i) => i.id === id(2))!.wanted).toEqual([]);

  expect(space.volumes.map((v) => [v.name, v.project, v.anonymous, v.size, v.used.length])).toEqual([
    ["gone_db", "gone", false, 7000, 0],
    ["f".repeat(64), "", true, -1, 0],
    ["web_data", "web", false, 5000, 1],
  ]);
  expect(space.cache).toBe(30);
  expect(describeSpace({ Images: null, Volumes: null, BuildCache: null }, [], {})).toEqual({ images: [], volumes: [], cache: 0 });
});
