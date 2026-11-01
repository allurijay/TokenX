import { api } from "./api";
export async function hostedPayment(checkout: any) {
  const options = await api(
    `/payments/${checkout.paymentIntentId}/hosted-checkout`,
    {},
  );
  if (options.paid) return api("/orders/" + options.orderId);
  if (!(window as any).Razorpay) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve();
      script.onerror = () =>
        reject(
          new Error("Payment window could not load. Your checkout is saved."),
        );
      document.head.appendChild(script);
    });
  }
  return new Promise<any>((resolve, reject) => {
    const widget = new (window as any).Razorpay({
      ...options,
      handler: async (result: any) => {
        try {
          resolve(
            await api(`/payments/${checkout.paymentIntentId}/verify`, result),
          );
        } catch (error) {
          reject(error);
        }
      },
      modal: {
        ondismiss: () =>
          reject(
            new Error(
              "Payment window closed. Use recovery to check the existing payment before retrying.",
            ),
          ),
      },
      theme: { color: "#194b3c" },
    });
    widget.on("payment.failed", () =>
      reject(
        new Error("Payment not confirmed. Use recovery to check its status."),
      ),
    );
    widget.open();
  });
}
