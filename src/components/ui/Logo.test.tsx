import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Wordmark } from "./Logo";

describe("Wordmark", () => {
  it("uses the prominent compact mark and keeps the full lockup together", () => {
    const { container } = render(<Wordmark />);
    const mark = container.querySelector("svg");

    expect(screen.getByText("Atticus")).toBeInTheDocument();
    expect(screen.getByText("Local workspace")).toBeInTheDocument();
    expect(mark).toHaveAttribute("width", "36");
    expect(mark).toHaveAttribute("height", "36");
    expect(mark?.querySelectorAll("path")).toHaveLength(3);
  });
});
