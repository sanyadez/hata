import { expect, test } from "bun:test";
import { failedOnDisk } from "../src/apps";

const failed = {
  State: { Running: false, Status: "exited", ExitCode: 128, Error: "error while creating mount source path '/mnt/big/DATA/AppData/x': mkdir /mnt/big/DATA: operation not permitted" },
  HostConfig: { RestartPolicy: { Name: "unless-stopped" } },
  Mounts: [{ Type: "bind", Source: "/mnt/big/DATA/AppData/x/config", Destination: "/config", RW: true }],
};

test("a container is started again only when its disk kept it from starting", () => {
  expect(failedOnDisk(failed, ["/mnt/big"])).toBe(true);
  // another disk came back
  expect(failedOnDisk(failed, ["/mnt/other"])).toBe(false);
  expect(failedOnDisk(failed, ["/mnt/bi"])).toBe(false);
  // stopped by somebody: Docker keeps no error
  expect(failedOnDisk({ ...failed, State: { Running: false, Status: "exited", ExitCode: 0, Error: "" } }, ["/mnt/big"])).toBe(false);
  // nothing would have started it
  expect(failedOnDisk({ ...failed, HostConfig: { RestartPolicy: { Name: "no" } } }, ["/mnt/big"])).toBe(false);
  expect(failedOnDisk({ ...failed, HostConfig: {} }, ["/mnt/big"])).toBe(false);
  // a named volume is no folder of the disk
  expect(failedOnDisk({ ...failed, Mounts: [{ Type: "volume", Source: "/mnt/big/docker/volumes/v/_data", Destination: "/data", RW: true }] }, ["/mnt/big"])).toBe(false);
  expect(failedOnDisk({ ...failed, State: { ...failed.State, Running: true } }, ["/mnt/big"])).toBe(false);
});
