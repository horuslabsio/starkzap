declare module "@chainrails/vanilla" {
  export function createPaymentSession(options: {
    session_url: string;
    onCancel: () => void;
    onSuccess: () => void;
  }): {
    bind: (element: HTMLElement) => () => void;
    open: () => void;
    destroy: () => void;
  };

  export const ChainrailsPaymentModalElement: {
    tagName: string;
  };
}

declare module "@chainrails/react-native" {
  export interface PaymentModalProps {
    sessionToken: string;
    amount?: string;
    isOpen?: boolean;
    isPending?: boolean;
    onCancel: () => void;
    onSuccess: () => void;
  }

  /**
   * Opens the payment modal and returns a Promise that resolves to a boolean.
   * - `true` on successful payment
   * - `false` on cancel/close
   */
  export function openPaymentModal(props: {
    sessionToken: string;
    amount?: string | undefined;
  }): Promise<boolean>;

  /**
   * React Native component for the payment modal.
   * Use `openPaymentModal` for programmatic opening, or render this component
   * with the `isOpen` prop controlled externally.
   */
  export const PaymentModal: React.FC<PaymentModalProps>;
}
