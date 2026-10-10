import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input, Label, Textarea } from "@/components/ui";

export function SettingsPage() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const [form, setForm] = useState({ rpcUrls: "", etherscanApiKey: "", aiBaseUrl: "", aiApiKey: "", aiModel: "" });
  useEffect(() => { if (settings.data) setForm({ rpcUrls: settings.data.rpcUrls, etherscanApiKey: settings.data.etherscanApiKey, aiBaseUrl: settings.data.aiBaseUrl, aiApiKey: settings.data.aiApiKey, aiModel: settings.data.aiModel }); }, [settings.data]);
  const save = useMutation({ mutationFn: () => api.saveSettings(form), onSuccess: () => client.invalidateQueries({ queryKey: ["settings"] }) });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-3xl font-semibold">Settings and API keys</h1>
      <Card className="space-y-2 p-4 text-sm">
        <div>API health: {health.data ? (health.data.ok ? "Postgres and Redis are reachable." : `Degraded. Postgres: ${health.data.postgres}. Redis: ${health.data.redis}.`) : "Checking…"}</div>
        <p className="text-muted-foreground">Public Ethereum RPCs are used when the list below is empty. Older launches need an archive endpoint. Keys stay on the server and are masked when read back.</p>
      </Card>
      <Card className="space-y-3 p-4">
        <Label>RPC URLs, comma-separated</Label>
        <Textarea value={form.rpcUrls} onChange={(event) => setForm({ ...form, rpcUrls: event.target.value })} placeholder="https://ethereum.publicnode.com" />
        <Label>Etherscan API key</Label>
        <Input value={form.etherscanApiKey} onChange={(event) => setForm({ ...form, etherscanApiKey: event.target.value })} placeholder="Optional, for source verification" />
        <Label>AI base URL</Label>
        <Input value={form.aiBaseUrl} onChange={(event) => setForm({ ...form, aiBaseUrl: event.target.value })} placeholder="https://api.openai.com/v1" />
        <Label>AI API key</Label>
        <Input value={form.aiApiKey} onChange={(event) => setForm({ ...form, aiApiKey: event.target.value })} placeholder="Optional. Calculations stay deterministic." />
        <Label>Model</Label>
        <Input value={form.aiModel} onChange={(event) => setForm({ ...form, aiModel: event.target.value })} />
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save settings</Button>
        {save.isSuccess ? <p className="text-sm text-emerald-300">Saved.</p> : null}
        {save.error ? <p className="text-sm text-red-300">{(save.error as Error).message}</p> : null}
      </Card>
    </div>
  );
}
