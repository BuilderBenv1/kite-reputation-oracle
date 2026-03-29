# Goldsky Subgraph — Kite USDT Transfers

One-time deployment to index USDT Transfer events on Kite testnet.

## Deploy

```bash
# Install Goldsky CLI
npm install -g @goldskycom/cli

# Login
goldsky login

# Deploy instant subgraph from ABI
goldsky subgraph deploy agentproof-kite-usdt/1.0 \
  --from-abi subgraph/erc20.json \
  --address 0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63 \
  --network kite-ai-testnet
```

## Query

Once deployed, the GraphQL endpoint will be:
```
https://api.goldsky.com/api/public/project_<ID>/subgraphs/agentproof-kite-usdt/1.0/gn
```

Set this as `GOLDSKY_SUBGRAPH_URL` in your `.env`.
