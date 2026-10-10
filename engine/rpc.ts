export class RpcRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcRangeError";
  }
}

export class ProviderLimitation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderLimitation";
  }
}

export const DEFAULT_RPCS = [
  "https://ethereum.publicnode.com",
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.mevblocker.io",
  "https://mainnet.gateway.tenderly.co",
  "https://eth.drpc.org",
];

type JsonRpc = { id?: number; result?: unknown; error?: { message?: string } };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RpcPool {
  private cursor = 0;
  readonly urls: string[];

  constructor(
    urls: string[] | undefined,
    private fetchImpl: typeof fetch = fetch,
    private timeoutMs = 15_000,
  ) {
    const cleaned = (urls ?? []).map((url) => url.trim()).filter(Boolean);
    this.urls = cleaned.length ? cleaned : [...DEFAULT_RPCS];
  }

  private async request(url: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") throw new Error(`RPC ${new URL(url).host} did not respond.`);
      throw error;
    }
    const text = await response.text();
    if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) {
      throw new Error(`RPC ${new URL(url).host} returned a non-JSON response (${response.status}).`);
    }
    return JSON.parse(text);
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    let last = "RPC request failed.";
    for (let attempt = 0; attempt < this.urls.length * 2; attempt++) {
      const url = this.urls[(this.cursor + attempt) % this.urls.length];
      try {
        const json = (await this.request(url, { jsonrpc: "2.0", id: 1, method, params })) as JsonRpc;
        if (json.error) {
          last = json.error.message || "RPC error";
          if (/range|archive|history|pruned|10 block|10000 blocks/i.test(last)) throw new RpcRangeError(last);
          await sleep(/rate|limit|429|too many/i.test(last) ? 500 * (attempt + 1) : 120 * (attempt + 1));
          continue;
        }
        this.cursor = (this.cursor + attempt) % this.urls.length;
        return json.result as T;
      } catch (error) {
        if (error instanceof RpcRangeError) throw error;
        last = error instanceof Error ? error.message : String(error);
        await sleep(150 * (attempt + 1));
      }
    }
    throw new Error(last);
  }

  async batch(calls: { method: string; params: unknown[] }[], size = 25): Promise<unknown[]> {
    const results: unknown[] = [];
    for (let offset = 0; offset < calls.length; offset += size) {
      const chunk = calls.slice(offset, offset + size);
      let parsed: unknown[] | null = null;
      let last = "";
      for (let attempt = 0; attempt < this.urls.length; attempt++) {
        const url = this.urls[(this.cursor + attempt) % this.urls.length];
        try {
          const body = chunk.map((call, index) => ({ jsonrpc: "2.0", id: index, method: call.method, params: call.params }));
          const json = await this.request(url, body);
          const rows = (Array.isArray(json) ? json : [json]) as JsonRpc[];
          if (rows.length !== chunk.length) throw new Error("Batch response length did not match the request.");
          rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
          const errored = rows.find((row) => row.error);
          if (errored?.error) throw new Error(errored.error.message || "Batch item failed");
          parsed = rows.map((row) => row.result);
          this.cursor = (this.cursor + attempt) % this.urls.length;
          break;
        } catch (error) {
          last = error instanceof Error ? error.message : String(error);
          if (/range|archive/i.test(last)) break;
        }
      }
      if (!parsed) {
        for (const call of chunk) results.push(await this.call(call.method, call.params));
      } else {
        results.push(...parsed);
      }
      if (last && !parsed) {
        // single-call fallback already attempted inside the loop's failure path
      }
    }
    return results;
  }
}

export interface EthLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  blockHash?: string;
  removed?: boolean;
}

export async function getLogs(
  rpc: RpcPool,
  filter: { address: string; topics?: (string | null)[]; fromBlock: number; toBlock: number },
): Promise<EthLog[]> {
  const collected: EthLog[] = [];
  const queue: [number, number][] = [[filter.fromBlock, filter.toBlock]];
  while (queue.length) {
    const [from, to] = queue.shift()!;
    if (from > to) continue;
    try {
      const logs = await rpc.call<EthLog[]>("eth_getLogs", [
        {
          address: filter.address,
          topics: filter.topics,
          fromBlock: "0x" + from.toString(16),
          toBlock: "0x" + to.toString(16),
        },
      ]);
      for (const log of logs ?? []) {
        if (!log.removed) collected.push(log);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (from === to) throw new ProviderLimitation(`Log query failed at block ${from}: ${message}`);
      if (/range|archive|response size|query returned more|too many|timeout|10 block|10000/i.test(message) || error instanceof RpcRangeError) {
        const mid = Math.floor((from + to) / 2);
        queue.unshift([mid + 1, to]);
        queue.unshift([from, mid]);
        continue;
      }
      throw error;
    }
  }
  collected.sort((a, b) => {
    const block = parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16);
    if (block) return block;
    return parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16);
  });
  const seen = new Set<string>();
  return collected.filter((log) => {
    const key = `${log.transactionHash}:${log.logIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
