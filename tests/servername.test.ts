import { expect, test } from "bun:test";
import { hostsWith, readServerName } from "../src/servername";

test("a name typed for the server", () => {
  expect(readServerName("Hata", "test.local")).toEqual({ host: "hata", local: "hata.local" });
  // the ending the home-network name has is kept
  expect(readServerName("nas", "test.lan")).toEqual({ host: "nas", local: "nas.lan" });
  // a whole name brings its own
  expect(readServerName("nas.home.lan", "test.local")).toEqual({ host: "nas", local: "nas.home.lan" });
  expect(readServerName("-bad", "test.local")).toBeNull();
  expect(readServerName("a b", "test.local")).toBeNull();
  expect(readServerName("x; reboot", "test.local")).toBeNull();
  expect(readServerName("", "test.local")).toBeNull();
  expect(readServerName(5, "test.local")).toBeNull();
});

test("the computer's own line of /etc/hosts", () => {
  const hosts = "127.0.0.1\tlocalhost\n127.0.1.1\ttest.home\ttest\n\n::1 localhost\n";
  expect(hostsWith(hosts, "test", "hata")).toBe("127.0.0.1\tlocalhost\n127.0.1.1\thata\n\n::1 localhost\n");
  // no such line: one is put after localhost's
  expect(hostsWith("127.0.0.1 localhost\n", "test", "hata")).toBe("127.0.0.1 localhost\n127.0.1.1\thata\n");
  // other names of the line stay
  expect(hostsWith("127.0.1.1 test nas-alias\n", "test", "hata")).toBe("127.0.1.1\thata\tnas-alias\n");
});
