import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Card } from "@/components/ui";
import { Empty } from "@/components/widgets";
import { shortAddr } from "@/lib/format";

export function HistoryPage() {
  const navigate = useNavigate();
  const history = useQuery({ queryKey: ["analyses"], queryFn: api.analyses });
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-3xl font-semibold">Historical reports</h1>
      {history.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {history.error ? <p className="text-sm text-red-300">{(history.error as Error).message}</p> : null}
      {history.data?.length === 0 ? <Empty title="No saved analyses" body="Completed and in-progress jobs appear here. Start one from New analysis." /> : null}
      <div className="space-y-2">
        {history.data?.map((row) => (
          <Card key={row.id} className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4 hover:bg-white/5" onClick={() => navigate(`/reports/${row.id}`)}>
            <div>
              <div className="font-medium">{row.tokenSymbol || "Pair"} / {row.quoteSymbol || "quote"}</div>
              <div className="mono text-xs text-muted-foreground">{row.pairAddress ? shortAddr(row.pairAddress) : row.sourceUrl}</div>
            </div>
            <div className="text-right text-sm">
              <div className="uppercase text-muted-foreground">{row.status}</div>
              <div className="text-xs text-muted-foreground">{new Date(row.createdAt).toISOString()}</div>
              {row.error ? <div className="max-w-sm text-xs text-red-300">{row.error}</div> : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
