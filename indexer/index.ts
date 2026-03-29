/**
 * Goldsky-powered indexer for Kite chain.
 *
 * Queries the Goldsky subgraph for ERC-20 Transfer events on the
 * Kite USDT contract instead of polling RPC directly.
 *
 * Subgraph deployment (one-time):
 *   goldsky subgraph deploy agentproof-kite-usdt/1.0 \
 *     --from-abi erc20.json \
 *     --network kite-ai-testnet
 */

import { KITE_CHAIN_CONFIG } from "../lib/kite";

export interface PaymentEvent {
  from: string;
  to: string;
  amount: bigint;
  blockNumber: number;
  timestamp: number;
  txHash: string;
}

export type PaymentHistory = Map<string, PaymentEvent[]>;

const paymentHistory: PaymentHistory = new Map();

// Goldsky subgraph endpoint
const GOLDSKY_ENDPOINT =
  process.env.GOLDSKY_SUBGRAPH_URL ||
  "https://api.goldsky.com/api/public/project_default/subgraphs/agentproof-kite-usdt/1.0/gn";

const USDT_CONTRACT = KITE_CHAIN_CONFIG.usdtContract.toLowerCase();

// Polling interval for new events (30 seconds)
const POLL_INTERVAL = 30_000;

export function getPaymentHistory(): PaymentHistory {
  return paymentHistory;
}

export function getHistoryForAddress(address: string): PaymentEvent[] {
  return paymentHistory.get(address.toLowerCase()) || [];
}

export function getHistoryForDid(did: string): PaymentEvent[] {
  // Kite Passport DIDs encode the address: did:kite:<address>
  const match = did.match(/did:kite:(.+)/i);
  if (!match) return [];
  return getHistoryForAddress(match[1]);
}

function addEvent(event: PaymentEvent) {
  const key = event.from.toLowerCase();
  const existing = paymentHistory.get(key) || [];

  // Deduplicate by txHash
  if (existing.some((e) => e.txHash === event.txHash)) return;

  existing.push(event);
  paymentHistory.set(key, existing);
}

interface GoldskyTransfer {
  id: string;
  from: string;
  to: string;
  value: string;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: string;
}

async function queryGoldsky(
  lastBlock: number,
  first: number = 1000
): Promise<GoldskyTransfer[]> {
  const query = `{
    transfers(
      first: ${first}
      orderBy: blockNumber
      orderDirection: asc
      where: { blockNumber_gt: "${lastBlock}" }
    ) {
      id
      from
      to
      value
      blockNumber
      blockTimestamp
      transactionHash
    }
  }`;

  try {
    const res = await fetch(GOLDSKY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      console.error(`[indexer] Goldsky returned ${res.status}`);
      return [];
    }

    const json = (await res.json()) as any;
    return json.data?.transfers || [];
  } catch (err) {
    console.error("[indexer] Goldsky query failed:", err);
    return [];
  }
}

async function indexFromGoldsky() {
  let lastBlock = 0;
  let totalIndexed = 0;

  console.log(`[indexer] Fetching payment history from Goldsky subgraph`);
  console.log(`[indexer] Endpoint: ${GOLDSKY_ENDPOINT}`);

  // Paginate through all historical events
  let hasMore = true;
  while (hasMore) {
    const transfers = await queryGoldsky(lastBlock);

    if (transfers.length === 0) {
      hasMore = false;
      break;
    }

    for (const t of transfers) {
      addEvent({
        from: t.from,
        to: t.to,
        amount: BigInt(t.value),
        blockNumber: parseInt(t.blockNumber),
        timestamp: parseInt(t.blockTimestamp),
        txHash: t.transactionHash,
      });
    }

    totalIndexed += transfers.length;
    lastBlock = parseInt(transfers[transfers.length - 1].blockNumber);
    console.log(
      `[indexer] Indexed ${totalIndexed} transfers, ${paymentHistory.size} addresses, up to block ${lastBlock}`
    );

    // If we got fewer than 1000, we've caught up
    if (transfers.length < 1000) hasMore = false;
  }

  return lastBlock;
}

function startPolling(fromBlock: number) {
  let lastBlock = fromBlock;

  setInterval(async () => {
    const transfers = await queryGoldsky(lastBlock);

    for (const t of transfers) {
      addEvent({
        from: t.from,
        to: t.to,
        amount: BigInt(t.value),
        blockNumber: parseInt(t.blockNumber),
        timestamp: parseInt(t.blockTimestamp),
        txHash: t.transactionHash,
      });
    }

    if (transfers.length > 0) {
      lastBlock = parseInt(transfers[transfers.length - 1].blockNumber);
      console.log(
        `[indexer] Polled ${transfers.length} new transfers, ${paymentHistory.size} addresses tracked`
      );
    }
  }, POLL_INTERVAL);

  console.log(
    `[indexer] Polling Goldsky every ${POLL_INTERVAL / 1000}s for new transfers`
  );
}

export async function startIndexer() {
  const lastBlock = await indexFromGoldsky();
  startPolling(lastBlock);
  console.log(
    `[indexer] Running via Goldsky. ${paymentHistory.size} addresses indexed.`
  );
}

// Run standalone
if (require.main === module) {
  startIndexer().catch(console.error);
}
