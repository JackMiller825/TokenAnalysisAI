import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";
import { shortAddr } from "@/lib/format";

const BARSTRO = "https://www.dextools.io/app/ether/pair-explorer/0x0d108526a484eb7927e593fd41d8a8823fc35650";

export function HomePage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const history = useQuery({ queryKey: ["analyses"], queryFn: api.analyses });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-sm text-cyan-300">Token launch investigation</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">What happened to the pool, and which wallets did it?</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">Paste a DEXTools or DexScreener pair URL. LaunchForensics reads the Uniswap V2 events, reconciles WETH reserves, and separates wallets you know are outside the team from everyone else. It does not scrape DEXTools and it does not invent holder counts.</p>
      </div>
      <Card className="p-4 md:p-5">
        <form className="flex flex-col gap-3 md:flex-row" onSubmit={(event) => { event.preventDefault(); navigate(`/analyze?url=${encodeURIComponent(url || BARSTRO)}`); }}>
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.dextools.io/app/ether/pair-explorer/0x…" aria-label="DEXTools pair URL" />
          <Button type="submit">Analyze launch</Button>
          <Button type="button" variant="secondary" onClick={() => navigate(`/analyze?url=${encodeURIComponent(BARSTRO)}`)}>Use BARSTRO pair</Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">The BARSTRO button fills the reference pair URL only. Conclusions are calculated from the chain when the job runs.</p>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["Reserve accounting", "Ending WETH is initial liquidity plus inflows minus outflows, checked against Sync reserves and the ERC-20 balance."],
          ["Known external wallets", "You list the addresses that are not team-controlled. Everyone else stays unclassified unless a direct transfer supports a suspicion."],
          ["LP burn is not a freeze", "Burned LP tokens block removeLiquidity. Swaps can still empty the WETH side. The report keeps those paths separate."],
        ].map(([title, body]) => (
          <Card key={title} className="p-4"><h2 className="font-medium">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{body}</p></Card>
        ))}
      </div>
      <Card className="p-4">
        <h2 className="font-medium">Recent reports</h2>
        <div className="mt-3 space-y-2">
          {history.isLoading ? <p className="text-sm text-muted-foreground">Loading saved analyses…</p> : null}
          {history.error ? <p className="text-sm text-red-300">{(history.error as Error).message}</p> : null}
          {history.data?.length === 0 ? <p className="text-sm text-muted-foreground">No analyses yet. The first one is stored here after it finishes.</p> : null}
          {history.data?.map((row) => (
            <button key={row.id} className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left hover:bg-white/5" onClick={() => navigate(`/reports/${row.id}`)}>
              <span>{row.tokenSymbol || "Unresolved"} / {row.quoteSymbol || "quote"} <span className="mono text-xs text-muted-foreground">{shortAddr(row.pairAddress)}</span></span>
              <span className="text-xs uppercase text-muted-foreground">{row.status}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
