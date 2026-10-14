import { expect, test } from "bun:test";
import { createServer, type AddressInfo } from "node:net";
import { changeConfig, DEFAULT_CONFIG, mailOf, shownConfig } from "../src/notify";
import { compose, encodeWords, EMAIL_RE, reply, sendMail } from "../src/smtp";

test("a reply of several lines is whole only at its last line", () => {
  expect(reply("250-hello\r\n250-SIZE 1\r\n")).toBeNull();
  expect(reply("250-hello\r\n250 AUTH PLAIN\r\n354 x\r\n")).toEqual({ code: 250, text: "hello\nAUTH PLAIN", rest: "354 x\r\n" });
});

test("headers in another language are encoded words of whole characters", () => {
  expect(encodeWords("Disk full")).toBe("Disk full");
  const encoded = encodeWords("Диск заповнюється — /DATA 95 %");
  for (const word of encoded.split("\r\n ")) {
    expect(word.length).toBeLessThanOrEqual(75);
    expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  }
  const back = encoded.split("\r\n ").map((w) => Buffer.from(w.slice(10, -2), "base64").toString()).join("");
  expect(back).toBe("Диск заповнюється — /DATA 95 %");
});

test("a message: headers, then the text in base64 lines", () => {
  const text = compose({ from: "hata@example.org", to: ["a@example.org", "b@example.org"], subject: "Тест", text: "один\n.два" }, new Date("2026-10-14T08:00:00Z"), "x1");
  expect(text).toContain("To: a@example.org, b@example.org\r\n");
  expect(text).toContain("Date: Wed, 14 Oct 2026 08:00:00 +0000\r\n");
  expect(text).toContain("Message-ID: <x1@example.org>\r\n");
  const body = text.split("\r\n\r\n")[1]!.replace(/\r\n/g, "");
  expect(Buffer.from(body, "base64").toString()).toBe("один\r\n.два");
  expect(text.split("\r\n").every((line) => !line.startsWith("."))).toBe(true);
});

test("addresses that could bend a header or a command are refused", () => {
  expect(EMAIL_RE.test("me@example.org")).toBe(true);
  for (const bad of ["me@example", "a b@example.org", "me@example.org\r\nBcc: x@y.z", "<me@example.org>", "me@exa_mple.org"]) expect(EMAIL_RE.test(bad)).toBe(false);
});

test("the mail settings: what must be there, and the password stays on the server", () => {
  expect(changeConfig(DEFAULT_CONFIG, { email: { enabled: true, host: "smtp.example.org" } })).toBe("notify.needMail");
  expect(changeConfig(DEFAULT_CONFIG, { email: { host: "smtp example" } })).toBe("notify.badMailHost");
  expect(changeConfig(DEFAULT_CONFIG, { email: { port: 70000 } })).toBe("notify.badMailPort");
  expect(changeConfig(DEFAULT_CONFIG, { email: { to: "me@example.org, nonsense" } })).toBe("notify.badMailAddress");
  expect(changeConfig(DEFAULT_CONFIG, { email: { password: "a\r\nb" } })).toBe("notify.badMailUser");
  const on = changeConfig(DEFAULT_CONFIG, { email: { enabled: true, host: "smtp.example.org", port: 465, security: "tls", user: "me@example.org", password: " secret ", from: "me@example.org", to: "me@example.org; you@example.org" } });
  expect(on).toMatchObject({ email: { enabled: true, port: 465, security: "tls", password: " secret ", to: ["me@example.org", "you@example.org"] } });
  const shown = shownConfig(on as typeof DEFAULT_CONFIG);
  expect(shown.email.password).toBe("");
  expect(shown.email.saved).toBe(true);
  const mail = mailOf((on as typeof DEFAULT_CONFIG).email, { title: "Disk full", text: "95%", severity: "danger", route: "#/settings/storage", tag: "t", code: "disk" }, "https://hata.example.org/");
  expect(mail.subject).toBe("[!] Disk full");
  expect(mail.text).toContain("https://hata.example.org/#/settings/storage");
});

test("a whole conversation with a server: sign-in, every recipient, the message", async () => {
  const seen: string[] = [];
  let message = "";
  const server = createServer((sock) => {
    let buf = "";
    let data = false;
    sock.write("220 test\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === ".") (data = false), sock.write("250 queued\r\n");
          else message += line + "\n";
          continue;
        }
        seen.push(line);
        if (line.startsWith("EHLO")) sock.write("250-test\r\n250 AUTH LOGIN PLAIN\r\n");
        else if (line.startsWith("AUTH PLAIN")) sock.write(Buffer.from(line.slice(11), "base64").toString() === "\0u\0p w" ? "235 ok\r\n" : "535 no\r\n");
        else if (line === "DATA") (data = true), sock.write("354 go\r\n");
        else if (line === "QUIT") sock.end("221 bye\r\n");
        else sock.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const mail = { from: "h@example.org", to: ["a@example.org", "b@example.org"], subject: "S", text: "T" };
  await sendMail({ host: "127.0.0.1", port, security: "none", user: "u", password: "p w" }, mail, "box");
  expect(seen).toEqual(["EHLO box", `AUTH PLAIN ${Buffer.from("\0u\0p w").toString("base64")}`, "MAIL FROM:<h@example.org>", "RCPT TO:<a@example.org>", "RCPT TO:<b@example.org>", "DATA", "QUIT"]);
  expect(message).toContain("Subject: S");
  await expect(sendMail({ host: "127.0.0.1", port, security: "none", user: "u", password: "wrong" }, mail)).rejects.toThrow("AUTH: 535 no");
  await expect(sendMail({ host: "127.0.0.1", port, security: "starttls", user: "", password: "" }, mail)).rejects.toThrow("does not offer STARTTLS");
  server.close();
});
