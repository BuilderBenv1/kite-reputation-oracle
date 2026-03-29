import { Request, Response } from "express";
import { getHistoryForDid } from "../indexer";
import { computeScore } from "../scoring";
import { issueCredential } from "../lib/vc";

export async function issueVcHandler(req: Request, res: Response) {
  const { did, passportAddress } = req.body;

  if (!did) {
    res.status(400).json({ error: "did is required in request body" });
    return;
  }

  try {
    const lookupDid = passportAddress ? `did:kite:${passportAddress}` : did;
    const history = getHistoryForDid(lookupDid);
    const { score, signals } = computeScore(history);

    const vc = await issueCredential(did, score, signals);

    res.json({ vc });
  } catch (err) {
    console.error("[api/issue-vc] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
