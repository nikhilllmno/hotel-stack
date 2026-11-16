import { describe, expect, it } from "vitest";
import { sseParser } from "../src/lib/hermes-events";

function collect() {
  const events: [string, Record<string, unknown>][] = [];
  return { events, feed: sseParser((n, d) => events.push([n, d])) };
}

describe("sseParser", () => {
  it("parses named events", () => {
    const { events, feed } = collect();
    feed('event: assistant.delta\ndata: {"delta":"Hi"}\n\nevent: run.completed\ndata: {"ok":true}\n\n');
    expect(events).toEqual([["assistant.delta", { delta: "Hi" }], ["run.completed", { ok: true }]]);
  });

  it("buffers events split across chunks, even in the middle of a line", () => {
    const { events, feed } = collect();
    feed('event: assistant.de');
    feed('lta\ndata: {"delta":');
    expect(events).toEqual([]);
    feed('"Hi"}\n');
    feed("\n");
    expect(events).toEqual([["assistant.delta", { delta: "Hi" }]]);
  });

  it("handles CRLF, a default event name and multi-line data", () => {
    const { events, feed } = collect();
    feed('data: {"a":\r\ndata: 1}\r\n\r\n');
    expect(events).toEqual([["message", { a: 1 }]]);
  });

  it("ignores comments, blocks without data and malformed JSON", () => {
    const { events, feed } = collect();
    feed(': keep-alive\n\nevent: x\n\nevent: y\ndata: not json\n\nevent: z\ndata: {"ok":1}\n\n');
    expect(events).toEqual([["z", { ok: 1 }]]);
  });
});
