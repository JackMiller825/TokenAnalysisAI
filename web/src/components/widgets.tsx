import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { WalletInput } from "../../../shared/types.ts";
import { CATEGORY_COLOR, categoryLabel, formatTime, shortAddr } from "@/lib/format";
import { useUi } from "@/store/ui";
import { Badge, Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

export function TxLink({ hash, children }: { hash?: string | null; children?: React.ReactNode }) {
  if (!hash) return <span>—</span>;
  return (
    <a className="mono inline-flex items-center gap-1 text-cyan-300 hover:underline" href={`https://etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">
      {children ?? shortAddr(hash)} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function Addr({ address }: { address?: string | null }) {
  if (!address) return <span>—</span>;
  return (
    <a className="mono text-cyan-100 hover:underline" href={`https://etherscan.io/address/${address}`} target="_blank" rel="noreferrer">
      {shortAddr(address)}
    </a>
  );
}

export function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-black/20 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function CategoryPill({ category }: { category: string }) {
  return <Badge style={{ color: CATEGORY_COLOR[category] || "#cbd5e1", borderColor: `${CATEGORY_COLOR[category] || "#334155"}55` }}>{categoryLabel(category)}</Badge>;
}

export function Confidence({ value }: { value: string }) {
  const label = value.replaceAll("_", " ");
  return <Badge className="capitalize">{label}</Badge>;
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <div className="text-lg font-medium">{title}</div>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export function Time({ unix }: { unix: number | null | undefined }) {
  const timeZone = useUi((state) => state.timeZone);
  return <span title="Displayed in the timezone selected in the header. Stored timestamps are UTC.">{formatTime(unix, timeZone)}</span>;
}

const ADDRESS = /0x[a-fA-F0-9]{40}/g;

export function WalletEditor({ wallets, onChange }: { wallets: WalletInput[]; onChange: (wallets: WalletInput[]) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const known = useMemo(() => new Set(wallets.map((wallet) => wallet.address.toLowerCase())), [wallets]);

  function addText(text: string) {
    const found = text.match(ADDRESS) ?? [];
    if (!found.length) {
      setError("No Ethereum addresses were found in that text.");
      return;
    }
    const next = [...wallets];
    for (const address of found) {
      const key = address.toLowerCase();
      if (known.has(key) || next.some((wallet) => wallet.address === key)) continue;
      next.push({ address: key, label: "", notes: "" });
    }
    onChange(next);
    setDraft("");
    setError("");
  }

  return (
    <div className="space-y-3">
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Paste addresses separated by commas, spaces, or new lines" className="min-h-24 w-full rounded-md border border-input bg-black/20 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => addText(draft)}>Add addresses</Button>
        <label className="inline-flex h-10 cursor-pointer items-center rounded-md border border-border px-3 text-sm hover:bg-white/5">
          Import CSV or TXT
          <input type="file" accept=".csv,.txt,text/plain" className="hidden" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            addText(await file.text());
            event.target.value = "";
          }} />
        </label>
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <div className="space-y-2">
        {wallets.map((wallet) => (
          <div key={wallet.address} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[180px_1fr_1fr_auto]">
            <div className="mono self-center text-xs text-cyan-100">{shortAddr(wallet.address)}</div>
            <Input value={wallet.label || ""} placeholder="Label, optional" onChange={(event) => onChange(wallets.map((item) => item.address === wallet.address ? { ...item, label: event.target.value } : item))} />
            <Input value={wallet.notes || ""} placeholder="Note, optional" onChange={(event) => onChange(wallets.map((item) => item.address === wallet.address ? { ...item, notes: event.target.value } : item))} />
            <Button type="button" variant="ghost" onClick={() => onChange(wallets.filter((item) => item.address !== wallet.address))}>Remove</Button>
          </div>
        ))}
        {!wallets.length ? <p className="text-sm text-muted-foreground">No known external wallets yet. An analysis still runs without them.</p> : null}
      </div>
    </div>
  );
}

export function DataTable({ columns, rows, onRow }: { columns: { key: string; label: string; className?: string }[]; rows: Record<string, React.ReactNode>[]; onRow?: (index: number) => void }) {
  return (
    <div className="overflow-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-black/30 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>{columns.map((column) => <th key={column.key} className={cn("px-3 py-2 font-medium", column.className)}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={cn("border-t border-border/70", onRow && "cursor-pointer hover:bg-white/5")} onClick={() => onRow?.(index)}>
              {columns.map((column) => <td key={column.key} className="px-3 py-2 align-top">{row[column.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
