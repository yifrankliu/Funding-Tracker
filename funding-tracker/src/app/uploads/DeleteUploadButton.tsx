"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { deleteUpload } from "@/actions/uploads";

export function DeleteUploadButton({ uploadId, label }: { uploadId: string; label: string }) {
  const [state, action, pending] = useActionState(deleteUpload, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Delete this upload (${label})?\n\nIts allocations are removed from the master sheet. If it replaced an earlier upload for the same period, that one is restored.`)) {
          e.preventDefault();
        }
      }}
      className="inline"
    >
      <input type="hidden" name="upload_id" value={uploadId} />
      <button disabled={pending} className="text-slate-400 hover:text-red-600 disabled:opacity-50" title="Delete upload">
        <Trash2 size={16} />
      </button>
      {state && !state.ok && <span className="ml-1 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
