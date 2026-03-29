import { ethers } from "ethers";
import { getProvider, getUsdtContract, KITE_CHAIN_CONFIG } from "../lib/kite";

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
  existing.push(event);
  paymentHistory.set(key, existing);
}

async function indexHistoricalEvents(fromBlock: number) {
  const contract = getUsdtContract();
  const provider = getProvider();
  const currentBlock = await provider.getBlockNumber();
  const batchSize = 2000;

  console.log(
    `[indexer] Indexing blocks ${fromBlock} to ${currentBlock} on Kite chain (${KITE_CHAIN_CONFIG.chainId})`
  );

  for (let start = fromBlock; start <= currentBlock; start += batchSize) {
    const end = Math.min(start + batchSize - 1, currentBlock);
    try {
      const events = await contract.queryFilter(
        contract.filters.Transfer(),
        start,
        end
      );

      for (const event of events) {
        const log = event as ethers.EventLog;
        const block = await provider.getBlock(log.blockNumber);
        addEvent({
          from: log.args[0],
          to: log.args[1],
          amount: log.args[2],
          blockNumber: log.blockNumber,
          timestamp: block?.timestamp || 0,
          txHash: log.transactionHash,
        });
      }

      console.log(
        `[indexer] Indexed blocks ${start}-${end}, ${paymentHistory.size} addresses tracked`
      );
    } catch (err) {
      console.error(`[indexer] Error indexing blocks ${start}-${end}:`, err);
    }
  }
}

function listenForNewEvents() {
  const contract = getUsdtContract();
  const provider = getProvider();

  contract.on(
    contract.filters.Transfer(),
    async (from: string, to: string, value: bigint, event: any) => {
      const block = await provider.getBlock(event.log.blockNumber);
      const paymentEvent: PaymentEvent = {
        from,
        to,
        amount: value,
        blockNumber: event.log.blockNumber,
        timestamp: block?.timestamp || Math.floor(Date.now() / 1000),
        txHash: event.log.transactionHash,
      };
      addEvent(paymentEvent);
      console.log(
        `[indexer] New transfer: ${from} → ${to}, ${ethers.formatUnits(value, 18)} USDT`
      );
    }
  );

  console.log("[indexer] Listening for new Transfer events on Kite chain");
}

export async function startIndexer(fromBlock?: number) {
  const startBlock = fromBlock ?? Math.max(0, (await getProvider().getBlockNumber()) - 10000);
  await indexHistoricalEvents(startBlock);
  listenForNewEvents();
  console.log(`[indexer] Running. ${paymentHistory.size} addresses indexed.`);
}

// Run standalone
if (require.main === module) {
  startIndexer().catch(console.error);
}
