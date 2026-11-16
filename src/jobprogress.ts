/**
 * How far an operation got, read from the lines `docker compose` prints. Pure.
 *
 * `compose pull` names the layers and the bytes each has come so far, never how many bytes there are
 * in all, so what can be said honestly is a count of layers: uneven, and it may step back when the next
 * image starts and brings layers of its own.
 */

export type JobStep = "check" | "download" | "start";

export interface JobProgress {
  step?: JobStep;
  /** Layers seen so far */
  layers?: number;
  /** Layers finished */
  done?: number;
  /** Bytes come so far */
  bytes?: number;
  /** Bytes there are in all, where the work knows it (a copy of files): then the percent is bytes of total */
  total?: number;
}

const STEPS: Record<string, JobStep> = { config: "check", pull: "download", up: "start" };
const COMMAND = /^\$ docker compose (config|pull|up)\b/;
const LAYER = /^\s*([0-9a-f]{12})\s+(Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)\b(.*)$/;
const UNITS: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };

/** The size at the start of what follows a layer's state, as Docker writes it: `1.049MB`, `1.27kB` */
export function sizeIn(text: string): number {
  const m = /(\d+(?:\.\d+)?)\s*([kKMGT]?B)\b/.exec(text);
  return m ? Math.round(Number(m[1]) * UNITS[m[2]!.toUpperCase()]!) : 0;
}

/** What a copy of files says every few seconds: `  1.2 GB of 25.0 GB` (sizes by 1024, as it words them) */
const COPIED = /^\s+(\d+(?:\.\d+)?) (MB|GB) of (\d+(?:\.\d+)?) (MB|GB)$/;
const BY_1024: Record<string, number> = { MB: 1024 ** 2, GB: 1024 ** 3 };

/** Reads an operation's lines one by one; the answer is what is known after each of them */
export function progressTracker(): (line: string) => JobProgress {
  let step: JobStep | undefined;
  const layers = new Map<string, { bytes: number; done: boolean }>();
  let copied: { bytes: number; total: number } | null = null;
  return (line) => {
    const said = COPIED.exec(line);
    if (said) copied = { bytes: Number(said[1]) * BY_1024[said[2]!]!, total: Number(said[3]) * BY_1024[said[4]!]! };
    if (copied && !step) return { ...copied };
    const command = COMMAND.exec(line);
    if (command) step = STEPS[command[1]!];
    else if (step === "download") {
      const m = LAYER.exec(line);
      if (m) {
        const layer = layers.get(m[1]!) ?? { bytes: 0, done: false };
        if (m[2] === "Downloading") layer.bytes = Math.max(layer.bytes, sizeIn(m[3]!));
        if (m[2] === "Pull complete" || m[2] === "Already exists") layer.done = true;
        layers.set(m[1]!, layer);
      }
    }
    if (!layers.size) return step ? { step } : {};
    return { step, layers: layers.size, done: [...layers.values()].filter((l) => l.done).length, bytes: [...layers.values()].reduce((sum, l) => sum + l.bytes, 0) };
  };
}

/** Whole percents, rounded down: 100 only when every layer is in; null while nothing is known */
export const percentOf = (p: JobProgress | undefined): number | null => (p?.total ? Math.min(99, Math.floor(((p.bytes ?? 0) / p.total) * 100)) : p?.layers ? Math.floor(((p.done ?? 0) / p.layers) * 100) : null);
