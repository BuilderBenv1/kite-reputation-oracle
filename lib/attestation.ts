import { ethers } from "ethers";
import { getOracleWallet, getProvider } from "./kite";
import { TrustSignals } from "./vc";

/**
 * Anchors a trust score attestation on Kite chain.
 * Encodes the score + DID into calldata and sends a self-transaction
 * to the oracle wallet — creating an immutable on-chain record.
 */
export async function anchorAttestation(
  did: string,
  score: number,
  signals: TrustSignals,
  vcId: string
): Promise<string> {
  const wallet = getOracleWallet();

  // Encode attestation data into calldata
  const attestationData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "uint8", "string", "uint256"],
    [did, score, vcId, Math.floor(Date.now() / 1000)]
  );

  // Prefix with AgentProof attestation marker
  const calldata = ethers.concat([
    ethers.toUtf8Bytes("AGENTPROOF_ATTEST_V1"),
    attestationData,
  ]);

  const tx = await wallet.sendTransaction({
    to: wallet.address,
    value: 0,
    data: ethers.hexlify(calldata),
  });

  console.log(`[attestation] Anchored on Kite chain: ${tx.hash}`);

  const receipt = await tx.wait();
  if (!receipt) throw new Error("Transaction failed");

  console.log(
    `[attestation] Confirmed in block ${receipt.blockNumber}, gas: ${receipt.gasUsed.toString()}`
  );

  return tx.hash;
}
