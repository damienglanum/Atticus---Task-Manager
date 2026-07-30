/**
 * Runs asynchronous work strictly one at a time, in the order it was asked for.
 *
 * Moves must not overlap. Two `task_move` commands in flight together would each
 * compute an index against a board state the other is about to change, and the
 * loser writes an order the user never asked for. Serialising them is what makes
 * "fifty rapid moves leave the state implied by the last one" true (US-8 AC3).
 *
 * Deliberately a queue and not a debounce: every move is a decision the user
 * made, so none is dropped, merged, or superseded.
 */
export class SingleFlightQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  /** How many operations are queued or running. Exposed for tests and for the UI. */
  get pending(): number {
    return this.depth;
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    this.depth += 1;

    // Chained off the tail's settlement rather than its value, so one rejected
    // operation does not poison every later one.
    const result = this.tail.then(operation, operation);

    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result.finally(() => {
      this.depth -= 1;
    });
  }
}

/** The queue every task move goes through, whatever started it. */
export const moveQueue = new SingleFlightQueue();
