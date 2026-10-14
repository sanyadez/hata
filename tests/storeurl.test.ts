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
