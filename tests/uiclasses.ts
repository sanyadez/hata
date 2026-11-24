/** The classes the page may carry besides the blocks' own `ui-…`: shared by tests/blocks.test.ts and scripts/smoke.ts */
/** The utilities of the system: words, a column, the kinds of a button, and the states a block takes while the page runs */
export const UTILITIES = new Set([
  // words: size, tone and type of text; a line cut or kept whole; shown as a block
  ..."small muted mono clip strong num error wrap whole block center sr-only".split(" "),
  // layout: a column of blocks, a part that takes the room left
  ..."stack stack-s grow".split(" "),
  // the kinds of a button
  ..."btn primary danger ghost quiet icon-btn with-icon square link danger-text short wide".split(" "),
  // states a block takes while the page runs (toggled, not drawn): open, chosen, on, at work, a tone of what is said
  ..."open active on off busy done now stopped playing failed selected hidden ok warn bad info".split(" "),
]);
