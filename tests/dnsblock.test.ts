import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { TYPE } from "../src/dns";
import { addressIs, blockedAnswer, cleanBlock, compiledFrom, compileText, decide, ListBuilder, memoryOf, parseLine, readRewrite, rulesTrouble, safeRegex, strongest, type Source } from "../src/dnsblock";
import { fromAdguardYaml, fromGravity, fromPiholeToml, piholeRegex, readImportFile, readTar } from "../src/dnsimport";

const list = async (id: string, text: string, allow = false): Promise<Source> => ({ id, list: await compileText(text, allow) });
const ask = (name: string, type: number = TYPE.A, client = "192.168.1.5", device?: string) => ({ name, type, client, device });
const none = new Set<string>();

test("hosts files: each name exactly, the machine's own names left out, another address is an answer", async () => {
  const s = await list("a", "# comment\n127.0.0.1 localhost\n::1 localhost ip6-loopback\n0.0.0.0 ads.example.com tracker.example.org # end\n192.168.1.9 nas.example.com\n");
  expect(strongest([s], none, ask("ads.example.com"))?.action).toBe("block");
  expect(strongest([s], none, ask("tracker.example.org"))?.action).toBe("block");
  expect(strongest([s], none, ask("sub.ads.example.com"))).toBeNull();
  expect(strongest([s], none, ask("localhost"))).toBeNull();
  expect(strongest([s], none, ask("nas.example.com"))).toMatchObject({ action: "rewrite", rewrite: { type: "A", value: "192.168.1.9" } });
  expect(s.list.counts.names).toBe(2);
  expect(s.list.counts.broken).toBe(0);
});

test("plain lists and dnsmasq's lines", async () => {
  const s = await list("a", "ads.example.com\nÖl.example.com\naddress=/whole.example/0.0.0.0\nserver=/other.example/\nserver=/forwarded.example/1.1.1.1\nnot a name here\nhttp://x.example/banner.png\n");
  expect(strongest([s], none, ask("ads.example.com"))?.action).toBe("block");
  expect(strongest([s], none, ask("xn--l-0ga.example.com"))?.action).toBe("block");
  expect(strongest([s], none, ask("deep.whole.example"))?.action).toBe("block");
  expect(strongest([s], none, ask("deep.other.example"))?.action).toBe("block");
  expect(strongest([s], none, ask("forwarded.example"))).toBeNull();
  expect(s.list.counts.notDns + s.list.counts.broken).toBe(3);
});

test("AdGuard's syntax: subdomains, exact, wildcard, regex, exception", async () => {
  const s = await list("a", "||sub.example^\n|exact.example^\n@@||ok.sub.example^\n||wild*.example^\n/^ad[0-9]+\\./\n*.star.example\n");
  expect(strongest([s], none, ask("sub.example"))?.action).toBe("block");
  expect(strongest([s], none, ask("x.y.sub.example"))?.action).toBe("block");
  expect(strongest([s], none, ask("ok.sub.example"))?.action).toBe("allow");
  expect(strongest([s], none, ask("deeper.ok.sub.example"))?.action).toBe("allow");
  expect(strongest([s], none, ask("exact.example"))?.action).toBe("block");
  expect(strongest([s], none, ask("no.exact.example"))).toBeNull();
  expect(strongest([s], none, ask("wildcard.example"))?.action).toBe("block");
  expect(strongest([s], none, ask("ad123.other.example"))?.action).toBe("block");
  expect(strongest([s], none, ask("adx.other.example"))).toBeNull();
  expect(strongest([s], none, ask("a.star.example"))?.action).toBe("block");
});

test("the trailing | is the same rule, what only a browser can do is left out and counted", async () => {
  const s = await list("a", "||a.example^|\n##.banner\nexample.com##.ad\nexample.com#@#.ad\n||x.example^$third-party\n||x.example/banner\n/banner\\/ad/\n! comment\n[Adblock Plus 2.0]\n");
  expect(strongest([s], none, ask("q.a.example"))?.action).toBe("block");
  expect(s.list.counts).toMatchObject({ names: 1, cosmetic: 3, notDns: 3, broken: 0 });
});

