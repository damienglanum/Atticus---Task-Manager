import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThemeControl } from "./ThemeControl";

describe("ThemeControl", () => {
  it("exposes each option with an accessible name", () => {
    render(<ThemeControl value="system" onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
  });

  it("marks the current preference as checked", () => {
    render(<ThemeControl value="dark" onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });

  it("reports the chosen preference", async () => {
    const onChange = vi.fn();
    render(<ThemeControl value="system" onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("light");
  });

  it("is operable with the keyboard alone", async () => {
    const onChange = vi.fn();
    render(<ThemeControl value="light" onChange={onChange} />);

    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Light" })).toHaveFocus();

    // Arrow keys move within a radio group; this is why it is a radio group.
    await userEvent.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledExactlyOnceWith("dark");
  });

  it("cannot be changed while a save is in flight", async () => {
    const onChange = vi.fn();
    render(<ThemeControl value="system" onChange={onChange} busy />);

    await userEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
