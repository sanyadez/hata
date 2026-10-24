/** Set by the build of a pre-release (`0.22.0-beta.1`): the tag says the suffix, this file the version */
declare const HATA_BUILD_VERSION: string | undefined;

export const VERSION = typeof HATA_BUILD_VERSION === "string" ? HATA_BUILD_VERSION : "0.25.0";

/** true — running as the single-file binary (`bun build --compile`), not from source */
export const COMPILED = Bun.main.startsWith("/$bunfs/");
