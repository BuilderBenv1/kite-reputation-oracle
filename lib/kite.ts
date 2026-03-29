import { ethers } from "ethers";

export const KITE_CHAIN_CONFIG = {
  name: "Kite Chain",
  chainId: Number(process.env.KITE_CHAIN_ID) || 2368,
  rpcUrl: process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai/",
  usdtContract:
    process.env.KITE_USDT_CONTRACT ||
    "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63",
};

let providerInstance: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (!providerInstance) {
    providerInstance = new ethers.JsonRpcProvider(
      KITE_CHAIN_CONFIG.rpcUrl,
      KITE_CHAIN_CONFIG.chainId
    );
  }
  return providerInstance;
}

export function getOracleWallet(): ethers.Wallet {
  const key = process.env.ORACLE_WALLET_PRIVATE_KEY;
  if (!key) throw new Error("ORACLE_WALLET_PRIVATE_KEY not set");
  return new ethers.Wallet(key, getProvider());
}

export function getUsdtContract(): ethers.Contract {
  const abi = [
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ];
  return new ethers.Contract(
    KITE_CHAIN_CONFIG.usdtContract,
    abi,
    getProvider()
  );
}
