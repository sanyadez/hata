import { expect, test } from "bun:test";
import { address, encodePart, parseError, parseList, partSize, sign } from "../src/s3";

// the examples of the protocol's own documentation
const amazon = { endpoint: "", region: "us-east-1", bucket: "examplebucket", accessKey: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const at = new Date("2013-05-24T00:00:00Z");

test("a request is signed as the protocol's documentation signs it", async () => {
  const get = await sign("GET", new URL("https://examplebucket.s3.amazonaws.com/test.txt"), { Range: "bytes=0-9" }, EMPTY, amazon, at);
  expect(get.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  expect(get["x-amz-date"]).toBe("20130524T000000Z");
  const listed = await sign("GET", new URL("https://examplebucket.s3.amazonaws.com/" + address(amazon, "", { "max-keys": "2", prefix: "J" }).search), {}, EMPTY, amazon, at);
  expect(listed.authorization).toEndWith("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
});

test("the address of a file: the bucket in the path for a named service, in the host name for Amazon", () => {
  expect(address({ endpoint: "http://192.168.1.5:9000", region: "us-east-1", bucket: "home" }, "copies/memos/1.tar.gz").href).toBe("http://192.168.1.5:9000/home/copies/memos/1.tar.gz");
  expect(address({ endpoint: "https://s3.example.com/base", region: "x", bucket: "home" }, "").href).toBe("https://s3.example.com/base/home/");
  expect(address(amazon, "a/b c+d.json").href).toBe("https://examplebucket.s3.us-east-1.amazonaws.com/a/b%20c%2Bd.json");
  expect(address({ ...amazon, bucket: "my.home" }, "a").href).toBe("https://s3.us-east-1.amazonaws.com/my.home/a");
  // the query in the order the signature needs, with nothing left for the server to read its own way
  expect(address(amazon, "k", { uploadId: "a/b=", partNumber: "2" }).search).toBe("?partNumber=2&uploadId=a%2Fb%3D");
  expect(address(amazon, "k", { uploads: "" }).search).toBe("?uploads=");
  expect(encodePart("a!b'c(d)e*f~g")).toBe("a%21b%27c%28d%29e%2Af~g");
});

test("a listing is read page by page", () => {
  const page = `<?xml version="1.0"?><ListBucketResult><Name>home</Name><IsTruncated>true</IsTruncated><Contents><Key>copies/memos/1.tar.gz</Key><Size>5</Size></Contents><Contents><ETag>&quot;x&quot;</ETag><Key>copies/a &amp; b/2.json</Key></Contents><NextContinuationToken>1ue/x==</NextContinuationToken></ListBucketResult>`;
  expect(parseList(page)).toEqual({ keys: ["copies/memos/1.tar.gz", "copies/a & b/2.json"], next: "1ue/x==" });
  expect(parseList("<ListBucketResult><IsTruncated>false</IsTruncated><KeyCount>0</KeyCount></ListBucketResult>")).toEqual({ keys: [], next: "" });
});

test("a refusal is told with the service's own code", () => {
  const error = parseError(403, "<Error><Code>AccessDenied</Code><Message>Access Denied.</Message></Error>");
  expect([error.code, error.message]).toEqual(["AccessDenied", "Access Denied."]);
  expect(parseError(502, "Bad gateway").code).toBe("HTTP 502");
});

test("parts are 16 MB until the file needs more than the parts allowed", () => {
  const MB = 1024 * 1024;
  expect(partSize(5 * MB)).toBe(16 * MB);
  expect(partSize(100_000 * MB)).toBe(16 * MB);
  expect(partSize(1_000_000 * MB)).toBe(112 * MB);
  expect(Math.ceil((5_000_000 * MB) / partSize(5_000_000 * MB))).toBeLessThanOrEqual(10_000);
});
