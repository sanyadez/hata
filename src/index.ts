#!/usr/bin/env bun
/**
 * Entry point: `hata` runs the server; the other commands manage the installation.
 * Server modules are imported lazily — `hata version` or `hata install` must not create a state directory.
 */
import { VERSION } from "./version";

const USAGE = `Hata ${VERSION} — a home server in a single file

Usage:
  hata              run the server
  hata install      install as a systemd service and start it (needs root);
                    --port <number> sets the port of the web UI
  hata uninstall    stop and remove the service (apps and data stay)
  hata migrate casaos
                    take over the apps of a CasaOS install on this machine (needs root);
                    --dry-run shows the plan, --yes does not ask, --keep-casaos leaves
                    CasaOS running, --undo gives the apps back
  hata restore <backup folder>
                    bring the server back from its backup: Hata's settings and users, then
                    every app from its latest snapshot (needs root); --yes does not ask.
                    A copy sealed with a passphrase is opened first
  hata unseal <file.enc> [<output file>]
                    open one file of a sealed backup by hand
  hata setup-url    print the address for creating the first administrator
  hata version      print the version
`;

const command = process.argv[2] ?? "serve";

switch (command) {
  case "serve": {
    const { serve } = await import("./server");
    await serve();
    break;
  }
  case "install":
  case "uninstall": {
    const service = await import("./service");
    process.exit(await (command === "install" ? service.installService(process.argv.slice(3)) : service.uninstallService()));
    break;
  }
  case "migrate": {
    if (process.argv[3] !== "casaos") {
      console.error("Usage: hata migrate casaos [--dry-run] [--yes] [--keep-casaos] [--undo]");
      process.exit(2);
    }
    if (process.getuid?.() !== 0) {
      console.error("This needs root: run it with sudo.");
      process.exit(1);
    }
    const { migrateCasaos } = await import("./migrate");
    process.exit(await migrateCasaos(process.argv.slice(4)));
    break;
  }
  case "unseal": {
    const { unseal } = await import("./restore");
    process.exit(await unseal(process.argv.slice(3)));
  }
  case "restore": {
    const { restoreServer } = await import("./restore");
    process.exit(await restoreServer(process.argv.slice(3)));
    break;
  }
  case "update-watch": {
    // not for people: started by a running Hata that is updating itself (see update.ts)
    const { watchUpdate } = await import("./update");
    process.exit(await watchUpdate());
    break;
  }
  case "setup-url": {
    const { setupUrl } = await import("./server");
    const url = setupUrl();
    console.log(url ?? "Setup is already done: sign in with the administrator's name and password.");
    break;
  }
  case "version":
  case "--version":
  case "-v":
    console.log(VERSION);
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(USAGE);
    break;
  default:
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(2);
}
