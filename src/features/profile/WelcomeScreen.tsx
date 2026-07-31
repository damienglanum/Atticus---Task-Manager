import { ArrowRight } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/Button";
import { LIMITS } from "@/lib/schemas";

interface WelcomeScreenProps {
  onSubmit: (name: string) => void;
  pending: boolean;
}

/**
 * First run. The one screen in the application that is not the workspace.
 *
 * It asks for a name and nothing else, and it says why in the line underneath —
 * an unexplained text field on a first launch reads as a sign-up, which is the
 * one thing this application never does. The footer is there for the same
 * reason: the name is going into a SQLite file on this machine, and a person
 * who has just been asked for personal detail deserves to be told that without
 * having to go looking.
 */
export function WelcomeScreen({ onSubmit, pending }: WelcomeScreenProps) {
  const [name, setName] = useState("");
  const ready = name.trim() !== "";

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (ready && !pending) onSubmit(name);
  }

  return (
    <div className="bg-surface-app flex h-full flex-col">
      <div className="flex flex-1 items-center justify-center px-6">
        <form onSubmit={submit} className="w-full max-w-md">
          <h1 className="text-fg-primary text-4xl font-normal tracking-[-0.02em]">Welcome.</h1>
          <p className="text-fg-secondary mt-4 text-lg leading-relaxed">
            Please share your name to begin personalising your workspace.
          </p>

          <div className="mt-12">
            {/*
              A bottom rule rather than a box. This is the only field on the
              screen and nothing competes with it, so the border that would
              normally separate it from its neighbours has no work to do.
            */}
            <label htmlFor="profile-name" className="sr-only">
              Full name
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              ref={(element) => {
                // See the note in TaskEditor: focused on mount rather than with
                // `autoFocus`, so the heading is announced first.
                element?.focus();
              }}
              autoComplete="name"
              maxLength={LIMITS.profileName}
              placeholder="Full name"
              onChange={(event) => {
                setName(event.target.value);
              }}
              className="border-border-default text-fg-primary placeholder:text-fg-secondary w-full border-b bg-transparent px-1 py-2 text-lg"
            />
          </div>

          <div className="mt-10 flex justify-end">
            <Button type="submit" variant="primary" disabled={!ready || pending}>
              {pending ? "Setting up…" : "Continue"}
              <ArrowRight size={15} aria-hidden />
            </Button>
          </div>
        </form>
      </div>

      <p className="text-fg-secondary pb-8 text-center text-2xs">
        Everything stays on this computer. Atticus has no account and no server.
      </p>
    </div>
  );
}
