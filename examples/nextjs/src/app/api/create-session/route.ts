import { StarkSDK, PaymentChains, PaymentTokenSymbols } from "starkzap";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { destinationChain, token, amount, recipient } = await request.json();

    const sdk = new StarkSDK({
      network: "mainnet",
      payment: {
        apiKey: process.env.CHAINRAILS_API_KEY || "",
        environment: "production",
      },
    });

    const payment = sdk.payment();

    const session = await payment.createSession({
      amount,
      recipient,
      destinationChain: destinationChain || PaymentChains.STARKNET,
      token: token || PaymentTokenSymbols.USDC,
    });

    return NextResponse.json(session);
  } catch (error) {
    console.error("Session creation error:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
