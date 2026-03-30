import { ethers } from "ethers";
import { getProvider, KITE_CHAIN_CONFIG } from "../lib/kite";
import { getHistoryForDid } from "../indexer";
import { computeScore } from "../scoring";
import { issueCredential } from "../lib/vc";
import { anchorAttestation } from "../lib/attestation";

/**
 * Autonomous trust-gated agent.
 *
 * This agent receives a payment request from a counterparty,
 * queries the AgentProof oracle for their trust score,
 * and only proceeds with payment if the score meets the threshold.
 *
 * Flow:
 *   1. Agent receives counterparty DID
 *   2. Indexes payment history for DID (via Goldsky subgraph)
 *   3. Computes trust score from x402 payment signals
 *   4. Issues W3C VC and anchors attestation on Kite chain
 *   5. If score >= threshold → execute payment to counterparty
 *   6. If score < threshold → reject, log reason
 *
 * All decisions and settlements happen on Kite chain.
 * No human in the loop.
 */

const TRUST_THRESHOLD = Number(process.env.TRUST_THRESHOLD) || 50;

interface AgentDecision {
  counterpartyDid: string;
  action: "approved" | "rejected";
  score: number;
  threshold: number;
  reason: string;
  signals: object | null;
  vc: Record<string, unknown> | null;
  onChainTx: string | null;
  settlementTx: string | null;
  txCount: number;
  timestamp: string;
}

const decisionLog: AgentDecision[] = [];

export function getDecisionLog(): AgentDecision[] {
  return decisionLog;
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
  await tx.wait();
  console.log(`[agent] Settlement tx: ${tx.hash}`);
  return tx.hash;
}

export async function evaluateCounterparty(
  counterpartyDid: string,
  paymentAddress?: string,
  paymentAmount?: string
): Promise<AgentDecision> {
  console.log(`[agent] Evaluating counterparty: ${counterpartyDid}`);

  const decision: AgentDecision = {
    counterpartyDid,
    action: "rejected",
    score: 0,
    threshold: TRUST_THRESHOLD,
    reason: "",
    signals: null,
    vc: null,
    onChainTx: null,
    settlementTx: null,
    txCount: 0,
    timestamp: new Date().toISOString(),
  };

  try {
    // Step 1: Pull payment history from Goldsky subgraph
    const history = getHistoryForDid(counterpartyDid);
    decision.txCount = history.length;
    console.log(
      `[agent] Found ${history.length} transactions for ${counterpartyDid}`
    );

    // Step 2: Compute trust score
    const { score, signals } = computeScore(history);
    decision.score = score;
    decision.signals = signals;
    console.log(
      `[agent] Trust score for ${counterpartyDid}: ${score}/100`
    );

    // Step 3: Anchor attestation on Kite chain
    try {
      decision.onChainTx = await anchorAttestation(
        counterpartyDid,
        score,
        signals,
        `agent-eval-${Date.now()}`
      );
    } catch (err) {
      console.warn("[agent] Attestation anchoring failed (continuing):", err);
    }

    // Step 4: Issue W3C Verifiable Credential
    try {
      const vc = await issueCredential(
        counterpartyDid,
        score,
        signals,
        decision.onChainTx || undefined
      );
      decision.vc = vc as unknown as Record<string, unknown>;
    } catch (err) {
      console.warn("[agent] VC issuance failed (continuing):", err);
    }

    // Step 5: Make autonomous decision
    if (score >= TRUST_THRESHOLD) {
      decision.action = "approved";
      decision.reason = `Score ${score} meets threshold ${TRUST_THRESHOLD}`;

      // Step 6: Settle payment on Kite chain if requested
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
      decision.reason = `Score ${score} below threshold ${TRUST_THRESHOLD}`;
      console.log(`[agent] REJECTED: ${decision.reason}`);
    }
  } catch (err) {
    decision.reason = `Evaluation failed: ${err}`;
    console.error(`[agent] ERROR: ${decision.reason}`);
  }

  decisionLog.push(decision);
  return decision;
}
