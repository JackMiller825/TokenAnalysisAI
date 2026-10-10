import { Card } from "@/components/ui";

const SECTIONS = [
  ["Pair resolution", "A DEXTools or DexScreener URL is parsed for the chain slug and pair address. The pair's token0, token1, factory, and getReserves calls identify a Uniswap V2 WETH pool. Pages are not scraped."],
  ["Buys and sells", "A swap that sends WETH in and the token out is a buy. The reverse is a sell. The actor is the transaction sender. Router calldata is decoded when it matches a known Uniswap V2 swap method, because the Swap event's recipient is often the router."],
  ["Reserves", "Sync events are the post-state. Ending WETH = mint deposits + buy inflows + direct WETH in − burn withdrawals − sell outflows − direct WETH out. The 0.30% fee remains inside the input amount. The result is compared with the last Sync and the pair's WETH balance."],
  ["Price and FDV", "Spot price is reserve WETH ÷ reserve tokens, adjusted for decimals. FDV is that price times total supply. USD multiplies the WETH amount by a DefiLlama ETH/USD print and is labeled an estimate."],
  ["Immediate impact", "Impact is the reserve price after a swap divided by the reserve price before that same swap, minus one. Later candles are separate swaps."],
  ["Known external wallets", "Only addresses you enter are known external. Known external buy volume % = their buy WETH ÷ all buy WETH. Known external buyer share % = their buying addresses ÷ all buying addresses. Net flow = their WETH buy inputs − their WETH sell outputs. Net flow is not profit."],
  ["Other categories", "Confirmed team requires your label. Suspected related requires a direct token transfer with the launch operator, and the reason is shown. Known contract means bytecode or a public router. Everyone else is unclassified. Similar times, similar sizes, the same router, or a shared exchange deposit do not create a relationship."],
  ["Assumption scenario", "The switch that treats unlisted wallets as potentially team-associated is computed separately and labeled as an assumption. It does not rewrite categories."],
  ["Realized PnL", "Average cost uses WETH spent and tokens bought on this pool. It is withheld when transfers or extra sales break that inventory. Gas is summed from receipts and kept separate. Unrealized inventory is not called profit."],
  ["LP custody", "LP tokens at the burn address cannot call removeLiquidity. That does not stop sells from reducing WETH reserves. Burn events are counted separately from LP transfers."],
  ["Scores", "Each score shows its formula. A missing input is Not Assessed. The average of scored categories is not a safety rating and not a prediction."],
  ["Safety", "Unverified bytecode does not receive a safety rating. Selector matches inside bytecode are hints and can be coincidences."],
];

export function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-3xl font-semibold">Methodology and definitions</h1>
      <p className="text-muted-foreground">Every financial figure in a report comes from decoded logs, transaction senders, and contract calls. The narrative repeats those figures. An optional model may only rephrase them and is discarded if it introduces an unknown address or hash.</p>
      {SECTIONS.map(([title, body]) => <Card key={title} className="p-4"><h2 className="font-medium">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p></Card>)}
    </div>
  );
}
