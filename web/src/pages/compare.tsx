import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card } from "@/components/ui";

const BARSTRO = "0x0d108526a484eb7927e593fd41d8a8823fc35650";

export function ComparePage() {
  const history = useQuery({ queryKey: ["analyses"], queryFn: api.analyses });
  const [selected, setSelected] = useState<string[]>([]);
  const comparison = useQuery({ queryKey: ["compare", selected], queryFn: () => api.compare(selected), enabled: selected.length >= 2 });
  const completed = (history.data || []).filter((row) => row.status === "completed");
  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-4));
  }
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-3xl font-semibold">Launch comparison</h1>
      <p className="text-muted-foreground">Select completed reports. Changes are described as higher or lower. They are not treated as causes.</p>
      <div className="flex flex-wrap gap-2">
        {completed.map((row) => (
          <Button key={row.id} type="button" variant={selected.includes(row.id) ? "default" : "outline"} onClick={() => toggle(row.id)}>
            {row.tokenSymbol || "Token"} {row.pairAddress.toLowerCase() === BARSTRO ? "· BARSTRO reference" : ""}
          </Button>
        ))}
        {!completed.length ? <p className="text-sm text-muted-foreground">Finish at least two analyses, including BARSTRO if you want that reference.</p> : null}
      </div>
      {comparison.isLoading ? <p className="text-sm text-muted-foreground">Comparing…</p> : null}
      {comparison.error ? <p className="text-sm text-red-300">{(comparison.error as Error).message}</p> : null}
      {comparison.data ? (
        <Card className="overflow-auto p-4">
          <table className="w-full text-left text-sm">
            <thead><tr><th className="py-2">Metric</th>{selected.map((id) => <th key={id} className="py-2">{completed.find((row) => row.id === id)?.tokenSymbol}</th>)}</tr></thead>
            <tbody>
              {comparison.data.metrics.map((metric) => (
                <tr key={metric.label} className="border-t border-border"><td className="py-2">{metric.label}</td>{metric.values.map((value, index) => <td key={index} className="py-2">{value ?? "—"}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div><h2 className="font-medium">Higher on the last report</h2><ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{comparison.data.improved.map((item) => <li key={item}>{item}</li>)}{!comparison.data.improved.length ? <li>No measured increase.</li> : null}</ul></div>
            <div><h2 className="font-medium">Lower on the last report</h2><ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{comparison.data.deteriorated.map((item) => <li key={item}>{item}</li>)}{!comparison.data.deteriorated.length ? <li>No measured decrease.</li> : null}</ul></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{comparison.data.caveat}</p>
        </Card>
      ) : null}
    </div>
  );
}
