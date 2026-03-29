import { Request, Response, NextFunction } from "express";
import { KITE_CHAIN_CONFIG } from "./kite";

export interface X402PaymentHeader {
  scheme: string;
  network: string;
  payload: string;
}

export function parsePaymentHeader(header: string): X402PaymentHeader | null {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export async function verifyPayment(header: string): Promise<boolean> {
  const parsed = parsePaymentHeader(header);
  if (!parsed) return false;

  if (parsed.scheme !== "gokite-aa") return false;
  if (parsed.network !== "kite-testnet") return false;

  const facilitatorUrl = process.env.KITE_FACILITATOR_URL;
  if (!facilitatorUrl) return false;

  try {
    const res = await fetch(`${facilitatorUrl}/v2/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment: header }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function build402Response(resource: string): object {
  return {
    error: "X-PAYMENT header is required",
    accepts: [
      {
        scheme: "gokite-aa",
        network: "kite-testnet",
        maxAmountRequired: "1000000000000000000",
        resource,
        description: "AgentProof trust score oracle",
        payTo: process.env.ORACLE_WALLET_ADDRESS || "<ORACLE_WALLET>",
        asset: "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63",
        merchantName: "AgentProof Oracle",
      },
    ],
  };
}

export function x402Gate(resource: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const paymentHeader = req.headers["x-payment"] as string | undefined;

    if (!paymentHeader) {
      res.status(402).json(build402Response(resource));
      return;
    }

    const valid = await verifyPayment(paymentHeader);
    if (!valid) {
      res.status(402).json({
        error: "Invalid payment",
        ...build402Response(resource),
      });
      return;
    }

    next();
  };
}
