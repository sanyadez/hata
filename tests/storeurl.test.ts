import { expect, test } from "bun:test";
import { storeId, storeUrl } from "../src/store";

test("a store's address as people paste it becomes the repository's", () => {
  expect(storeUrl("https://github.com/bigbeartechworld/big-bear-casaos")).toBe("https://github.com/bigbeartechworld/big-bear-casaos");
  // the ZIP CasaOS takes, a page of the repository, a clone address
  expect(storeUrl("https://github.com/bigbeartechworld/big-bear-casaos/archive/refs/heads/master.zip")).toBe("https://github.com/bigbeartechworld/big-bear-casaos");
  expect(storeUrl(" https://github.com/Owner/Repo/tree/main ")).toBe("https://github.com/Owner/Repo");
  expect(storeUrl("https://github.com/Owner/Repo.git")).toBe("https://github.com/Owner/Repo");
  for (const bad of ["https://gitlab.com/a/b", "https://github.com/onlyowner", "javascript:alert(1)", "", 5]) expect(storeUrl(bad)).toBeNull();
});

test("a new store's id comes from its repository and is not taken", () => {
  expect(storeId("https://github.com/bigbeartechworld/big-bear-casaos", ["casaos"])).toBe("big-bear-casaos");
  expect(storeId("https://github.com/IceWhaleTech/CasaOS-AppStore", ["casaos", "casaos-appstore"])).toBe("casaos-appstore-2");
});

test("a store of Hata's format can be given by the address of its index", () => {
  expect(storeUrl("https://example.org/stores/home/index.json")).toBe("https://example.org/stores/home/index.json");
  expect(storeId("https://example.org/stores/home/index.json", [])).toBe("home");
  // plain http only to try a store out, when asked for
  expect(storeUrl("http://192.168.1.5:8000/index.json")).toBeNull();
  process.env.HATA_STORE_INSECURE = "1";
  try {
    expect(storeUrl("http://192.168.1.5:8000/index.json")).toBe("http://192.168.1.5:8000/index.json");
  } finally {
    delete process.env.HATA_STORE_INSECURE;
  }
  for (const bad of ["https://example.org/index.json?x=1", "https://example.org/other.json", "ftp://x/index.json"]) expect(storeUrl(bad)).toBeNull();
});
