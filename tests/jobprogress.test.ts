import { expect, test } from "bun:test";
import { percentOf, progressTracker, sizeIn } from "../src/jobprogress";

test("sizes as Docker writes them", () => {
  expect(sizeIn(" 1.049MB")).toBe(1049000);
  expect(sizeIn(" 1.27kB")).toBe(1270);
  expect(sizeIn(" 0B")).toBe(0);
  expect(sizeIn(" [==>  ] 12.5MB/100MB")).toBe(12500000);
  expect(sizeIn("")).toBe(0);
});

test("the steps follow the commands", () => {
  const read = progressTracker();
  expect(read("Stopped by alex")).toEqual({});
  expect(read("$ docker compose config --quiet").step).toBe("check");
  expect(read("$ docker compose pull").step).toBe("download");
  expect(read("$ docker compose up -d --remove-orphans").step).toBe("start");
});

test("layers counted as compose prints them, with the bytes kept after a layer is complete", () => {
  const read = progressTracker();
  read("$ docker compose pull");
  expect(percentOf(read(" Image redis:7.2.0-alpine Pulling "))).toBeNull();
  read(" 33fcc95c965f Pulling fs layer 0B");
  read(" 7264a8db6415 Pulling fs layer 0B");
  read(" a28817da73be Pulling fs layer 0B");
  read(" 7264a8db6415 Downloading 1.049MB");
  read(" 7264a8db6415 Downloading 3.402MB");
  read(" 7264a8db6415 Download complete 0B");
  read(" 7264a8db6415 Extracting 1B");
  const p = read(" 7264a8db6415 Pull complete 0B");
  expect(p).toEqual({ step: "download", layers: 3, done: 1, bytes: 3402000 });
  expect(percentOf(p)).toBe(33);
});

test("a layer of another image makes the share smaller; nothing reaches 100 before the last layer", () => {
  const read = progressTracker();
  read("$ docker compose pull");
  read(" aaaaaaaaaaaa Pull complete 0B");
  expect(percentOf(read(" bbbbbbbbbbbb Already exists 0B"))).toBe(100);
  expect(percentOf(read(" cccccccccccc Pulling fs layer 0B"))).toBe(66);
});

test("only the pull counts layers: a line of the same shape elsewhere is not one", () => {
  const read = progressTracker();
  read("$ docker compose up -d");
  expect(read(" aaaaaaaaaaaa Pull complete 0B")).toEqual({ step: "start" });
});

test("what is not known stays unknown", () => {
  expect(percentOf(undefined)).toBeNull();
  expect(percentOf({ step: "download" })).toBeNull();
});
