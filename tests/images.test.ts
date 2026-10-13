import { expect, test } from "bun:test";
import { behind, parseRef, refName, registryAuth } from "../src/images";

const A = "sha256:" + "a".repeat(64);
const B = "sha256:" + "b".repeat(64);

test("parseRef: a name as Docker reads it", () => {
  expect(parseRef("nginx")).toEqual({ registry: "docker.io", repository: "library/nginx", tag: "latest", digest: "" });
  expect(parseRef("nginx:1.27-alpine")).toEqual({ registry: "docker.io", repository: "library/nginx", tag: "1.27-alpine", digest: "" });
  expect(parseRef("linuxserver/jellyfin")).toEqual({ registry: "docker.io", repository: "linuxserver/jellyfin", tag: "latest", digest: "" });
  expect(parseRef("index.docker.io/library/redis:7")).toEqual({ registry: "docker.io", repository: "library/redis", tag: "7", digest: "" });
  expect(parseRef("ghcr.io/immich-app/immich-server:release")).toEqual({ registry: "ghcr.io", repository: "immich-app/immich-server", tag: "release", digest: "" });
  expect(parseRef("localhost:5000/mine")).toEqual({ registry: "localhost:5000", repository: "mine", tag: "latest", digest: "" });
  expect(refName(parseRef("traefik/whoami")!)).toBe("docker.io/traefik/whoami:latest");
});

test("parseRef: an image named by digest, and what is no image name", () => {
  expect(parseRef(`postgres:16@${A}`)).toEqual({ registry: "docker.io", repository: "library/postgres", tag: "16", digest: A });
  expect(parseRef(`ghcr.io/a/b@${A}`)?.digest).toBe(A);
  // a container whose tag was taken away is listed by the id of its image
  expect(parseRef(A)).toBeNull();
  expect(parseRef("")).toBeNull();
  expect(parseRef("Nginx")).toBeNull();
  expect(parseRef("nginx:${TAG}")).toBeNull();
});

test("behind: the tag points at another image than the one at hand", () => {
  const ref = parseRef("nginx:latest")!;
  expect(behind(ref, [`nginx@${A}`], A)).toBe(false);
  expect(behind(ref, [`nginx@${A}`], B)).toBe(true);
  // the image store of containerd writes the name in full
  expect(behind(ref, [`docker.io/library/nginx@${A}`], A)).toBe(false);
  // an image known by several digests is current when one of them is the registry's
  expect(behind(ref, [`nginx@${B}`, `nginx@${A}`], A)).toBe(false);
});

test("behind: only the digests of the same repository count; without one it cannot be told", () => {
  const ref = parseRef("ghcr.io/a/b:1")!;
  expect(behind(ref, [`mirror.example/a/b@${A}`], B)).toBeNull();
  expect(behind(ref, [`mirror.example/a/b@${B}`, `ghcr.io/a/b@${A}`], B)).toBe(true);
  expect(behind(ref, [], A)).toBeNull();
});

test("registryAuth: the saved sign-in of the registry, in the form Docker takes", () => {
  const config = { auths: { "https://index.docker.io/v1/": { auth: btoa("me:pa:ss?>") }, "ghcr.io": { auth: btoa("bot:token") }, "broken.example": { auth: btoa("nocolon") } } };
  const read = (header: string) => JSON.parse(Buffer.from(header.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  expect(read(registryAuth(config, "docker.io"))).toEqual({ username: "me", password: "pa:ss?>", serveraddress: "https://index.docker.io/v1/" });
  expect(read(registryAuth(config, "ghcr.io"))).toEqual({ username: "bot", password: "token", serveraddress: "ghcr.io" });
  expect(registryAuth(config, "quay.io")).toBe("");
  expect(registryAuth(config, "broken.example")).toBe("");
  expect(registryAuth(null, "docker.io")).toBe("");
  expect(registryAuth(config, "docker.io")).not.toMatch(/[+/]/);
});
