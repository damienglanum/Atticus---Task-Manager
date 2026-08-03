import { describe, expect, it } from "vitest";

import { normalizeWebUrl, webLinkName } from "./links";

describe("normalizeWebUrl", () => {
  it("adds https to an address pasted without a scheme", () => {
    expect(normalizeWebUrl("example.com/docs")).toBe("https://example.com/docs");
  });

  it("keeps complete http links and refuses unsafe schemes", () => {
    expect(normalizeWebUrl("http://localhost:3000/a")).toBe("http://localhost:3000/a");
    expect(normalizeWebUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeWebUrl("file:///tmp/private")).toBeNull();
  });
});

describe("webLinkName", () => {
  it("uses the host without a leading www", () => {
    expect(webLinkName("https://www.example.com/docs")).toBe("example.com");
  });
});
