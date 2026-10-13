/**
 * The few requests of the S3 protocol the second copy of the backups needs: what a folder of a bucket
 * holds, a file put there, a file taken away. Requests are signed here (Signature Version 4, WebCrypto)
 * and a large file goes up in parts read from the disk one at a time, so a snapshot of many gigabytes
 * costs the memory of one part. Signing, addresses and reading the answers are pure and tested.
 */

export interface S3Place {
  /** The service's address; "" — Amazon's own, found by the region */
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secret: string;
}

/** What the service answered instead of doing it; `code` is its own word — AccessDenied, NoSuchBucket */
export class S3Error extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
const sha256 = async (data: string | ArrayBuffer | Uint8Array): Promise<string> => hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? encoder.encode(data) : data));
async function hmac(key: ArrayBuffer | Uint8Array, text: string): Promise<ArrayBuffer> {
  return crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), encoder.encode(text));
}

/** As the signature wants it: everything but letters, digits and `-._~` in percent form */
export const encodePart = (text: string): string => encodeURIComponent(text).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/**
 * Where a file of the bucket is asked for. A service named by its address gets the bucket in the path,
 * which every S3-compatible one takes; Amazon gets it in the host name — unless the name has dots, which
 * its certificate does not cover.
 */
export function address(place: Pick<S3Place, "endpoint" | "region" | "bucket">, key: string, query: Record<string, string> = {}): URL {
  const path = key.split("/").map(encodePart).join("/");
  const names = Object.keys(query).sort();
  const search = names.length ? "?" + names.map((name) => `${encodePart(name)}=${encodePart(query[name]!)}`).join("&") : "";
  if (place.endpoint) return new URL(`${place.endpoint}/${place.bucket}/${path}${search}`);
  const amazon = `s3.${place.region}.amazonaws.com`;
  return new URL(place.bucket.includes(".") ? `https://${amazon}/${place.bucket}/${path}${search}` : `https://${place.bucket}.${amazon}/${path}${search}`);
}

/** The headers a request goes with, `authorization` among them. `bodyHash` is the SHA-256 of what is sent, in hex */
export async function sign(method: string, url: URL, headers: Record<string, string>, bodyHash: string, place: Pick<S3Place, "region" | "accessKey" | "secret">, now: Date): Promise<Record<string, string>> {
  const stamp = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const all: Record<string, string> = { ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim()])), host: url.host, "x-amz-content-sha256": bodyHash, "x-amz-date": stamp };
  const names = Object.keys(all).sort();
  const request = [method, url.pathname, url.search.slice(1), ...names.map((name) => `${name}:${all[name]}`), "", names.join(";"), bodyHash].join("\n");
  const scope = `${day}/${place.region}/s3/aws4_request`;
  let key: ArrayBuffer = await hmac(encoder.encode("AWS4" + place.secret), day);
  for (const part of [place.region, "s3", "aws4_request"]) key = await hmac(key, part);
  const signature = hex(await hmac(key, ["AWS4-HMAC-SHA256", stamp, scope, await sha256(request)].join("\n")));
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${place.accessKey}/${scope},SignedHeaders=${names.join(";")},Signature=${signature}` };
}

const unescapeXml = (text: string): string => text.replace(/&(lt|gt|quot|apos|amp|#x?[0-9a-fA-F]+);/g, (_, name: string) => (name === "lt" ? "<" : name === "gt" ? ">" : name === "quot" ? '"' : name === "apos" ? "'" : name === "amp" ? "&" : String.fromCodePoint(name[1] === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1)))));
const element = (xml: string, name: string): string | null => {
  const found = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return found ? unescapeXml(found[1]!) : null;
};

/** One page of a listing: the names of the files, and the word to ask for the next page with ("" — that was the last) */
export function parseList(xml: string): { keys: string[]; next: string } {
  const keys = [...xml.matchAll(/<Contents>[\s\S]*?<Key>([^<]*)<\/Key>/g)].map((found) => unescapeXml(found[1]!));
  return { keys, next: element(xml, "IsTruncated") === "true" ? (element(xml, "NextContinuationToken") ?? "") : "" };
}

/** The refusal in an answer: the service's code and sentence, or the status when it sent neither */
export function parseError(status: number, body: string): S3Error {
  const code = element(body, "Code") ?? `HTTP ${status}`;
  return new S3Error(code, element(body, "Message") ?? code);
}

/** Parts of 16 MB, larger only for a file that would otherwise need more than the 10 000 parts allowed */
export const partSize = (size: number): number => Math.max(16, Math.ceil(size / 9000 / 1024 / 1024)) * 1024 * 1024;

const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

async function call(place: S3Place, method: string, key: string, options: { query?: Record<string, string>; body?: string | ArrayBuffer; type?: string } = {}): Promise<Response> {
  const url = address(place, key, options.query);
  const headers = await sign(method, url, options.type ? { "content-type": options.type } : {}, options.body === undefined ? EMPTY_HASH : await sha256(options.body), place, new Date());
  const { host: _, ...sent } = headers;
  const response = await fetch(url, { method, headers: sent, body: options.body, redirect: "error" });
  if (!response.ok) throw parseError(response.status, await response.text().catch(() => ""));
  return response;
}

/** The same request again when the network, not the service, let it down */
async function patiently<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (e) {
      const passing = !(e instanceof S3Error) || /^(HTTP 5\d\d|InternalError|SlowDown|ServiceUnavailable|RequestTimeout)$/.test(e.code);
      if (!passing || attempt === 3) throw e;
      await Bun.sleep(attempt * 2000);
    }
  }
}

/** The names of every file under a prefix */
export async function list(place: S3Place, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for (let token = ""; ; ) {
    const page = parseList(await (await patiently(() => call(place, "GET", "", { query: { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) } }))).text());
    keys.push(...page.keys);
    if (!page.next) return keys;
    token = page.next;
  }
}

export async function putText(place: S3Place, key: string, text: string): Promise<void> {
  await call(place, "PUT", key, { body: text, type: "text/plain" });
}

export async function remove(place: S3Place, key: string): Promise<void> {
  await patiently(() => call(place, "DELETE", key));
}

/** Puts a file of this machine into the bucket; it is there whole or not at all */
export async function putFile(place: S3Place, key: string, path: string): Promise<void> {
  const file = Bun.file(path);
  const size = file.size;
  const step = partSize(size);
  const type = "application/octet-stream";
  if (size <= step) return void (await patiently(async () => call(place, "PUT", key, { body: await file.arrayBuffer(), type })));
  const uploadId = element(await (await call(place, "POST", key, { query: { uploads: "" }, type })).text(), "UploadId");
  if (!uploadId) throw new S3Error("NoUploadId", "The service did not start the upload.");
  try {
    const tags: string[] = [];
    for (let at = 0; at < size; at += step) {
      const number = String(tags.length + 1);
      const sent = await patiently(async () => call(place, "PUT", key, { query: { partNumber: number, uploadId }, body: await file.slice(at, Math.min(size, at + step)).arrayBuffer() }));
      tags.push(sent.headers.get("etag") ?? "");
    }
    const parts = tags.map((tag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${tag.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</ETag></Part>`).join("");
    const done = await (await call(place, "POST", key, { query: { uploadId }, body: `<CompleteMultipartUpload>${parts}</CompleteMultipartUpload>`, type: "application/xml" })).text();
    // this one request can answer 200 and still carry a refusal
    if (/<Error>/.test(done)) throw parseError(200, done);
  } catch (e) {
    // the parts sent so far would be kept, and billed, until somebody removes them
    await call(place, "DELETE", key, { query: { uploadId } }).catch(() => {});
    throw e;
  }
}
