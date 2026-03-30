import path from "path";
import express from "express";
import { x402Gate } from "../lib/x402";
import { getHistoryForDid, startIndexer } from "../indexer";
import { computeScore } from "../scoring";
import { issueCredential } from "../lib/vc";
import { anchorAttestation } from "../lib/attestation";
import { issueVcHandler } from "./issue-vc";
import { evaluateCounterparty, getDecisionLog } from "../agent";

const app = express();
app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "X-PAYMENT, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});

app.options("*", (_req, res) => res.sendStatus(204));

// Serve demo UI
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../app/index.html"));
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", oracle: "kite-reputation-oracle", version: "1.0.0" });
});

// Demo endpoint — structured for AI agents/judges to understand and call
app.get("/api/demo", (_req, res) => {
  res.json({
    service: "AgentProof Reputation Oracle for Kite Chain",
    version: "1.0.0",
    description:
      "Indexes x402 payment behaviour on Kite chain per agent DID, scores agents 0-100, issues W3C Verifiable Credentials anchored on-chain. Oracle queries gated behind x402 micropayments.",
    howToUse: {
      step1: { action: "GET /api/score?did=did:kite:0xADDRESS", result: "Returns 402 with x402 payment instructions" },
      step2: { action: "Pay via x402 on Kite testnet (gokite-aa scheme, Pieverse facilitator)", result: "You receive a payment proof" },
      step3: { action: "GET /api/score?did=did:kite:0xADDRESS with header X-PAYMENT: <proof>", result: "Returns trust score, signals, W3C VC, on-chain attestation tx" },
    },
    autonomousAgent: {
      endpoint: "POST /api/agent/evaluate",
      body: { did: "did:kite:0xADDRESS", paymentAddress: "optional", paymentAmount: "optional" },
      description: "Autonomous agent evaluates counterparty trust and approves/rejects — zero human involvement",
      result: "Returns decision (approved/rejected), score, signals, W3C VC, on-chain attestation tx",
    },
    responseSchema: {
      score: "number — 0-100 composite trust score",
      signals: {
        paymentReliability: "number — 0-1, weight 25%",
        counterpartyDiversity: "number — 0-1, weight 20%",
        accountAge: "number — 0-1, weight 15%",
        spendConsistency: "number — 0-1, weight 15%",
        slaAdherence: "number — 0-1, weight 15%",
        activityTrend: "number — 0-1, weight 10%",
      },
      vc: "W3C Verifiable Credential 1.1, type AgentTrustCredential",
      onChainTx: "string — Kite chain attestation tx hash",
    },
    whatsReal: {
      real: [
        "Goldsky subgraph indexing USDT transfers on Kite testnet",
        "On-chain attestations anchored as calldata txs on Kite chain",
        "W3C VCs signed by oracle wallet (EcdsaSecp256k1Signature2019)",
        "x402 payment gate via Pieverse facilitator",
        "Autonomous agent with trust-gated decision logic",
      ],
      testnet: "Running on Kite testnet (chain 2368) — mainnet bridge not yet live",
    },
    indexer: "Goldsky instant subgraph on kite-ai-testnet",
    explorer: "https://testnet.kitescan.ai",
    endpoints: {
      "GET /api/score?did=<did>": "x402 gated — trust score + VC + on-chain attestation",
      "POST /api/issue-vc": "Issue W3C VC for a DID",
      "POST /api/agent/evaluate": "Autonomous trust-gated agent evaluation",
      "GET /api/agent/decisions": "Agent decision log",
      "GET /api/demo": "Free — this endpoint",
      "GET /api/health": "Free — server status",
    },
    builtBy: "AgentProof — agentproof.sh — ERC-8004 cross-chain reputation oracle",
  });
});

// Score endpoint — x402 gated
app.get("/api/score", x402Gate("/api/score"), async (req, res) => {
  const did = req.query.did as string;

  if (!did) {
    res.status(400).json({ error: "did query parameter is required" });
    return;
  }

  try {
    const history = getHistoryForDid(did);
    const { score, signals } = computeScore(history);

    // Anchor attestation on Kite chain
    let anchorTxHash: string | undefined;
    try {
      anchorTxHash = await anchorAttestation(did, score, signals, `vc-${Date.now()}`);
    } catch (err) {
      console.warn("[api/score] Attestation anchoring failed (continuing):", err);
    }

    const vc = await issueCredential(did, score, signals, anchorTxHash);

    res.json({
      score,
      signals,
      vc,
      onChainTx: anchorTxHash || null,
      txCount: history.length,
      chain: "kite",
      chainId: 2368,
    });
  } catch (err) {
    console.error("[api/score] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Issue VC endpoint
app.post("/api/issue-vc", issueVcHandler);

// Agent endpoints
app.post("/api/agent/evaluate", async (req, res) => {
  const { did, paymentAddress, paymentAmount } = req.body;

  if (!did) {
    res.status(400).json({ error: "did is required" });
    return;
  }

  try {
    const decision = await evaluateCounterparty(did, paymentAddress, paymentAmount);
    res.json(decision);
  } catch (err) {
    console.error("[api/agent] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/agent/decisions", (_req, res) => {
  res.json(getDecisionLog());
});

const PORT = process.env.PORT || 3000;

async function main() {
  // Start indexer in background
  startIndexer().catch(console.error);

  app.listen(PORT, () => {
    console.log(`[oracle] kite-reputation-oracle running on port ${PORT}`);
    console.log(`[oracle] GET /api/score?did=<kite_passport_did>`);
    console.log(`[oracle] POST /api/issue-vc`);
  });
}

main().catch(console.error);

export default app;
