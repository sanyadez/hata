#!/usr/bin/env bun
/**
 * Entry point: `hata` runs the server; the other commands manage the installation.
 * Server modules are imported lazily — `hata version` or `hata install` must not create a state directory.
 */
import { VERSION } from "./version";

const USAGE = `Hata ${VERSION} — a home server in a single file

Usage:
  hata              run the server
  hata install      install as a systemd service and start it (needs root)
  hata uninstall    stop and remove the service (apps and data stay)
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
    process.exit(await (command === "install" ? service.installService() : service.uninstallService()));
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