test("as the real lists write it: pieces of a name, ://, and the comment lines of a hosts file", async () => {
  const s = await list("a", "-ads1.\n-ad123-\n://jhf.ru^\n://sport*.co^\nword\n#####\n### Version: 1\n##### Info #\n");
  expect(strongest([s], none, ask("my-ads1.example.com"))?.action).toBe("block");
  expect(strongest([s], none, ask("x-ad123-y.example.com"))?.action).toBe("block");
  expect(strongest([s], none, ask("ads1.example.com"))).toBeNull();
  expect(strongest([s], none, ask("jhf.ru"))?.action).toBe("block");
  expect(strongest([s], none, ask("www.jhf.ru"))).toBeNull();
  expect(strongest([s], none, ask("sportframe.co"))?.action).toBe("block");
  expect(s.list.counts).toMatchObject({ cosmetic: 0, broken: 1, notDns: 0 });
});

test("$important beats an exception, an exception with $important beats everything", async () => {
  const a = await list("a", "@@||one.example^\n||one.example^$important\n||two.example^$important\n@@||two.example^$important\n||three.example^\n@@||three.example^\n");
  expect(strongest([a], none, ask("one.example"))?.action).toBe("block");
  expect(strongest([a], none, ask("two.example"))?.action).toBe("allow");
  expect(strongest([a], none, ask("three.example"))?.action).toBe("allow");
});

test("across lists: an exception of a later list counts, $important of a later list counts", async () => {
  const a = await list("a", "||x.example^\n||y.example^\n");
  const b = await list("b", "@@||x.example^\n@@||y.example^\n");
  const c = await list("c", "||y.example^$important\n");
  expect(strongest([a, b, c], none, ask("x.example"))).toMatchObject({ action: "allow", source: "b" });
  expect(strongest([a, b, c], none, ask("y.example"))).toMatchObject({ action: "block", source: "c" });
});

test("a list of exceptions allows what it names, whatever its format", async () => {
  const s = await list("a", "0.0.0.0 x.example\n||y.example^\n/^z\\./\n", true);
  expect(strongest([s], none, ask("x.example"))?.action).toBe("allow");
  expect(strongest([s], none, ask("a.y.example"))?.action).toBe("allow");
  expect(strongest([s], none, ask("z.example"))?.action).toBe("allow");
});

test("the person's own rules beat every list", async () => {
  const own = await list("own", "@@||a.example^\n||b.example^\n");
  const lists = [await list("l", "||a.example^$important\n@@||b.example^$important\n")];
  expect(decide(own, lists, none, ask("a.example"))).toMatchObject({ action: "allow", source: "own" });
  expect(decide(own, lists, none, ask("b.example"))).toMatchObject({ action: "block", source: "own" });
  expect(decide(own, lists, none, ask("c.example"))).toBeNull();
});

test("$dnstype: only these types, or all but these", async () => {
  const s = await list("a", "||a.example^$dnstype=AAAA\n||b.example^$dnstype=~A|~AAAA\n||broken.example^$dnstype=NOPE\n");
  expect(strongest([s], none, ask("a.example", TYPE.AAAA))?.action).toBe("block");
  expect(strongest([s], none, ask("a.example", TYPE.A))).toBeNull();
  expect(strongest([s], none, ask("b.example", TYPE.A))).toBeNull();
  expect(strongest([s], none, ask("b.example", TYPE.HTTPS))?.action).toBe("block");
  expect(s.list.counts.broken).toBe(1);
});

test("$client: an address, a network, a device's name, and not them", async () => {
  const s = await list("a", "||a.example^$client=192.168.1.5\n||b.example^$client=10.0.0.0/8\n||c.example^$client='Kid phone'\n||d.example^$client=~192.168.1.5\n||e.example^$client=fd00::/8\n*$client=192.168.9.9,dnstype=AAAA\n");
  expect(strongest([s], none, ask("a.example"))?.action).toBe("block");
  expect(strongest([s], none, ask("a.example", TYPE.A, "192.168.1.6"))).toBeNull();
  expect(strongest([s], none, ask("b.example", TYPE.A, "10.1.2.3"))?.action).toBe("block");
  expect(strongest([s], none, ask("c.example", TYPE.A, "192.168.1.5", "kid phone"))?.action).toBe("block");
  expect(strongest([s], none, ask("d.example"))).toBeNull();
  expect(strongest([s], none, ask("d.example", TYPE.A, "192.168.1.6"))?.action).toBe("block");
  expect(strongest([s], none, ask("e.example", TYPE.A, "fd00::1"))?.action).toBe("block");
  expect(strongest([s], none, ask("anything.example", TYPE.AAAA, "192.168.9.9"))?.action).toBe("block");
  expect(strongest([s], none, ask("anything.example", TYPE.A, "192.168.9.9"))).toBeNull();
});

