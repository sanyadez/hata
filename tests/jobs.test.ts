import { expect, test } from "bun:test";
import { jobFinished, startJob, stopJob, stoppable } from "../src/apps";
import { runLogged } from "../src/packages";

test("stopJob: a job that can be stopped ends its program at once and says so", async () => {
  const stopper = new AbortController();
  const job = startJob("", "wipe", "admin", async (log) => {
    // the program starts before startJob returns: the signal must be there already
    const ran = await runLogged(["sleep", "30"], log, 60_000, {}, (line) => line, stopper.signal);
    if (stopper.signal.aborted) throw new Error("Stopped.");
    if (ran.code !== 0) throw new Error("failed");
  }, true);
  stoppable(job, stopper);
  expect(job.stoppable).toBe(true);
  const started = Date.now();
  expect(stopJob(job.id, "admin")).toBe(true);
  await jobFinished(job);
  expect(Date.now() - started).toBeLessThan(5000);
  expect(job.status).toBe("failed");
  expect(job.stopped).toBe(true);
  expect(job.log).toContain("Stopped by admin");
  // over, it cannot be stopped again
  expect(stopJob(job.id, "admin")).toBe(false);
});

test("stopJob: a job that was not made stoppable is left alone", async () => {
  const job = startJob("", "fsck", "admin", () => Bun.sleep(50), true);
  expect(stopJob(job.id, "admin")).toBe(false);
  await jobFinished(job);
  expect(job.status).toBe("done");
});
