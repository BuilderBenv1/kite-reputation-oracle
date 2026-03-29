import { ethers } from "ethers";
import { getProvider, KITE_CHAIN_CONFIG } from "../lib/kite";

/**
 * Autonomous trust-gated agent.
 *
 * This agent receives a payment request from a counterparty,
 * queries the AgentProof oracle for their trust score,
 * and only proceeds with payment if the score meets the threshold.
 *
 * Flow:
 *   1. Agent receives counterparty DID
 *   2. Pays x402 micropayment to query oracle
 *   3. Oracle returns trust score + VC
 *   4. If score >= threshold → execute payment to counterparty
 *   5. If score < threshold → reject, log reason
 *
 * All decisions and settlements happen on Kite chain.
 */

const ORACLE_URL =
  process.env.ORACLE_URL ||
  "https://kite-reputation-oracle-production.up.railway.app";
const TRUST_THRESHOLD = Number(process.env.TRUST_THRESHOLD) || 50;

interface OracleResponse {
  score: number;
  signals: Record<string, number>;
  vc: Record<string, unknown>;
  txCount: number;
  chain: string;
}

interface AgentDecision {
  counterpartyDid: string;
  action: "approved" | "rejected";
  score: number;
  threshold: number;
  reason: string;
  oracleResponse: OracleResponse | null;
  settlementTx: string | null;
  timestamp: string;
}

const decisionLog: AgentDecision[] = [];

export function getDecisionLog(): AgentDecision[] {
  return decisionLog;
}

async function queryOracle(did: string): Promise<OracleResponse> {
  // Step 1: Hit oracle, expect 402
  const initial = await fetch(
    `${ORACLE_URL}/api/score?did=${encodeURIComponent(did)}`
  );

  if (initial.status === 402) {
    const paymentInfo = (await initial.json()) as any;
    console.log(
      `[agent] Oracle requires payment: ${paymentInfo.accepts[0].scheme}`
    );

    // Step 2: Construct x402 payment header
    const paymentHeader = Buffer.from(
      JSON.stringify({
        scheme: "gokite-aa",
        network: "kite-testnet",
        payload: `agent-payment-${Date.now()}`,
      })
    ).toString("base64");

    // Step 3: Retry with payment
    const paid = await fetch(
      `${ORACLE_URL}/api/score?did=${encodeURIComponent(did)}`,
      { headers: { "X-PAYMENT": paymentHeader } }
    );

    if (!paid.ok) throw new Error(`Oracle returned ${paid.status}`);
    return (await paid.json()) as OracleResponse;
  }

  if (!initial.ok) throw new Error(`Oracle returned ${initial.status}`);
  return (await initial.json()) as OracleResponse;
}

async function settlePayment(
  toAddress: string,
  amount: string
): Promise<string> {
  const key = process.env.AGENT_WALLET_PRIVATE_KEY;
  if (!key) throw new Error("AGENT_WALLET_PRIVATE_KEY not set");

  const provider = getProvider();
  const wallet = new ethers.Wallet(key, provider);

  const usdtAbi = [
    "function transfer(address to, uint256 amount) returns (bool)",
  ];
  const usdt = new ethers.Contract(
    KITE_CHAIN_CONFIG.usdtContract,
    usdtAbi,
    wallet
  );

  const tx = await usdt.transfer(toAddress, ethers.parseUnits(amount, 18));
  const receipt = await tx.wait();
  console.log(`[agent] Settlement tx: ${tx.hash}`);
  return tx.hash;
}

export async function evaluateCounterparty(
  counterpartyDid: string,
  paymentAddress?: string,
  paymentAmount?: string
): Promise<AgentDecision> {
  console.log(`[agent] Evaluating counterparty: ${counterpartyDid}`);

  let decision: AgentDecision = {
    counterpartyDid,
    action: "rejected",
    score: 0,
    threshold: TRUST_THRESHOLD,
    reason: "",
    oracleResponse: null,
    settlementTx: null,
    timestamp: new Date().toISOString(),
  };

  try {
    // Query oracle for trust score
    const oracleResponse = await queryOracle(counterpartyDid);
    decision.oracleResponse = oracleResponse;
    decision.score = oracleResponse.score;

    console.log(
      `[agent] Trust score for ${counterpartyDid}: ${oracleResponse.score}/100`
    );

    if (oracleResponse.score >= TRUST_THRESHOLD) {
      decision.action = "approved";
      decision.reason = `Score ${oracleResponse.score} meets threshold ${TRUST_THRESHOLD}`;

      // Settle payment on Kite chain if address and amount provided
      if (paymentAddress && paymentAmount) {
        try {
          const txHash = await settlePayment(paymentAddress, paymentAmount);
          decision.settlementTx = txHash;
          decision.reason += `. Settlement: ${txHash}`;
        } catch (err) {
          decision.reason += `. Settlement failed: ${err}`;
        }
      }

      console.log(`[agent] APPROVED: ${decision.reason}`);
    } else {
      decision.reason = `Score ${oracleResponse.score} below threshold ${TRUST_THRESHOLD}`;
      console.log(`[agent] REJECTED: ${decision.reason}`);
    }
  } catch (err) {
    decision.reason = `Oracle query failed: ${err}`;
    console.error(`[agent] ERROR: ${decision.reason}`);
  }

  decisionLog.push(decision);
  return decision;
}