test("addressIs: networks of both families", () => {
  expect(addressIs("192.168.1.200", "192.168.1.128/25")).toBe(true);
  expect(addressIs("192.168.1.100", "192.168.1.128/25")).toBe(false);
  expect(addressIs("192.168.1.100", "0.0.0.0/0")).toBe(true);
  expect(addressIs("2001:db8::1", "2001:db8::/32")).toBe(true);
  expect(addressIs("2001:db9::1", "2001:db8::/32")).toBe(false);
  expect(addressIs("10.0.0.1", "2001:db8::/32")).toBe(false);
});

test("$dnsrewrite: every shape, and over a block", async () => {
  expect(readRewrite("1.2.3.4")).toEqual({ type: "A", value: "1.2.3.4" });
  expect(readRewrite("::1")).toEqual({ type: "AAAA", value: "::1" });
  expect(readRewrite("host.example")).toEqual({ type: "CNAME", value: "host.example" });
  expect(readRewrite("REFUSED")).toEqual({ rcode: 5 });
  expect(readRewrite("NXDOMAIN;;")).toEqual({ rcode: 3 });
  expect(readRewrite("NOERROR;TXT;hello")).toEqual({ type: "TXT", value: "hello" });
  expect(readRewrite("NOERROR;MX;32 mail")).toBeNull();
  const s = await list("a", "||r.example^\n||r.example^$dnsrewrite=10.0.0.1\n@@||off.example^$dnsrewrite\n||off.example^$dnsrewrite=10.0.0.2\n||no.example^$dnsrewrite=NOERROR;MX;x\n");
  expect(strongest([s], none, ask("r.example"))).toMatchObject({ action: "rewrite", rewrite: { value: "10.0.0.1" } });
  expect(strongest([s], none, ask("off.example"))?.action).toBe("allow");
  expect(s.list.counts.broken).toBe(1);
});

test("$denyallow: everything under it but these", async () => {
  const s = await list("a", "||example^$denyallow=good.example|fine.example\n");
  expect(strongest([s], none, ask("bad.example"))?.action).toBe("block");
  expect(strongest([s], none, ask("x.good.example"))).toBeNull();
});

test("$badfilter switches a rule off, of any list", async () => {
  const a = await list("a", "||off.example^\n||on.example^\n||mod.example^$dnstype=A,important\n/^re\\./\n");
  const b = await list("b", "||off.example^$badfilter\n||mod.example^$important,dnstype=A,badfilter\n/^re\\./$badfilter\n");
  const bad = new Set([...a.list.bad, ...b.list.bad]);
  expect(strongest([a, b], bad, ask("off.example"))).toBeNull();
  expect(strongest([a, b], bad, ask("on.example"))?.action).toBe("block");
  expect(strongest([a, b], bad, ask("mod.example"))).toBeNull();
  expect(strongest([a, b], bad, ask("re.example"))).toBeNull();
});

test("a regular expression that could take ages is refused", async () => {
  expect(safeRegex("^(.+[_.-])?adse?rv(er?|ice)?s?[0-9]*[_.-]")).toBe(true);
  expect(safeRegex("(a+)+$")).toBe(false);
  expect(safeRegex("(a*)*x")).toBe(false);
  expect(safeRegex("((a|b)+c)*")).toBe(false);
  expect(safeRegex("(.*)\\1")).toBe(false);
  expect(safeRegex(".*.*.*.*x")).toBe(false);
  expect(safeRegex("[(]a+[)]+")).toBe(true);
  const s = await list("a", "/(a+)+$/\n/[/\n");
  expect(s.list.counts.broken).toBe(2);
  expect(s.list.patterns.length).toBe(0);
});

test("a piece too short or a rule for everything is refused", () => {
  expect(parseLine("||ad*")).toEqual([{ kind: "skip", why: "broken" }]);
  expect(parseLine("*")).toEqual([{ kind: "skip", why: "broken" }]);
  expect(parseLine("||*^$important")).toEqual([{ kind: "skip", why: "broken" }]);
});

