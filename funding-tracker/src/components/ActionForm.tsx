"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/actions/clubs";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/** A <form> bound to a server action that shows the action's error (or a brief success note) inline. */
export function ActionForm({
  action,
  children,
  className,
  successText,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  successText?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state && !state.ok && <p className="mt-1 text-xs text-red-700">{state.error}</p>}
      {state && state.ok && successText && <p className="mt-1 text-xs text-green-700">{successText}</p>}
    </form>
  );
}
