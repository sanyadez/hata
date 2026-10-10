export const VERSION = "0.5.0";

/** true — running as the single-file binary (`bun build --compile`), not from source */
export const COMPILED = Bun.main.startsWith("/$bunfs/");