test("a list kept on disk decides as the one just read", async () => {
  const text = "||a.example^\n|b.example^\n@@||c.a.example^\n||d.example^$important\n/^e[0-9]\\./\n||f.example^$badfilter\n";
  const first = await compileText(text);
  const again = compiledFrom({ exact: first.exact, sub: first.sub, allowExact: first.allowExact, allowSub: first.allowSub }, first.complex, first.counts);
  for (const name of ["a.example", "x.a.example", "b.example", "c.a.example", "d.example", "e1.example", "none.example"]) {
    expect(strongest([{ id: "x", list: again }], none, ask(name))).toEqual(strongest([{ id: "x", list: first }], none, ask(name)));
  }
  expect(again.bad).toEqual(first.bad);
  expect(again.counts).toEqual(first.counts);
});

test("a million names: little memory, repeats counted once, lookups fast", async () => {
  const b = new ListBuilder();
  for (let i = 0; i < 1_000_000; i++) b.add(`host-${i}.example.com`);
  b.add("host-5.example.com");
  const c = b.finish();
  expect(c.counts.names).toBe(1_000_000);
  expect(memoryOf(c)).toBe(8_000_000);
  const s = { id: "a", list: c };
  const started = performance.now();
  let found = 0;
  for (let i = 0; i < 10_000; i++) if (strongest([s], none, ask(`host-${i * 90}.example.com`))) found++;
  expect(found).toBe(10_000);
  expect(performance.now() - started).toBeLessThan(2_000);
});

test("what a blocked name gets", () => {
  expect(blockedAnswer(TYPE.A, "zero").answers[0]!.data).toEqual([0, 0, 0, 0]);
  expect(blockedAnswer(TYPE.AAAA, "zero").answers[0]!.data.length).toBe(16);
  expect(blockedAnswer(TYPE.HTTPS, "zero")).toEqual({ rcode: 0, answers: [] });
  expect(blockedAnswer(TYPE.A, "nxdomain")).toEqual({ rcode: 3, answers: [] });
});

test("the person's rules: what means nothing is named", () => {
  expect(rulesTrouble(["||good.example^", "! a note", "example.com##.ad", "||x.example^$third-party", "/(a+)+/"])).toEqual([
    { line: "example.com##.ad", why: "cosmetic" },
    { line: "||x.example^$third-party", why: "notDns" },
    { line: "/(a+)+/", why: "broken" },
  ]);
});

test("settings are cleaned", () => {
  const s = cleanBlock({ enabled: true, mode: "x", lists: [{ id: "abc", url: "https://l.example/a.txt" }, { id: "abd", url: "https://l.example/a.txt" }, { id: "bad!", url: "https://l.example/b" }, { id: "abe", url: "file:///etc/passwd" }, { id: "abf", url: "https://u:p@l.example/" }], devices: [{ address: "192.168.1.5", name: "Phone", on: false }, { address: "nope" }] });
  expect(s.mode).toBe("zero");
  expect(s.lists.map((l) => l.id)).toEqual(["abc"]);
  expect(s.lists[0]!.name).toBe("l.example");
  expect(s.devices).toEqual([{ address: "192.168.1.5", name: "Phone", on: false }]);
  expect(cleanBlock(undefined)).toMatchObject({ enabled: false, update: true, log: true });
});

// --- Moving in -----------------------------------------------------------------------------------------

