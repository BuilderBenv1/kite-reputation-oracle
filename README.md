# kite-reputation-oracle

AgentProof's external reputation oracle for Kite chain.

Kite Passport gives agents identity. AgentProof gives that identity a trust history.

## What it does

- Indexes x402 payment behaviour on Kite chain per agent DID
- Scores agents 0-100 across payment reliability, counterparty diversity, spend consistency, SLA adherence, account age, and activity trend
- Issues W3C Verifiable Credentials signed by AgentProof oracle, anchored on Kite chain
- Oracle queries gated behind x402 micropayment (Kite chain native)
- Cross-chain enrichment: pulls existing AgentProof scores from Base/Solana if address is known

## Architecture

```
Agent → GET /api/score?did=<kite_passport_did>
       ← 402 Payment Required (x402, Kite chain USDC)
Agent → GET /api/score (with X-PAYMENT header)
       → Indexer pulls x402 history for DID
       → Scoring module computes trust score
       → VC issued, anchored on Kite chain
       ← Returns { score, signals, vc, onChainTx }
```

## Scoring signals (x402-native)

| Signal | Weight |
|---|---|
| Payment reliability rate | 25% |
| Counterparty diversity | 20% |
| Account age & longevity | 15% |
| Spend consistency | 15% |
| SLA adherence | 15% |
| Activity trend | 10% |

## Quick start

```bash
cp .env.example .env
# fill in KITE_RPC_URL, ORACLE_WALLET_PRIVATE_KEY, KITE_FACILITATOR_URL
npm install
npm run dev
```

## API

### GET /api/score?did=\<did\>
Requires `X-PAYMENT` header (x402, Kite chain)
Returns: `{ score, signals, vc, onChainTx }`

### POST /api/issue-vc
Body: `{ did, passportAddress }`
Returns: W3C VC JSON

## Live demo
https://kite-reputation-oracle.vercel.app

## Built by
AgentProof — [agentproof.sh](https://agentproof.sh)
ERC-8004 cross-chain reputation oracle, 149.7K+ agents indexed, 21 chains.
