/**
 * Room on a network file system, asked without blocking: the file system call waits while a server does
 * not answer, and in this process that would stop everything — so `df` runs in a process of its own with
 * a time limit, and what it last said is kept. No imports with side effects: the file manager and the
 * disks' page use it.
 */
import { run } from "./packages";

const rooms = new Map<string, { total: number; free: number; at: number }>();

/** Room as last measured; measured again in the background when older than a minute. null — not known yet */
export function roomOf(path: string): { total: number; free: number } | null {
  const known = rooms.get(path);
  if (!known || Date.now() - known.at > 60_000) {
    rooms.set(path, { total: known?.total ?? 0, free: known?.free ?? 0, at: Date.now() });
    void run(["timeout", "8", "df", "-B1", "--output=size,avail", path], 10_000).then((r) => {
      const nums = r.out.trim().split("\n")[1]?.trim().split(/\s+/).map(Number) ?? [];
      // a server that does not tell its size is answered with a made-up petabyte or more: not known
      if (r.code === 0 && nums.length === 2 && nums.every(Number.isFinite) && nums[0]! < 2 ** 50) rooms.set(path, { total: nums[0]!, free: nums[1]!, at: Date.now() });
    });
  }
  return known && known.total ? { total: known.total, free: known.free } : null;
}
