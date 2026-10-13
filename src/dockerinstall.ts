/**
 * Installing Docker from the page, for a server that has none — Hata was installed with `--no-docker`,
 * or Docker was removed since. Nothing here runs by itself: it is the "Install" button next to what
 * Docker is, what it is for and this very command.
 *
 * The installer is Docker's own script, the one `install.sh` uses: it adds Docker's package repository
 * for this system and installs the engine with the compose plugin.
 */
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, startJob, type Job } from "./apps";
import { bus } from "./bus";
import { dockerInfo, forgetCompose, run } from "./docker";
import { PATH, run as system } from "./packages";

export const DOCKER_INSTALLER = "https://get.docker.com";
/** What a person would type to do the same by hand */
export const DOCKER_INSTALL_COMMAND = `curl -fsSL ${DOCKER_INSTALLER} | sh`;

export const dockerInstalled = (): boolean => !!Bun.which("docker", { PATH });

async function untilUp(log: (line: string) => void): Promise<void> {
  await system(["systemctl", "enable", "--now", "docker"], 60_000);
  for (let i = 0; i < 30; i++) {
    forgetCompose();
    const info = await dockerInfo();
    if (info.available) return log(`Docker ${info.version} with compose ${info.compose} is running`);
    await Bun.sleep(1000);
  }
  throw new Error("Docker is installed but does not answer");
}

/** Downloads Docker's installer and runs it; the lines it prints are the job's log */
export function installDocker(user: string): Job {
  if (dockerInstalled()) throw new AppError("docker.installed", 409);
  return startJob("", "docker", user, async (log) => {
    log(`$ ${DOCKER_INSTALL_COMMAND}`);
    const res = await fetch(DOCKER_INSTALLER, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Could not download the installer: ${DOCKER_INSTALLER} answered ${res.status}`);
    const script = join(tmpdir(), `hata-get-docker-${crypto.randomUUID()}.sh`);
    writeFileSync(script, await res.text(), { mode: 0o700 });
    try {
      const done = await run(["sh", script], { onLine: log });
      if (done.code !== 0) throw new Error(`The Docker installer failed (exit ${done.code})`);
    } finally {
      rmSync(script, { force: true });
    }
    await untilUp(log);
    bus.publish("apps");
  });
}

/** Docker is installed and not running: starts it, and has it start with the system */
export async function startDocker(): Promise<void> {
  const started = await system(["systemctl", "enable", "--now", "docker"], 60_000);
  forgetCompose();
  if (started.code !== 0) throw new AppError("docker.startFailed", 500, { message: (started.err.trim() || started.out.trim()).split("\n").slice(-1)[0] ?? "" });
  bus.publish("apps");
}
