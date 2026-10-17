/**
 * Several disks put to use at once (Settings → Storage, "Several disks together…"): one large folder
 * made of them (mergerfs), protection from a disk failure (SnapRAID), or both — the disks of the data
 * merged, one more disk for parity.
 *
 * The page sends the whole plan: what each disk needs first (formatted as ext4, connected, connected
 * for good instead of until it is unplugged, or nothing), the folder each gets, which one holds the
 * parity. Everything that can be refused is refused before anything is touched (`checkPlan`); then
 * one job does it step by step with the same functions the single dialogs use (`runPlan`). A step that
 * fails ends the job there: what was done before it stays done, and the log says what that was.
 */
import { statfsSync } from "node:fs";
import { connected } from "./disks";
import { connectVolume, formatDisk, keepConnected, mergeableNow, mergeFolders, NAME_RE, type Outcome } from "./mounting";
import { installCommand, PATH } from "./packages";
import { ArrayError, candidates, installed as snapraidInstalled, setUp } from "./snapraid";
import { settings } from "./config";

export type Goal = "merge" | "protect" | "both";
/** What a disk needs before it can take part */
export type Step = "format" | "connect" | "keep" | "ready";

export interface PlanDisk {
  /** The disk, by its kernel name, as the person saw it: a letter that moved is refused */
  disk: string;
  serial: string;
  size: number;
  /** The partition or file system concerned; "" — the whole disk (format only) */
  device: string;
  step: Step;
  /** The folder under /mnt, for "format" and "connect" */
  name: string;
  /** The folder it is connected at already, for "keep" and "ready" */
  path: string;
}

export interface Plan {
  goal: Goal;
  disks: PlanDisk[];
  /** Which of the disks holds the parity; -1 — none (merge only) */
  parity: number;
  /** The merged folder under /mnt */
  name: string;
  time: string;
  scrub: boolean;
}

const MAX_DISKS = 16;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The folder a disk will be at once it is ready */
export const folderOf = (d: PlanDisk): string => (d.step === "format" || d.step === "connect" ? `/mnt/${d.name}` : d.path);

/** The plan as the page sent it, checked for shape and sense; a string — the error code */
export function readPlan(input: Record<string, unknown>): Plan | string {
  const goal = input.goal;
  if (goal !== "merge" && goal !== "protect" && goal !== "both") return "plan.bad";
  const list = Array.isArray(input.disks) ? input.disks : [];
  if (!list.length || list.length > MAX_DISKS) return "plan.bad";
  const disks: PlanDisk[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") return "plan.bad";
    const d = raw as Record<string, unknown>;
    const step = d.step;
    if (step !== "format" && step !== "connect" && step !== "keep" && step !== "ready") return "plan.bad";
    const disk: PlanDisk = { disk: String(d.disk ?? ""), serial: String(d.serial ?? ""), size: Number(d.size) || 0, device: String(d.device ?? ""), step, name: String(d.name ?? ""), path: String(d.path ?? "") };
    if (!/^[A-Za-z0-9_-]+$/.test(disk.disk)) return "plan.bad";
    if (step === "format" || step === "connect") {
      if (!NAME_RE.test(disk.name)) return "disk.badName";
      if (step === "connect" && !disk.device.startsWith("/dev/")) return "plan.bad";
      if (step === "format" && disk.device && !disk.device.startsWith("/dev/")) return "plan.bad";
    } else if (!disk.path.startsWith("/")) return "plan.bad";
    disks.push(disk);
  }
  const folders = disks.map(folderOf);
  if (new Set(folders).size !== folders.length) return "plan.sameFolder";
  // one disk formatted whole and a partition of it, or the same partition twice
  const touched = disks.map((d) => d.device || d.disk);
  if (new Set(touched).size !== touched.length || disks.some((d) => d.step === "format" && !d.device && disks.some((o) => o !== d && o.disk === d.disk))) return "plan.sameDisk";
  const protect = goal !== "merge";
  const parity = protect ? Number(input.parity) : -1;
  if (protect && (!Number.isInteger(parity) || parity < 0 || parity >= disks.length)) return "plan.noParity";
  const data = disks.length - (protect ? 1 : 0);
  if (data < (goal === "protect" ? 1 : 2)) return "plan.fewDisks";
  const name = String(input.name ?? "");
  if (goal !== "protect") {
    if (!NAME_RE.test(name)) return "disk.badName";
    if (folders.includes(`/mnt/${name}`)) return "plan.sameFolder";
  }
  const time = typeof input.time === "string" && TIME_RE.test(input.time) ? input.time : "05:00";
  return { goal, disks, parity, name, time, scrub: input.scrub !== false };
}

/** The disks that hold data: all but the parity one */
export const dataOf = (plan: Plan): PlanDisk[] => plan.disks.filter((_, i) => i !== plan.parity);

const failure = (error: string, more: Partial<Extract<Outcome, { error: string }>> = {}): Extract<Outcome, { error: string }> => ({ error, ...more });

