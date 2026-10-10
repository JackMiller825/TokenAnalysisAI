import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, isStaticDemo } from "@/lib/api";
import { emptyContext, type LaunchContext, type WalletInput } from "../../../shared/types.ts";
import { Button, Card, Input, Label, Switch, Textarea } from "@/components/ui";
import { WalletEditor } from "@/components/widgets";

export function AnalyzePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const saved = useQuery({ queryKey: ["wallets"], queryFn: api.wallets });
  const [url, setUrl] = useState(params.get("url") || "");
  const [context, setContext] = useState<LaunchContext>(emptyContext());
  const [saveList, setSaveList] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const create = useMutation({
    mutationFn: async () => {
      if (saveList) {
        await Promise.all(context.externalWallets.map((wallet) => api.saveWallet(wallet.address, "external", wallet.label || "", wallet.notes || "")));
      }
      return api.create(url, context);
    },
    onSuccess: (row) => navigate(`/reports/${row.id}`),
  });
  const savedExternal = useMemo(() => (saved.data || []).filter((wallet) => wallet.role === "external"), [saved.data]);

  function patch(partial: Partial<LaunchContext>) {
    setContext((current) => ({ ...current, ...partial }));
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-3xl font-semibold">New launch analysis</h1>
        <p className="mt-2 text-muted-foreground">Paste the pair link, optionally name wallets you know are outside the team, then start. Team wallets are optional and never assumed.</p>
      </div>
      <Card className="space-y-3 p-4">
        <Label htmlFor="pair-url">DEXTools or DexScreener pair URL</Label>
        <Input id="pair-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.dextools.io/app/ether/pair-explorer/0x…" />
      </Card>
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium">Known external wallets (not team-controlled)</h2>
            <p className="text-sm text-muted-foreground">Optional. These addresses are the only ones counted as identified outside participation.</p>
          </div>
          {savedExternal.length ? <Button type="button" variant="secondary" onClick={() => patch({ externalWallets: merge(context.externalWallets, savedExternal) })}>Apply saved list</Button> : null}
        </div>
        <WalletEditor wallets={context.externalWallets} onChange={(externalWallets) => patch({ externalWallets })} />
        <label className="flex items-center gap-2 text-sm"><Switch checked={saveList} onCheckedChange={setSaveList} /> Save this list for future analyses</label>
        <label className="flex items-start gap-2 text-sm">
          <Switch checked={context.assumptionTreatUnlistedAsTeam} onCheckedChange={(checked) => patch({ assumptionTreatUnlistedAsTeam: checked })} />
          <span>Treat wallets outside my known-external list as potentially team-associated. This is a labeled scenario. It does not change verified categories.</span>
        </label>
        {!context.externalWallets.length ? <p className="text-sm text-amber-200">External wallet ownership has not been established. Organic participation estimates are limited.</p> : null}
      </Card>
      <Card className="space-y-3 p-4">
        <button type="button" className="text-left font-medium" onClick={() => setAdvanced((value) => !value)}>{advanced ? "Hide" : "Show"} optional launch context</button>
        {advanced ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Initial liquidity note" value={context.initialLiquidityNote} onChange={(initialLiquidityNote) => patch({ initialLiquidityNote })} />
            <Field label="Marketing expenses" value={context.marketingSpendNote} onChange={(marketingSpendNote) => patch({ marketingSpendNote })} />
            <Field label="Launch timing" value={context.launchTimingNote} onChange={(launchTimingNote) => patch({ launchTimingNote })} />
            <Field label="Community size" value={context.communitySizeNote} onChange={(communitySizeNote) => patch({ communitySizeNote })} />
            <Field label="Website" value={context.website} onChange={(website) => patch({ website })} />
            <Field label="Social URLs" value={context.socials} onChange={(socials) => patch({ socials })} />
            <div className="md:col-span-2"><Label>Campaign notes</Label><Textarea value={context.campaignNotes} onChange={(event) => patch({ campaignNotes: event.target.value })} /></div>
            <div className="md:col-span-2">
              <Label>Optional team wallets</Label>
              <p className="mb-2 text-xs text-muted-foreground">Leave this empty. Unknown wallets are not marked as team.</p>
              <WalletEditor wallets={context.teamWallets} onChange={(teamWallets) => patch({ teamWallets })} />
            </div>
            <div className="md:col-span-2">
              <Label>Known bot or router wallets</Label>
              <WalletEditor wallets={context.botWallets} onChange={(botWallets) => patch({ botWallets })} />
            </div>
          </div>
        ) : null}
      </Card>
      {isStaticDemo ? <p className="text-sm text-amber-200">GitHub Pages cannot read Ethereum. Use the saved BARSTRO report from the dashboard. Start a new analysis on the local server.</p> : null}
      {create.error ? <p className="text-sm text-red-300">{(create.error as Error).message}</p> : null}
      <Button disabled={isStaticDemo || create.isPending || url.trim().length < 3} onClick={() => create.mutate()}>{create.isPending ? "Queueing…" : "Analyze launch"}</Button>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm"><span className="mb-1 block text-muted-foreground">{label}</span><Input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function merge(current: WalletInput[], saved: { address: string; label: string; notes: string }[]): WalletInput[] {
  const map = new Map(current.map((wallet) => [wallet.address, wallet]));
  for (const wallet of saved) map.set(wallet.address, { address: wallet.address, label: wallet.label, notes: wallet.notes });
  return [...map.values()];
}
