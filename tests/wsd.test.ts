import { expect, test } from "bun:test";
import { answer, bye, describe, deviceId, escapeXml, hello, readMessage, type Device } from "../src/wsd";

const device = (): Device => ({ id: deviceId("machine"), name: "hata", sequence: { instance: 1700000000, message: 0 } });
const urn = `urn:uuid:${deviceId("machine")}`;

/** A request as Windows sends it: its own prefixes, the fields spread over lines */
const request = (action: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:wsdp="http://schemas.xmlsoap.org/ws/2006/02/devprof">
  <soap:Header>
    <wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>
    <wsa:Action soap:mustUnderstand="true">${action}</wsa:Action>
    <wsa:MessageID>
      urn:uuid:11111111-2222-3333-4444-555555555555
    </wsa:MessageID>
  </soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;

const PROBE = "http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe";
const RESOLVE = "http://schemas.xmlsoap.org/ws/2005/04/discovery/Resolve";
const GET = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Get";

test("the id of the device lasts and has the shape of a UUID", () => {
  expect(deviceId("machine")).toBe(deviceId("machine"));
  expect(deviceId("machine")).not.toBe(deviceId("another"));
  expect(deviceId("machine")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("a request is read whatever its prefixes; what is not a request is nothing", () => {
  expect(readMessage(request(PROBE, "<wsd:Probe><wsd:Types>wsdp:Device</wsd:Types></wsd:Probe>"))).toEqual({ action: PROBE, id: "urn:uuid:11111111-2222-3333-4444-555555555555", types: ["Device"], scoped: false, address: "" });
  const other = `<s:Envelope><s:Header><a:Action>${PROBE}</a:Action><a:MessageID>urn:uuid:1</a:MessageID></s:Header><s:Body><d:Probe><d:Types>p:Device  q:PrintDeviceType</d:Types><d:Scopes>ldap:///ou=x</d:Scopes></d:Probe></s:Body></s:Envelope>`;
  expect(readMessage(other)).toMatchObject({ types: ["Device", "PrintDeviceType"], scoped: true });
  expect(readMessage("<Envelope/>")).toBeNull();
  expect(readMessage("not xml at all")).toBeNull();
  // an id that could not be put back into an answer as it is
  expect(readMessage(`<a:Action>${PROBE}</a:Action><a:MessageID>urn:uuid:1"x</a:MessageID>`)).toBeNull();
});

test("who looks for devices or computers is answered; who looks for something else is not", () => {
  const probe = (types: string) => readMessage(request(PROBE, types ? `<wsd:Probe><wsd:Types>${types}</wsd:Types></wsd:Probe>` : "<wsd:Probe/>"))!;
  const reply = answer(device(), probe("wsdp:Device"), "192.168.1.20")!;
  expect(reply).toContain("<wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</wsa:Action>");
  expect(reply).toContain("<wsa:RelatesTo>urn:uuid:11111111-2222-3333-4444-555555555555</wsa:RelatesTo>");
  expect(reply).toContain(`<wsa:Address>${urn}</wsa:Address>`);
  expect(reply).toContain("<wsd:Types>wsdp:Device pub:Computer</wsd:Types>");
  expect(reply).toContain(`<wsd:XAddrs>http://192.168.1.20:5357/${deviceId("machine")}</wsd:XAddrs>`);
  expect(answer(device(), probe("pub:Computer"), "10.0.0.2")).not.toBeNull();
  expect(answer(device(), probe(""), "10.0.0.2")).not.toBeNull();
  expect(answer(device(), probe("wsdp:Device wprt:PrintDeviceType"), "10.0.0.2")).toBeNull();
  expect(answer(device(), readMessage(request(PROBE, "<wsd:Probe><wsd:Types>wsdp:Device</wsd:Types><wsd:Scopes>ldap:///ou=x</wsd:Scopes></wsd:Probe>"))!, "10.0.0.2")).toBeNull();
});

test("where a device is, is told only for this one", () => {
  const resolve = (address: string) => readMessage(request(RESOLVE, `<wsd:Resolve><wsa:EndpointReference><wsa:Address>${address}</wsa:Address></wsa:EndpointReference></wsd:Resolve>`))!;
  const reply = answer(device(), resolve(urn), "10.0.0.2")!;
  expect(reply).toContain("/discovery/ResolveMatches</wsa:Action>");
  expect(reply).toContain(`<wsd:XAddrs>http://10.0.0.2:5357/${deviceId("machine")}</wsd:XAddrs>`);
  expect(answer(device(), resolve("urn:uuid:00000000-0000-0000-0000-000000000000"), "10.0.0.2")).toBeNull();
  expect(answer(device(), readMessage(request(GET, ""))!, "10.0.0.2")).toBeNull();
});

test("the description names the computer; messages of a run are counted", () => {
  const one = device();
  const text = describe({ ...one, name: `a<b&"c` }, readMessage(request(GET, ""))!)!;
  expect(text).toContain("<wsa:Action>http://schemas.xmlsoap.org/ws/2004/09/transfer/GetResponse</wsa:Action>");
  expect(text).toContain("<pub:Computer>a&lt;b&amp;&quot;c/Workgroup:WORKGROUP</pub:Computer>");
  expect(text).toContain("<wsa:RelatesTo>urn:uuid:11111111-2222-3333-4444-555555555555</wsa:RelatesTo>");
  expect(describe(one, readMessage(request(PROBE, "<wsd:Probe/>"))!)).toBeNull();
  expect(escapeXml(`<'>`)).toBe("&lt;&apos;&gt;");
  expect(hello(one, "10.0.0.2")).toContain('<wsd:AppSequence InstanceId="1700000000" MessageNumber="1"/>');
  expect(hello(one, "10.0.0.2")).toContain(`<wsd:XAddrs>http://10.0.0.2:5357/${one.id}</wsd:XAddrs>`);
  expect(bye(one)).toContain('MessageNumber="3"/>');
  expect(bye(one)).toContain(`<wsd:Bye><wsa:EndpointReference><wsa:Address>${urn}</wsa:Address>`);
});