/** Whether the plan can be carried out now; nothing is changed. Null — it can */
export async function checkPlan(plan: Plan, user: string): Promise<Extract<Outcome, { error: string }> | null> {
  const merge = plan.goal !== "protect";
  const protect = plan.goal !== "merge";
  if (merge && !Bun.which("mergerfs", { PATH })) return failure("disk.noMergeTool", { needs: { package: "mergerfs", install: installCommand("mergerfs") } });
  if (protect && !snapraidInstalled()) return failure("array.noTool", { needs: { package: "snapraid", install: installCommand("snapraid") } });
  if (protect && settings.snapraid.parity) return failure("plan.arrayOn");
  const disks = await connected();
  const ready = candidates();
  const free = mergeableNow();
  const sizes: number[] = [];
  for (const [i, d] of plan.disks.entries()) {
    const disk = disks.find((x) => x.name === d.disk);
    if (!disk || disk.serial !== d.serial || disk.size !== d.size) return failure("disk.changed");
    const volume = disk.volumes.find((v) => v.path === d.device);
    let may: Outcome;
    if (d.step === "format") may = await formatDisk(d.disk, { serial: d.serial, size: d.size }, { part: d.device, size: 0, fs: "ext4", label: d.name, connect: "keep", name: d.name }, user, undefined, true);
    else if (d.step === "connect") may = await connectVolume(d.device, d.name, true, user, true);
    else if (d.step === "keep") may = await keepConnected(d.path, user, true);
    else {
      const found = ready.find((c) => c.path === d.path);
      if (!found) return failure("plan.notReady", { message: d.path });
      // a branch of a merged folder already, or what parity cannot share a disk with
      if (merge && i !== plan.parity && !free.includes(d.path)) return failure("plan.inPool", { message: d.path });
      if (i === plan.parity && (found.merged || found.holds)) return failure(found.merged ? "array.parityMerged" : "array.parityHolds");
      may = { path: d.path };
    }
    if ("error" in may) return { ...may, message: [d.device || d.path || disk.path, may.message].filter(Boolean).join(": ") };
    if (d.step === "ready") {
      const fs = statfsSync(d.path);
      sizes.push(fs.blocks * fs.bsize);
    } else sizes.push(d.step === "format" && !d.device ? disk.size : (volume?.size ?? disk.size));
  }
  if (protect) {
    const largest = Math.max(...sizes.filter((_, i) => i !== plan.parity));
    // a file system takes a few per cent of its disk: a fair comparison only once they are made
    if (sizes[plan.parity]! < largest * 0.97) return failure("array.parityTooSmall");
  }
  return null;
}

const ARRAY_WORDS: Record<string, string> = {
  "array.noTool": "SnapRAID is not installed.",
  "array.badDisks": "A disk is not connected for good.",
  "array.parityMerged": "The parity disk is part of a merged folder.",
  "array.parityHolds": "Something of Hata's lies on the parity disk.",
  "array.parityTooSmall": "The parity disk is smaller than the largest data disk.",
};

/** Carries the plan out, step by step; throws with words at the first step that fails */
export async function runPlan(plan: Plan, user: string, log: (line: string) => void, words: (failure: Extract<Outcome, { error: string }>) => string): Promise<void> {
  const fail = (what: string, outcome: Extract<Outcome, { error: string }>): never => {
    throw new Error(`${what}: ${words(outcome)}`);
  };
  for (const d of plan.disks) {
    const where = folderOf(d);
    if (d.step === "format") {
      log(`— Formatting ${d.device || "/dev/" + d.disk} as ext4 for ${where}`);
      const done = await formatDisk(d.disk, { serial: d.serial, size: d.size }, { part: d.device, size: 0, fs: "ext4", label: d.name, connect: "keep", name: d.name }, user, log);
      if ("error" in done) fail(d.device || d.disk, done);
    } else if (d.step === "connect") {
      log(`— Connecting ${d.device} as ${where}`);
      const done = await connectVolume(d.device, d.name, true, user);
      if ("error" in done) fail(d.device, done);
    } else if (d.step === "keep") {
      log(`— Connecting ${where} for good`);
      const done = await keepConnected(d.path, user);
      if ("error" in done) fail(where, done);
    } else log(`— ${where} is ready`);
  }
  if (plan.goal !== "protect") {
    const branches = dataOf(plan).map(folderOf);
    log(`— Merging ${branches.join(" + ")} into /mnt/${plan.name}`);
    const done = await mergeFolders(branches, plan.name, user);
    if ("error" in done) fail(`/mnt/${plan.name}`, done);
  }
  if (plan.goal !== "merge") {
    const parity = folderOf(plan.disks[plan.parity]!);
    log(`— Protection: parity on ${parity}, data on ${dataOf(plan).map(folderOf).join(", ")}`);
    try {
      setUp({ parity, data: dataOf(plan).map(folderOf), appData: false, time: plan.time, scrub: plan.scrub, deleteLimit: settings.snapraid.deleteLimit }, user);
    } catch (e) {
      if (e instanceof ArrayError) throw new Error(`Protection: ${ARRAY_WORDS[e.code] ?? e.code}`);
      throw e;
    }
  }
  log("Done");
}
