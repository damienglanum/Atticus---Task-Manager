import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";

import { isOpenable } from "@/lib/links";

import { Markdown } from "./Markdown";

vi.mock("@/lib/ipc", () => ({ ipc: { openExternal: vi.fn() } }));

const openExternal = vi.mocked(ipc.openExternal);

beforeEach(() => {
  vi.clearAllMocks();
  openExternal.mockResolvedValue(null);
});

describe("Markdown", () => {
  it("renders ordinary markdown", () => {
    renderWithProviders(<Markdown>{"# Heading\n\nSome **bold** text."}</Markdown>);

    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("renders GitHub-style tables and task lists", () => {
    renderWithProviders(<Markdown>{"| a | b |\n| - | - |\n| 1 | 2 |"}</Markdown>);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("does not execute or render raw HTML", () => {
    // The single most important assertion in this file. If `rehype-raw` is ever
    // added, this fails — which is the point.
    const { container } = renderWithProviders(
      <Markdown>{'<script>window.pwned = true</script><b id="raw">hi</b>'}</Markdown>,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("#raw")).toBeNull();
    expect(screen.getByText(/<script>/)).toBeInTheDocument();
  });

  it("does not render an img element for a remote image", () => {
    const { container } = renderWithProviders(
      <Markdown>{"![a diagram](https://example.com/diagram.png)"}</Markdown>,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/Image not shown: a diagram/)).toBeInTheDocument();
  });

  it("opens an http link through the system browser, not in the webview", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Markdown>{"[the docs](https://tauri.app/)"}</Markdown>);

    await user.click(screen.getByRole("button", { name: "the docs" }));

    expect(openExternal).toHaveBeenCalledWith("https://tauri.app/");
    expect(document.querySelector("a")).toBeNull();
  });

  it("renders a javascript: link as inert text", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Markdown>{"[click me](javascript:alert(1))"}</Markdown>);

    expect(screen.queryByRole("button", { name: "click me" })).not.toBeInTheDocument();
    expect(screen.getByText("click me")).toBeInTheDocument();

    await user.click(screen.getByText("click me"));
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("renders a file: link as inert text", () => {
    renderWithProviders(<Markdown>{"[secrets](file:///etc/passwd)"}</Markdown>);
    expect(screen.queryByRole("button", { name: "secrets" })).not.toBeInTheDocument();
  });
});

describe("isOpenable", () => {
  it("permits only http, https and mailto", () => {
    expect(isOpenable("https://example.com")).toBe(true);
    expect(isOpenable("http://example.com")).toBe(true);
    expect(isOpenable("mailto:someone@example.com")).toBe(true);
  });

  it("refuses every other scheme, and anything malformed", () => {
    for (const href of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "not a url",
      "",
      "//example.com",
    ]) {
      expect(isOpenable(href), href).toBe(false);
    }
  });
});
