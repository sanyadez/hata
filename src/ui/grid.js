// The arithmetic of the board (pure; used by the page, tested on its own). The board is a grid of
// columns; a block has a column `x`, a width `w` in columns, a row `y` and a height `h` in rows. Blocks
// never overlap and never float: each one rests on whatever stands above it in its columns, so `y` as it
// is saved only says what comes above what, and `settle` turns that into rows.

const sideBySide = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w;

/**
 * Puts every block as high as it goes without passing over a block that comes before it. Blocks are
 * taken from the top down; of two that start in the same row, `first` (the one being moved) wins the
 * row and the other goes under it.
 */
export function settle(blocks, first = null) {
  const order = blocks.map((block) => ({ ...block })).sort((a, b) => a.y - b.y || (a.id === first ? -1 : b.id === first ? 1 : 0) || a.x - b.x);
  const out = [];
  for (const block of order) {
    block.y = out.reduce((bottom, above) => (sideBySide(above, block) ? Math.max(bottom, above.y + above.h) : bottom), 0);
    out.push(block);
  }
  return out;
}

/** The column and width a block may have on a board of `columns`: inside it, and not narrower than `min` */
export function fit(x, w, columns, min = 1) {
  const width = Math.min(columns, Math.max(min, Math.round(w)));
  return { x: Math.min(columns - width, Math.max(0, Math.round(x))), w: width };
}

/**
 * Where a block being dragged lands. It is aimed at column `x` and row `y` (its top edge); over the
 * upper half of a block it goes above that block, over the lower half below it — a block is never
 * dropped into the middle of another.
 */
export function move(blocks, id, x, y, columns) {
  const moved = blocks.find((block) => block.id === id);
  if (!moved) return settle(blocks);
  const place = fit(x, moved.w, columns);
  const aim = { ...moved, x: place.x, y: Math.max(0, Math.round(y)) };
  const under = blocks.find((block) => block.id !== id && sideBySide(block, aim) && aim.y >= block.y && aim.y < block.y + block.h);
  if (under) aim.y = aim.y < under.y + under.h / 2 ? under.y : under.y + under.h;
  return settle(blocks.map((block) => (block.id === id ? aim : block)), id);
}

/**
 * The same board on a narrow screen: two columns, the blocks one after another in the order they have
 * on the wide one (top to bottom, left to right). A `small` block takes one column, any other both.
 */
export function narrow(blocks, small) {
  const order = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  let column = 0;
  return settle(
    order.map((block, row) => {
      const one = small(block.id);
      const placed = { ...block, x: one ? column : 0, w: one ? 1 : 2, y: row };
      column = one ? 1 - column : 0;
      return placed;
    }),
  );
}