function gravity(): Database {
  const db = new Database(":memory:");
  db.run("CREATE TABLE adlist (id INTEGER PRIMARY KEY, address TEXT, enabled INT, comment TEXT, type INT DEFAULT 0)");
  db.run("CREATE TABLE domainlist (id INTEGER PRIMARY KEY, type INT, domain TEXT, enabled INT)");
  db.run("CREATE TABLE client (id INTEGER PRIMARY KEY, ip TEXT, comment TEXT)");
  db.run('CREATE TABLE "group" (id INTEGER PRIMARY KEY, name TEXT)');
  db.run("INSERT INTO adlist (address, enabled, comment, type) VALUES ('https://l.example/a.txt', 1, 'Main list', 0), ('https://l.example/b.txt', 0, NULL, 0), ('https://l.example/allow.txt', 1, 'Ok', 1), ('file:///etc/pihole/local.list', 1, '', 0)");
  db.run("INSERT INTO domainlist (type, domain, enabled) VALUES (0, 'allow.example', 1), (1, 'deny.example', 1), (2, '^ok\\.', 1), (3, '^ads?\\.;querytype=A', 1), (3, '^x;invert', 1), (1, 'off.example', 0)");
  db.run("INSERT INTO client (ip, comment) VALUES ('192.168.1.7', 'TV'), ('00:11:22:33:44:55', 'By MAC'), ('192.168.2.0/24', NULL)");
  db.run("INSERT INTO \"group\" (name) VALUES ('Default'), ('Kids')");
  return db;
}

test("Pi-hole's regular expressions", () => {
  expect(piholeRegex("^ads?\\.", false)).toBe("/^ads?\\./");
  expect(piholeRegex("^a;querytype=A,AAAA", true)).toBe("@@/^a/$dnstype=A|AAAA");
  expect(piholeRegex("^a;querytype=!A", false)).toBe("/^a/$dnstype=~A");
  expect(piholeRegex("^a;reply=nxdomain", false)).toBeNull();
});

test("Pi-hole's gravity.db", async () => {
  const plan = fromGravity(gravity());
  expect(plan.lists).toEqual([
    { name: "Main list", url: "https://l.example/a.txt", enabled: true, allow: false },
    { name: "l.example", url: "https://l.example/b.txt", enabled: false, allow: false },
    { name: "Ok", url: "https://l.example/allow.txt", enabled: true, allow: true },
  ]);
  expect(plan.rules).toEqual(["@@|allow.example^", "|deny.example^", "@@/^ok\\./", "/^ads?\\./$dnstype=A"]);
  expect(plan.devices).toEqual([{ address: "192.168.1.7", name: "TV", on: true }]);
  expect(plan.leftOut.map((l) => l.code).sort()).toEqual(["clientKind", "clientKind", "disabledNames", "groups", "localList", "regexOption"]);
  // every rule it made means what it meant
  const s = await list("own", plan.rules.join("\n"));
  expect(s.list.counts.broken).toBe(0);
  expect(strongest([s], none, ask("deny.example"))?.action).toBe("block");
  expect(strongest([s], none, ask("sub.deny.example"))).toBeNull();
  expect(strongest([s], none, ask("ad.example", TYPE.A))?.action).toBe("block");
  expect(strongest([s], none, ask("ad.example", TYPE.AAAA))).toBeNull();
});

test("Pi-hole 6's pihole.toml", () => {
  const plan = fromPiholeToml(`
[dns]
  upstreams = ["9.9.9.9", "149.112.112.112"]
  hosts = ["192.168.1.40 printer.lan print.lan", "fd00::4 nas.lan"]
  cnameRecords = ["a.lan,b.lan", "c.lan,d.lan,e.lan,300"]
  [dns.blocking]
    mode = "NXDOMAIN"
`);
  expect(plan.upstream).toEqual({ preset: "quad9", doh: false });
  expect(plan.mode).toBe("nxdomain");
  expect(plan.records).toEqual([{ name: "printer.lan", type: "A", value: "192.168.1.40" }, { name: "print.lan", type: "A", value: "192.168.1.40" }, { name: "nas.lan", type: "AAAA", value: "fd00::4" }]);
  expect(plan.rules).toEqual(["|a.lan^$dnsrewrite=b.lan", "|c.lan^$dnsrewrite=e.lan", "|d.lan^$dnsrewrite=e.lan"]);
  expect(fromPiholeToml(`[dns]\nupstreams = ["10.0.0.1#53"]\n[dns.blocking]\nmode = "NULL"\n`)).toMatchObject({ upstream: { servers: ["10.0.0.1"] }, mode: "zero" });
});

