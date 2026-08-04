import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PaletteControl } from "./PaletteControl";

describe("PaletteControl", () => {
  it("offers the original style and all six supplied colour pairs", () => {
    render(<PaletteControl value="atticus" onChange={vi.fn()} />);

    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByRole("radio", { name: /Green Yellow · Deep Twilight/ })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Wisteria Blue · Prussian Blue/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Midnight Violet · Linen/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Parchment · Vibrant Coral/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Vanilla Custard · Pine Teal/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Laser Blue · Bright Gold/ })).toBeInTheDocument();
  });

  it("reports a selected colour style", async () => {
    const onChange = vi.fn();
    render(<PaletteControl value="atticus" onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: /Vanilla Custard · Pine Teal/ }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("custard-pine");
  });

  it("marks the saved style and supports keyboard selection", async () => {
    const onChange = vi.fn();
    render(<PaletteControl value="green-twilight" onChange={onChange} />);

    const selected = screen.getByRole("radio", { name: /Green Yellow · Deep Twilight/ });
    expect(selected).toBeChecked();

    await userEvent.tab();
    expect(selected).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledExactlyOnceWith("wisteria-prussian");
  });

  it("cannot be changed while a save is in flight", async () => {
    const onChange = vi.fn();
    render(<PaletteControl value="atticus" onChange={onChange} busy />);

    await userEvent.click(screen.getByRole("radio", { name: /Laser Blue · Bright Gold/ }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
