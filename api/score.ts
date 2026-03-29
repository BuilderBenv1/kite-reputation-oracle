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
