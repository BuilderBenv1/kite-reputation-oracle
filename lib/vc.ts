import { ethers } from "ethers";
import { v4 as uuidv4 } from "uuid";
import { getOracleWallet } from "./kite";

export interface TrustSignals {
  paymentReliability: number;
  counterpartyDiversity: number;
  accountAge: number;
  spendConsistency: number;
  slaAdherence: number;
  activityTrend: number;
}

export interface VerifiableCredential {
  "@context": string[];
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: {
    id: string;
    trustScore: number;
    signals: TrustSignals;
    chain: string;
    chainId: number;
    anchorTxHash?: string;
  };
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    jws: string;
  };
}

export async function issueCredential(
  did: string,
  score: number,
  signals: TrustSignals,
  anchorTxHash?: string
): Promise<VerifiableCredential> {
  const oracleDid =
    process.env.AGENTPROOF_ORACLE_DID || "did:agentproof:oracle:kite";
  const now = new Date().toISOString();
  const vcId = `urn:uuid:${uuidv4()}`;

  const credentialSubject = {
    id: did,
    trustScore: score,
    signals,
    chain: "kite",
    chainId: 2368,
    anchorTxHash,
  };

  const payload = JSON.stringify({
    id: vcId,
    type: ["VerifiableCredential", "AgentTrustCredential"],
    issuer: oracleDid,
    issuanceDate: now,
    credentialSubject,
  });

  const wallet = getOracleWallet();
  const signature = await wallet.signMessage(payload);

  return {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://agentproof.sh/credentials/trust/v1",
    ],
    id: vcId,
    type: ["VerifiableCredential", "AgentTrustCredential"],
    issuer: oracleDid,
    issuanceDate: now,
    credentialSubject,
    proof: {
      type: "EcdsaSecp256k1Signature2019",
      created: now,
      verificationMethod: `${oracleDid}#oracle-key-1`,
      proofPurpose: "assertionMethod",
      jws: signature,
    },
  };
}
