import { expect, test } from "bun:test";
import { parseCpu, parseMemory, parseNet } from "../src/system";

test("parseCpu sums the aggregate line and counts iowait as idle", () => {
  const stat = "cpu  100 5 50 800 20 0 5 0 0 0\ncpu0 50 2 25 400 10 0 2 0 0 0\nintr 1\n";
  expect(parseCpu(stat)).toEqual({ idle: 820, total: 980 });
  expect(parseCpu("")).toBeNull();
});

test("parseMemory: used is what is not available", () => {
  const meminfo = "MemTotal:        8000 kB\nMemFree:         1000 kB\nMemAvailable:    6000 kB\nSwapTotal:       2000 kB\nSwapFree:        1500 kB\n";
  expect(parseMemory(meminfo)).toEqual({ total: 8000 * 1024, used: 2000 * 1024, swapTotal: 2000 * 1024, swapUsed: 500 * 1024 });
});

test("parseNet skips loopback and container interfaces", () => {
  const dev = [
    "Inter-|   Receive                                                |  Transmit",
    " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
    "    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0",
    "  eth0: 1000 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0",
    "docker0: 5000 1 0 0 0 0 0 0 5000 1 0 0 0 0 0 0",
    "veth12ab: 5000 1 0 0 0 0 0 0 5000 1 0 0 0 0 0 0",
    " wlan0: 30 1 0 0 0 0 0 0 4 1 0 0 0 0 0 0",
  ].join("\n");
  expect(parseNet(dev)).toEqual({ rx: 1030, tx: 204 });
});
