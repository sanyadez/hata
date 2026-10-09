import { expect, test } from "bun:test";
import { fit, move, narrow, reflow, settle } from "../src/ui/grid.js";

const block = (id: string, x: number, y: number, w: number, h = 2) => ({ id, x, y, w, h });
const rows = (blocks: { id: string; x: number; y: number }[]) => Object.fromEntries(blocks.map((b) => [b.id, [b.x, b.y]]));
const overlapping = (blocks: { id: string; x: number; y: number; w: number; h: number }[]) =>
  blocks.some((a) => blocks.some((b) => a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));

test("blocks rest on what is above them in their columns and never overlap", () => {
  const settled = settle([block("a", 0, 5, 6, 3), block("b", 6, 9, 6, 2), block("c", 0, 6, 4, 4), block("d", 4, 100, 4, 1)]);
  expect(rows(settled)).toEqual({ a: [0, 0], c: [0, 3], b: [6, 0], d: [4, 3] });
  expect(overlapping(settled)).toBe(false);
  // the order they were saved in is kept: what came later does not slip into a gap above
  const tall = settle([block("left", 0, 0, 6, 10), block("right", 6, 0, 6, 2), block("wide", 0, 1, 12, 2), block("late", 6, 2, 6, 2)]);
  expect(rows(tall)).toEqual({ left: [0, 0], right: [6, 0], wide: [0, 10], late: [6, 12] });
  expect(settle([])).toEqual([]);
});

test("a saved board comes out the same every time, and settling twice changes nothing", () => {
  const saved = [block("cpu", 0, 0, 3, 3), block("memory", 3, 0, 2, 3), block("group", 0, 1, 8, 20), block("attention", 8, 1, 4, 5), block("activity", 8, 2, 4, 30)];
  const once = settle(saved);
  expect(rows(once)).toEqual({ cpu: [0, 0], memory: [3, 0], group: [0, 3], attention: [8, 0], activity: [8, 5] });
  expect(rows(settle(once))).toEqual(rows(once));
});

test("a block is sized to the board", () => {
  expect(fit(3, 4, 12)).toEqual({ x: 3, w: 4 });
  expect(fit(10, 4, 12)).toEqual({ x: 8, w: 4 });
  expect(fit(-2, 0, 12, 2)).toEqual({ x: 0, w: 2 });
  expect(fit(5, 40, 12)).toEqual({ x: 0, w: 12 });
  expect(fit(2.6, 3.4, 12)).toEqual({ x: 3, w: 3 });
});

test("a dragged block lands above the block whose upper half it is over, below one whose lower half", () => {
  const board = settle([block("a", 0, 0, 6, 4), block("b", 0, 4, 6, 4), block("c", 6, 0, 6, 4)]);
  // onto the upper half of `a`: above it, and `a` with everything under it moves down
  expect(rows(move(board, "c", 0, 1, 12))).toEqual({ c: [0, 0], a: [0, 4], b: [0, 8] });
  // onto its lower half: between `a` and `b`
  expect(rows(move(board, "c", 0, 3, 12))).toEqual({ a: [0, 0], c: [0, 4], b: [0, 8] });
  // far below everything: it comes up to rest under the last block
  expect(rows(move(board, "c", 0, 500, 12))).toEqual({ a: [0, 0], b: [0, 4], c: [0, 8] });
  // into free columns: it goes to the top of them
  const narrowed = settle([block("a", 0, 0, 4, 4), block("b", 0, 4, 4, 4), block("c", 8, 0, 4, 4)]);
  expect(rows(move(narrowed, "b", 4, 9, 12))).toEqual({ a: [0, 0], c: [8, 0], b: [4, 0] });
  // past the right edge it stays on the board; a block that is not there changes nothing
  expect(move(board, "c", 11, 0, 12).find((b) => b.id === "c")!.x).toBe(6);
  expect(rows(move(board, "nope", 0, 0, 12))).toEqual(rows(board));
  for (const [x, y] of [[0, 0], [3, 2], [5, 5], [9, 1], [2, 7]]) expect(overlapping(move(board, "b", x!, y!, 12))).toBe(false);
});

test("on a narrow screen the blocks follow one another, small ones two to a row", () => {
  const board = [block("cpu", 0, 0, 3, 3), block("memory", 3, 0, 2, 3), block("disk", 5, 0, 2, 3), block("group", 0, 3, 8, 10), block("attention", 8, 3, 4, 5)];
  const small = (id: string) => ["cpu", "memory", "disk"].includes(id);
  const phone = narrow(board, small);
  expect(phone.map((b) => [b.id, b.x, b.y, b.w])).toEqual([["cpu", 0, 0, 1], ["memory", 1, 0, 1], ["disk", 0, 3, 1], ["group", 0, 6, 2], ["attention", 0, 16, 2]]);
  expect(overlapping(phone)).toBe(false);
});

test("on a window too narrow for twelve columns the blocks fill rows of six, in the same order", () => {
  const board = [block("a", 0, 0, 2), block("b", 2, 0, 2), block("c", 4, 0, 2), block("disk", 6, 0, 3), block("d", 9, 0, 2), block("group", 1, 1, 9, 10), block("list", 0, 2, 12, 5)];
  const half = reflow(board, 6, (b) => b.w);
  expect(half.map((b) => [b.id, b.x, b.y, b.w])).toEqual([["a", 0, 0, 2], ["b", 2, 0, 2], ["c", 4, 0, 2], ["disk", 0, 2, 3], ["d", 3, 2, 2], ["group", 0, 4, 6], ["list", 0, 14, 6]]);
  expect(overlapping(half)).toBe(false);
});
