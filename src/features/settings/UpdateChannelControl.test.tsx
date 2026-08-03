import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UpdateChannelControl } from "./UpdateChannelControl";

describe("UpdateChannelControl", () => {
  it("marks the saved channel as checked", () => {
    render(<UpdateChannelControl value="main" onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /Main/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Development/ })).not.toBeChecked();
  });

  it("reports a channel change", async () => {
    const onChange = vi.fn();
    render(<UpdateChannelControl value="main" onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: /Development/ }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("dev");
  });

  it("cannot change while the preference is being saved", async () => {
    const onChange = vi.fn();
    render(<UpdateChannelControl value="main" onChange={onChange} busy />);

    await userEvent.click(screen.getByRole("radio", { name: /Development/ }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
