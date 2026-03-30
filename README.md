# kite-reputation-oracle

AgentProof's external reputation oracle for Kite chain.

Kite Passport gives agents identity. AgentProof gives that identity a trust history.

## What it does

- Indexes x402 payment behaviour on Kite chain per agent DID via [Goldsky](https://goldsky.com) subgraph
- Scores agents 0-100 across payment reliability, counterparty diversity, spend consistency, SLA adherence, account age, and activity trend
- Issues W3C Verifiable Credentials signed by AgentProof oracle, anchored on Kite chain
- Anchors every attestation on-chain as an immutable calldata transaction on Kite
- Oracle queries gated behind x402 micropayment (Kite chain USDT, settled via [Pieverse](https://facilitator.pieverse.io) facilitator)
- Includes an autonomous trust-gated agent that evaluates counterparties and approves/rejects payments with zero human involvement
- Cross-chain enrichment: pulls existing AgentProof scores from Base/Solana if address is known

## Architecture

```
Agent → GET /api/score?did=<kite_passport_did>
       ← 402 Payment Required (x402, Kite chain USDT)
Agent → GET /api/score (with X-PAYMENT header)
       → Goldsky subgraph pulls x402 history for DID
       → Scoring module computes trust score (6 signals, weighted)
       → Attestation anchored on Kite chain (calldata tx)
       → W3C VC issued, signed by oracle wallet
       ← Returns { score, signals, vc, onChainTx }
```

### Autonomous Agent Flow

```
Counterparty DID → POST /api/agent/evaluate
       → Index payment history (Goldsky)
       → Compute trust score
       → Anchor attestation on Kite chain
       → Issue W3C Verifiable Credential
       → If score >= threshold → APPROVE (settle payment on-chain)
       → If score < threshold  → REJECT  (log reason)
       ← Returns full decision with signals, VC, tx hashes
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

## Tech stack

- **Indexing**: Goldsky instant subgraph on Kite testnet (ERC-20 Transfer events)
- **Scoring**: Pure functions per signal, weighted combination to 0-100
- **On-chain**: Attestations anchored as calldata txs on Kite chain
- **Credentials**: W3C VC 1.1, EcdsaSecp256k1Signature2019
- **Payment gate**: x402 protocol via Pieverse facilitator
- **API**: Express.js, TypeScript
- **Deployment**: Railway

## Quick start

```bash
cp .env.example .env
# fill in ORACLE_WALLET_PRIVATE_KEY, ORACLE_WALLET_ADDRESS
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

### POST /api/agent/evaluate
Body: `{ did, paymentAddress?, paymentAmount? }`
Returns: `{ action, score, threshold, signals, vc, onChainTx, settlementTx }`

### GET /api/agent/decisions
Returns: array of all agent decisions

### GET /api/health
Returns: `{ status: "ok" }`

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ORACLE_WALLET_PRIVATE_KEY` | Yes | Private key for signing VCs and anchoring attestations |
| `ORACLE_WALLET_ADDRESS` | Yes | Oracle wallet public address (payTo for x402) |
| `KITE_RPC_URL` | No | Defaults to `https://rpc-testnet.gokite.ai/` |
| `KITE_FACILITATOR_URL` | No | Defaults to `https://facilitator.pieverse.io` |
| `GOLDSKY_SUBGRAPH_URL` | No | Defaults to deployed subgraph endpoint |
| `TRUST_THRESHOLD` | No | Agent approval threshold, defaults to 50 |
| `PORT` | No | Server port, defaults to 3000 |

## Live demo

https://kite-reputation-oracle-production.up.railway.app

## Built by

AgentProof — [agentproof.sh](https://agentproof.sh)
ERC-8004 cross-chain reputation oracle, 149.7K+ agents indexed, 21 chains.
