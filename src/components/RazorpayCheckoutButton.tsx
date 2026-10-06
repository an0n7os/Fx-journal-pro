import React, { useState } from 'react';
import { Loader2, CreditCard } from 'lucide-react';

interface RazorpayCheckoutButtonProps {
  amount?: number; // In paise (e.g., 49900 = ₹499)
  currency?: string;
  receipt?: string;
  name?: string;
  description?: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  themeColor?: string;
  className?: string;
  buttonText?: React.ReactNode;
  disabled?: boolean;
  onSuccess?: (result: { paymentId: string; orderId: string; signature: string; message?: string }) => void;
  onError?: (errorMessage: string) => void;
  onDismiss?: () => void;
}

const RAZORPAY_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof (window as any).Razorpay === 'function') {
      return resolve(true);
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src*="checkout.razorpay.com"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      if (typeof (window as any).Razorpay === 'function') return resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function RazorpayCheckoutButton({
  amount = 49900,
  currency = 'INR',
  receipt,
  name = 'FX Journal Pro',
  description = 'Pro Access — 30 Days',
  prefill,
  themeColor = '#7c3aed',
  className = '',
  buttonText,
  disabled = false,
  onSuccess,
  onError,
  onDismiss,
}: RazorpayCheckoutButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    if (loading || disabled) return;
    setLoading(true);

    try {
      // 1. Ensure SDK is loaded
      const isLoaded = await loadRazorpayScript();
      if (!isLoaded || typeof (window as any).Razorpay !== 'function') {
        throw new Error('Razorpay SDK failed to load. Please check your network connection.');
      }

      // 2. Call backend order creation endpoint
      const orderRes = await fetch('/api/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionStorage.getItem('auth_user_id') ? { 'x-auth-user-id': sessionStorage.getItem('auth_user_id')! } : {}),
          ...(sessionStorage.getItem('auth_email') ? { 'x-auth-email': sessionStorage.getItem('auth_email')! } : {}),
        },
        body: JSON.stringify({
          amount,
          currency,
          receipt: receipt || `rcpt_${Date.now().toString(36)}`,
        }),
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok || !orderData.order_id) {
        throw new Error(orderData.error || 'Failed to initialize payment order');
      }

      const keyId = orderData.key_id || (import.meta as any).env?.VITE_RAZORPAY_KEY_ID || 'rzp_test_TkM9Ak2LL1BlY3';

      // 3. Open Razorpay Standard Checkout Modal
      const options = {
        key: keyId,
        amount: orderData.amount,
        currency: orderData.currency || currency,
        name,
        description,
        order_id: orderData.order_id,
        prefill: {
          name: prefill?.name || '',
          email: prefill?.email || '',
          contact: prefill?.contact || '',
        },
        theme: {
          color: themeColor,
          backdrop_color: '#090b14',
        },
        config: {
          display: {
            blocks: {
              upi: {
                name: 'Pay using UPI / QR',
                instruments: [
                  { method: 'upi' }
                ]
              }
            },
            sequence: ['block.upi', 'block.default'],
            preferences: {
              show_default_blocks: true
            }
          }
        },
        modal: {
          backdropclose: true,
          ondismiss: () => {
            setLoading(false);
            onDismiss?.();
          },
        },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          try {
            // 4. Send payment details to verification endpoint
            const verifyRes = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(sessionStorage.getItem('auth_user_id') ? { 'x-auth-user-id': sessionStorage.getItem('auth_user_id')! } : {}),
                ...(sessionStorage.getItem('auth_email') ? { 'x-auth-email': sessionStorage.getItem('auth_email')! } : {}),
              },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            const verifyData = await verifyRes.json();
            if (verifyRes.ok && verifyData.success) {
              onSuccess?.({
                paymentId: response.razorpay_payment_id,
                orderId: response.razorpay_order_id,
                signature: response.razorpay_signature,
                message: verifyData.message,
              });
            } else {
              throw new Error(verifyData.error || 'Payment signature verification failed.');
            }
          } catch (verifyErr: any) {
            console.error('[RazorpayCheckout] Verification error:', verifyErr);
            onError?.(verifyErr.message || 'Payment verification failed');
          } finally {
            setLoading(false);
          }
        },
      };

      const rzpInstance = new (window as any).Razorpay(options);

      rzpInstance.on('payment.failed', (failedResponse: any) => {
        setLoading(false);
        const reason = failedResponse?.error?.description || failedResponse?.error?.reason || 'Payment failed';
        console.warn('[RazorpayCheckout] Payment failed:', failedResponse);
        onError?.(reason);
      });

      rzpInstance.open();
    } catch (err: any) {
      setLoading(false);
      console.error('[RazorpayCheckout] Error:', err);
      onError?.(err.message || 'Could not initiate checkout');
    }
  };

  const defaultClasses = "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 transition-all shadow-md shadow-violet-600/25 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <button
      type="button"
      onClick={handleCheckout}
      disabled={disabled || loading}
      className={className || defaultClasses}
    >
      {loading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin text-white" />
          <span>Processing...</span>
        </>
      ) : (
        buttonText || (
          <>
            <CreditCard className="w-4 h-4" />
            <span>Pay with Razorpay</span>
          </>
        )
      )}
    </button>
  );
}