test("AdGuard Home's settings", () => {
  const plan = fromAdguardYaml(`
dns:
  upstream_dns:
    - tls://dns.quad9.net
    - "[/lan/]192.168.1.1"
filters:
  - enabled: true
    url: https://l.example/f.txt
    name: Filter
    id: 1
  - enabled: false
    url: /opt/data/userfilters/x.txt
    name: Local
    id: 2
whitelist_filters:
  - enabled: true
    url: https://l.example/ok.txt
    name: Ok
    id: 3
user_rules:
  - "||mine.example^"
  - "! a note"
  - "@@||ok.example^"
filtering:
  blocking_mode: nxdomain
  blocked_services:
    ids: [youtube]
  rewrites:
    - domain: nas.lan
      answer: 192.168.1.4
    - domain: "*.home.lan"
      answer: 192.168.1.5
    - domain: alias.lan
      answer: nas.lan
    - domain: keep.lan
      answer: A
clients:
  persistent:
    - name: Kid
      ids: [192.168.1.20, "aa:bb:cc:dd:ee:ff"]
      use_global_settings: false
      filtering_enabled: false
`);
  expect(plan.lists).toEqual([{ name: "Filter", url: "https://l.example/f.txt", enabled: true, allow: false }, { name: "Ok", url: "https://l.example/ok.txt", enabled: true, allow: true }]);
  expect(plan.rules).toEqual(["||mine.example^", "@@||ok.example^", "||home.lan^$dnsrewrite=192.168.1.5", "|alias.lan^$dnsrewrite=nas.lan"]);
  expect(plan.records).toEqual([{ name: "nas.lan", type: "A", value: "192.168.1.4" }]);
  expect(plan.upstream).toEqual({ preset: "quad9", doh: true });
  expect(plan.mode).toBe("nxdomain");
  expect(plan.devices).toEqual([{ address: "192.168.1.20", name: "Kid", on: false }]);
  expect(plan.leftOut.map((l) => l.code).sort()).toEqual(["clientKind", "localList", "rewriteKeep", "services", "upstreamDomain"]);
  expect(() => fromAdguardYaml("something: else")).toThrow();
});

test("a tar archive read", () => {
  const entry = (name: string, body: string) => {
    const head = new Uint8Array(512);
    head.set(new TextEncoder().encode(name));
    head.set(new TextEncoder().encode(body.length.toString(8).padStart(11, "0")), 124);
    head[156] = 0x30;
    const data = new Uint8Array(Math.ceil(body.length / 512) * 512);
    data.set(new TextEncoder().encode(body));
    return [...head, ...data];
  };
  const files = readTar(new Uint8Array([...entry("etc/pihole/custom.list", "1.2.3.4 a.lan\n"), ...entry("x.json", "[]"), ...new Array(1024).fill(0)]));
  expect(files.get("custom.list")).toBe("1.2.3.4 a.lan\n");
  expect(files.get("x.json")).toBe("[]");
});

test("what was uploaded is recognised, or refused in words", async () => {
  const entry = (name: string, body: string) => {
    const head = new Uint8Array(512);
    head.set(new TextEncoder().encode(name));
    head.set(new TextEncoder().encode(body.length.toString(8).padStart(11, "0")), 124);
    head[156] = 0x30;
    const data = new Uint8Array(Math.ceil(body.length / 512) * 512);
    data.set(new TextEncoder().encode(body));
    return [...head, ...data];
  };
  const adlist = JSON.stringify([{ address: "https://l.example/a.txt", enabled: 1, comment: "A" }]);
  const v5 = Bun.gzipSync(new Uint8Array([...entry("adlist.json", adlist), ...entry("blacklist.exact.json", JSON.stringify([{ domain: "d.example", enabled: 1 }])), ...entry("setupVars.conf", "BLOCKINGMODE=NXDOMAIN\nPIHOLE_DNS_1=1.1.1.1\n"), ...new Array(1024).fill(0)]));
  expect(await readImportFile(v5)).toMatchObject({ from: "pihole", lists: [{ url: "https://l.example/a.txt" }], rules: ["|d.example^"], mode: "nxdomain", upstream: { preset: "cloudflare" } });
  const db = gravity();
  expect(await readImportFile(db.serialize())).toMatchObject({ from: "pihole", rules: { length: 4 } });
  expect(await readImportFile(new TextEncoder().encode("filters:\n  - url: https://l.example/f.txt\n    enabled: true\n"))).toMatchObject({ from: "adguard", lists: [{ url: "https://l.example/f.txt" }] });
  await expect(readImportFile(new TextEncoder().encode("just some words"))).rejects.toMatchObject({ code: "dns.import.unknown" });
});
