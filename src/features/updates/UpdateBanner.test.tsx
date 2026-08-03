import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UpdateBanner } from "./UpdateBanner";

describe("UpdateBanner", () => {
  it("stays out of the interface when no update exists", () => {
    const { container } = render(
      <UpdateBanner status={{ state: "idle" }} restarting={false} onRestart={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows download progress", () => {
    render(
      <UpdateBanner
        status={{ state: "downloading", version: "0.1.42", downloaded: 25, total: 100 }}
        restarting={false}
        onRestart={vi.fn()}
      />,
    );

    expect(screen.getByText("Downloading Atticus 0.1.42…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });

  it("lets the user restart after installation", async () => {
    const onRestart = vi.fn();
    render(
      <UpdateBanner
        status={{ state: "ready", version: "0.1.42" }}
        restarting={false}
        onRestart={onRestart}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Restart to update" }));

    expect(onRestart).toHaveBeenCalledOnce();
  });
});
