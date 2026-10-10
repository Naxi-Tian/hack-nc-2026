export type OtpSender = (email: string, otp: string) => Promise<void>;

export type OtpDeliveryConfig =
  | { mode: "demo" }
  | { mode: "resend"; apiKey: string; from: string };

const RESEND_URL = "https://api.resend.com/emails";

export function createOtpSender(config: OtpDeliveryConfig): OtpSender {
  if (config.mode === "demo") {
    // DEMO_MODE only (BACKEND_STACK §1): codes go to the server console instead of email.
    return async (email, otp) => {
      console.info(`[demo] sign-in code for ${email}: ${otp}`);
    };
  }

  return async (email, otp) => {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.from,
        to: [email],
        subject: "Your Prospecto sign-in code",
        text: `Your Prospecto sign-in code is ${otp}. It expires in 10 minutes. If you did not request it, ignore this email.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // Never include the API key, recipient, or code in the error.
      throw new Error(`Resend rejected the sign-in email with HTTP ${response.status}`);
    }
  };
}
