"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

export function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sheets/sync", { method: "POST" });
      const body = await res.json();
      setMsg(body.message ?? body.error ?? (res.ok ? "Synced" : "Failed"));
    } catch {
      setMsg("Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button onClick={sync} disabled={busy} className="btn-secondary" title="Rewrite the Google Sheet from the database">
        <RefreshCw size={16} className={busy ? "animate-spin" : ""} /> Sync sheet
      </button>
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </span>
  );
}
