import { describe, expect, it } from "vitest";

import { SingleFlightQueue } from "./singleFlight";

/** A promise whose settlement the test controls. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<undefined>((settle) => {
    resolve = () => {
      settle(undefined);
    };
  });
  return { promise, resolve };
}

describe("SingleFlightQueue", () => {
  it("never runs two operations at once", async () => {
    const queue = new SingleFlightQueue();
    let running = 0;
    let peak = 0;

    const operation = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
    };

    await Promise.all(Array.from({ length: 20 }, () => queue.run(operation)));

    expect(peak).toBe(1);
  });

  it("runs operations in the order they were queued", async () => {
    const queue = new SingleFlightQueue();
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 50 }, (_unused, index) =>
        queue.run(async () => {
          await Promise.resolve();
          order.push(index);
        }),
      ),
    );

    expect(order).toEqual(Array.from({ length: 50 }, (_unused, index) => index));
  });

  it("keeps going after one operation rejects", async () => {
    // A failed move must not wedge every later move — that would turn one
    // transient error into a board nobody can reorder until they restart.
    const queue = new SingleFlightQueue();
    const done: string[] = [];

    const failing = queue.run(() => Promise.reject(new Error("nope")));
    const after = queue.run(async () => {
      await Promise.resolve();
      done.push("after");
    });

    await expect(failing).rejects.toThrow("nope");
    await after;

    expect(done).toEqual(["after"]);
  });

  it("does not start a queued operation until the one before it settles", async () => {
    const queue = new SingleFlightQueue();
    const gate = deferred();
    let secondStarted = false;

    const first = queue.run(() => gate.promise);
    const second = queue.run(async () => {
      secondStarted = true;
      await Promise.resolve();
    });

    await Promise.resolve();
    expect(secondStarted).toBe(false);

    gate.resolve();
    await first;
    await second;
    expect(secondStarted).toBe(true);
  });

  it("reports how much work is outstanding", async () => {
    const queue = new SingleFlightQueue();
    const gate = deferred();

    const first = queue.run(() => gate.promise);
    const second = queue.run(() => Promise.resolve());

    expect(queue.pending).toBe(2);

    gate.resolve();
    await Promise.all([first, second]);

    expect(queue.pending).toBe(0);
  });
});
