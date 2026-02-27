/**
 * Payment modal integration for Floppy Bird (nebez/floppybird fork).
 *
 * Uses: StarkZap payment.modal API, DOM APIs, and game assets (jQuery, buzz, main.js).
 */
import { StarkSDK } from "starkzap";

const saveMeOverlay = document.getElementById("save-me-overlay")!;
const saveMePopupClose = document.getElementById("save-me-popup-close")!;
const saveMeCancelBtn = document.getElementById("save-me-cancel") as HTMLButtonElement;
const saveMePayBtn = document.getElementById("save-me-pay") as HTMLButtonElement;
const saveMeStatusLine = document.getElementById("save-me-status-line")!;

const SAVE_ME_LABEL = "Save me · $0.10";
const saveMeButton = document.getElementById("save-me") as HTMLElement | null;
const SAVE_ME_IDLE_TEXT = "Ready to pay.";

const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;

let saveMeResolver: ((value: boolean) => void) | null = null;
let saveMeCheckoutPending = false;


function resetSaveMeButton(): void {
  if (!saveMeButton) return;
  saveMeButton.setAttribute("aria-label", SAVE_ME_LABEL);
}

async function openSaveMeCheckout(): Promise<boolean> {
  // An endpoint that uses starkSDK serverside to generate a session_url
  const CHAINRAILS_SESSION_URL =
    env.VITE_CHAINRAILS_SESSION_URL ??
    "http://localhost:3001/session-token";
  const response = await fetch(CHAINRAILS_SESSION_URL);

  if (!response.ok) {
    throw new Error(`Session endpoint failed with status ${response.status}.`);
  }

  const payload = await response.json()
  const sessionToken = payload.sessionToken;
  const amount = payload.amount;

  if (typeof sessionToken !== "string" || sessionToken.length === 0) {
    throw new Error("Session payload is missing a valid sessionToken.");
  }

  const sdk = new StarkSDK({
    network: "mainnet",
  });

  // retruns a promise that reolves to true if payment is successful,
  // or false if not
  return sdk
    .payment()
    .modal({
      type: "token",
      platform: "vanilla",
      sessionToken,
      amount,
    })
    .pay();
}

function resetSaveMeModalState(): void {
  saveMeStatusLine.textContent = SAVE_ME_IDLE_TEXT;
  saveMePayBtn.disabled = false;
  saveMeCancelBtn.disabled = false;
  saveMeCheckoutPending = false;
}

function closeSaveMeModal(result: boolean): void {
  saveMeOverlay.classList.remove("show");
  const resolver = saveMeResolver;
  saveMeResolver = null;
  resetSaveMeModalState();
  if (resolver) resolver(result);
}

function openSaveMeModal(): Promise<boolean> {
  if (saveMeResolver) return Promise.resolve(false);
  resetSaveMeModalState();
  saveMeOverlay.classList.add("show");
  return new Promise<boolean>((resolve) => {
    saveMeResolver = resolve;
  });
}

async function onSaveMePay(): Promise<void> {
  if (saveMeCheckoutPending || !saveMeResolver) return;
  saveMeCheckoutPending = true;
  saveMeStatusLine.textContent = "Opening payment...";
  saveMePayBtn.disabled = true;
  saveMeCancelBtn.disabled = true;

  try {
    const paid = await openSaveMeCheckout();
    closeSaveMeModal(paid);
  } catch {
    closeSaveMeModal(false);
  }
}

saveMePopupClose.addEventListener("click", (e) => {
  e.stopPropagation();
  closeSaveMeModal(false);
});

saveMeCancelBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (saveMeCheckoutPending) return;
  closeSaveMeModal(false);
});

saveMePayBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  onSaveMePay();
});

saveMeOverlay.addEventListener("click", (e) => {
  if (e.target === saveMeOverlay && !saveMeCheckoutPending) closeSaveMeModal(false);
});

window.__saveMe = async () => {
  resetSaveMeButton();
  return openSaveMeModal();
};

declare global {
  interface Window {
    __saveMe?: () => Promise<boolean>;
  }
}

