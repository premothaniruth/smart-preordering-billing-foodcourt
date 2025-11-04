import React, { useCallback, useMemo, useState } from "react";

const PAYMENT_GROUPS = [
  {
    id: "cards",
    label: "Card Payments",
    options: [
      { id: "credit_card", label: "Credit Card" },
      { id: "debit_card", label: "Debit Card" },
      { id: "rupay_card", label: "Rupay Card" },
      { id: "sodexo_card", label: "Sodexo Meal Card" }
    ]
  },
  {
    id: "upi",
    label: "UPI",
    options: [
      { id: "upi_id", label: "Enter UPI ID" },
      { id: "upi_app_bhim", label: "BHIM" },
      { id: "upi_app_gpay", label: "Google Pay" },
      { id: "upi_app_paytm", label: "Paytm" },
      { id: "upi_app_amazonpay", label: "Amazon Pay" },
      { id: "upi_app_phonepe", label: "PhonePe" }
    ]
  },
  {
    id: "qr",
    label: "QR / Offline",
    options: [
      { id: "upi_qr", label: "Scan UPI QR" },
      { id: "cash", label: "Cash on Pickup" },
      { id: "wallet", label: "Infy Wallet" }
    ]
  }
];

const PAYMENT_TITLES = {
  credit_card: "Credit Card",
  debit_card: "Debit Card",
  rupay_card: "Rupay Card",
  sodexo_card: "Sodexo Meal Card",
  upi_id: "UPI ID",
  upi_app_bhim: "BHIM UPI",
  upi_app_gpay: "Google Pay",
  upi_app_paytm: "Paytm",
  upi_app_phonepe: "PhonePe",
  upi_app_amazonpay: "Amazon Pay",
  upi_qr: "UPI QR",
  cash: "Cash",
  wallet: "Infy Wallet"
};

const inferMethod = (optionId) => {
  if (optionId === "wallet") return "wallet";
  if (optionId === "cash") return "cash";
  return "gateway";
};

const PaymentPage = ({
  draft,
  paymentMethod,
  onPaymentMethodChange,
  onPlaceOrder,
  onBack,
  onNotesChange,
  isPlacingOrder = false,
  emitToast
}) => {
  const [upiId, setUpiId] = useState("");
  const [cardDetails, setCardDetails] = useState({
    number: "",
    expiry: "",
    holder: "",
    cvv: ""
  });
  const [step, setStep] = useState("select");

  const total = Number(draft?.totals?.totalPayable ?? 0).toFixed(2);
  const subtotal = Number(draft?.totals?.subtotalBeforeDiscount ?? total).toFixed(2);
  const discount = Number(draft?.totals?.discountTotal ?? 0).toFixed(2);

  const upiApps = useMemo(
    () => PAYMENT_GROUPS.find((g) => g.id === "upi")?.options.filter((opt) => opt.id.startsWith("upi_app")) || [],
    []
  );

  const steps = useMemo(() => ([
    {
      id: "select",
      title: "Payment Method",
      caption: "Choose how you'd like to pay"
    },
    {
      id: "details",
      title: "Payment Details",
      caption: "Provide secure payment information"
    }
  ]), []);

  const currentStepIndex = steps.findIndex((s) => s.id === step);

  const notify = useCallback((message, type = "error") => {
    if (typeof emitToast === "function") {
      emitToast(type, message);
      return;
    }
    if (type === "error") {
      alert(message);
    } else {
      console.log(message);
    }
  }, [emitToast]);

  const handleOptionSelect = (optionId) => {
    if (typeof onPaymentMethodChange === "function") {
      onPaymentMethodChange(optionId);
    }
    setUpiId("");
    setCardDetails({ number: "", expiry: "", holder: "", cvv: "" });
  };

  const handlePlace = () => {
    const method = inferMethod(paymentMethod);
    const payload = {};

    if (!paymentMethod) {
      notify("Select a payment option to continue");
      return;
    }

    if (paymentMethod === "upi_id") {
      if (!upiId.trim()) {
        notify("Enter a valid UPI ID to continue");
        return;
      }
      payload.type = "upi_id";
      payload.upiId = upiId.trim();
    } else if (paymentMethod.startsWith("upi_app")) {
      payload.type = "upi_app";
      payload.app = paymentMethod.replace("upi_app_", "");
    } else if (paymentMethod === "upi_qr") {
      payload.type = "upi_qr";
      payload.reference = "qr-scan";
    } else if (method === "gateway") {
      const sanitized = {
        number: cardDetails.number.replace(/\s+/g, ""),
        expiry: cardDetails.expiry.trim(),
        holder: cardDetails.holder.trim()
      };
      if (!sanitized.number || sanitized.number.length < 12) {
        notify("Enter a valid card number (12-16 digits)");
        return;
      }
      if (!/^[0-9]{2}\/[0-9]{2}$/.test(sanitized.expiry)) {
        notify("Enter card expiry in MM/YY format");
        return;
      }
      if (!sanitized.holder) {
        notify("Enter the name on the card");
        return;
      }
      payload.type = paymentMethod;
      payload.provider = paymentMethod;
      payload.card = sanitized;
    }

    if (paymentMethod === "wallet") {
      const balance = Number(draft?.wallet?.balance || 0).toFixed(2);
      if (draft?.wallet?.enabled) {
        notify(`Wallet selected. Available balance: ₹${balance}`, "info");
      } else {
        notify("Wallet payments require employee login", "error");
        return;
      }
    }

    onPlaceOrder({ method, payload });
  };

  const handleContinue = () => {
    if (!paymentMethod) {
      notify("Select a payment option to continue");
      return;
    }
    setStep("details");
  };

  const handleEditMethod = () => {
    setStep("select");
  };

  if (!draft) {
    return (
      <div className="payment-page">
        <div className="payment-card">
          <h2>Payment Session Expired</h2>
          <p>Please return to the cart to start checkout again.</p>
          <button onClick={onBack}>Back to Cart</button>
        </div>
      </div>
    );
  }

  const methodTitle = PAYMENT_TITLES[paymentMethod] || "Select a method";
  const isGateway = paymentMethod ? inferMethod(paymentMethod) === "gateway" : false;
  const isUpiApp = paymentMethod?.startsWith("upi_app");

  const renderPaymentDetails = () => {
    if (!paymentMethod) {
      return (
        <div className="payment-extra hint">
          Pick a payment option to proceed. We securely handle your details with Stripe-style tokenization.
        </div>
      );
    }

    if (paymentMethod === "upi_id") {
      return (
        <div className="payment-extra">
          <label>Enter UPI ID</label>
          <input
            type="text"
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            placeholder="example@upi"
            autoFocus
          />
          <div className="payment-extra hint">We'll trigger a collect request to your UPI app once you confirm.</div>
        </div>
      );
    }

    if (isUpiApp) {
      const label = upiApps.find((app) => app.id === paymentMethod)?.label || "UPI App";
      return (
        <div className="payment-extra hint">
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
          Approve the payment inside your {label} application after we redirect you. No sensitive data is stored on our servers.
        </div>
      );
    }

    if (paymentMethod === "upi_qr") {
      return (
        <div className="payment-extra hint">
          Scan the onsite QR code to complete the payment. Once scanned, tap "Place Order" and our team will verify instantly.
        </div>
      );
    }

    if (paymentMethod === "wallet") {
      return (
        <div className="payment-extra hint">
          Wallet balance available: ₹{Number(draft?.wallet?.balance || 0).toFixed(2)}
          {!draft?.wallet?.enabled && <span style={{ color: '#c0392b', marginLeft: 6 }}>• Login required</span>}
        </div>
      );
    }

    if (paymentMethod === "cash") {
      return (
        <div className="payment-extra hint">
          Bring the exact cash amount to the counter. We'll reference your billing ID for quick pickup.
        </div>
      );
    }

    if (isGateway) {
      return (
        <div className="payment-extra">
          <label>Card Details</label>
          <div
            style={{
              border: '1px solid #e3e8ee',
              borderRadius: 12,
              padding: '16px 18px',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
              background: '#fff'
            }}
          >
            <input
              type="text"
              value={cardDetails.number}
              onChange={(e) => setCardDetails((prev) => ({ ...prev, number: e.target.value }))}
              placeholder="Card Number"
              maxLength={19}
              style={{ fontSize: 16, letterSpacing: 0.5 }}
            />
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <input
                type="text"
                value={cardDetails.expiry}
                onChange={(e) => setCardDetails((prev) => ({ ...prev, expiry: e.target.value }))}
                placeholder="MM/YY"
                maxLength={5}
                style={{ width: '90px' }}
              />
              <input
                type="text"
                value={cardDetails.cvv}
                onChange={(e) => setCardDetails((prev) => ({ ...prev, cvv: e.target.value }))}
                placeholder="CVC"
                maxLength={4}
                style={{ width: '80px' }}
              />
              <input
                type="text"
                value={cardDetails.holder}
                onChange={(e) => setCardDetails((prev) => ({ ...prev, holder: e.target.value }))}
                placeholder="Name on Card"
                style={{ flex: 1 }}
              />
            </div>
            <div className="payment-extra hint" style={{ marginTop: 12 }}>
              We never store card data. Details are tokenized with gateway-compliant encryption just like Stripe Elements.
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderStepContent = () => {
    if (step === "select") {
      return (
        <>
          <h2 style={{ marginBottom: 8 }}>How would you like to pay?</h2>
          <p className="payment-intro" style={{ marginBottom: 24 }}>
            Select a payment method to continue. You'll enter the secure details on the next step.
          </p>
          {PAYMENT_GROUPS.map((group) => (
            <div className="payment-group" key={group.id}>
              <div className="payment-group-title">{group.label}</div>
              <div className="payment-options">
                {group.options.map((option) => {
                  const selected = paymentMethod === option.id;
                  return (
                    <label
                      key={option.id}
                      className={`payment-option ${selected ? "selected" : ""}`}
                      style={{ padding: '12px 16px', borderRadius: 10 }}
                    >
                      <input
                        type="radio"
                        name="payment-option"
                        value={option.id}
                        checked={selected}
                        onChange={() => handleOptionSelect(option.id)}
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 32, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="primary-button"
              style={{ minWidth: 160 }}
              onClick={handleContinue}
            >
              Continue
            </button>
          </div>
        </>
      );
    }

    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{methodTitle}</h2>
            <div style={{ color: '#64748b', fontSize: 13 }}>Securely complete the payment below.</div>
          </div>
          <button className="link-button" onClick={handleEditMethod} style={{ fontSize: 13 }}>
            Change method
          </button>
        </div>
        {renderPaymentDetails()}
      </div>
    );
  };

  return (
    <div className="payment-page">
      <div className="payment-layout">
        <div className="payment-card" style={{ flex: 1 }}>
          <button className="link-button" onClick={onBack}>&larr; Back to Cart</button>

          <div style={{ display: 'flex', gap: 16, margin: '20px 0 28px 0' }}>
            {steps.map((s, index) => {
              const active = index <= currentStepIndex;
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    opacity: active ? 1 : 0.4
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: active ? '#635bff' : '#e2e8f0',
                      color: active ? '#fff' : '#475569',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600
                    }}
                  >
                    {index + 1}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{s.caption}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {renderStepContent()}
        </div>

        <div className="payment-card summary" style={{ maxWidth: 360 }}>
          <h3>Order Summary</h3>
          <div className="summary-line">
            <span>Subtotal</span>
            <span>₹{subtotal}</span>
          </div>
          <div className="summary-line">
            <span>Discounts</span>
            <span>-₹{discount}</span>
          </div>
          <div className="summary-total">
            <span>Total Payable</span>
            <span>₹{total}</span>
          </div>

          {draft.scheduledTime ? (
            <div className="summary-meta">Scheduled for {new Date(draft.scheduledTime).toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short"
            })}</div>
          ) : (
            <div className="summary-meta">Immediate pickup after preparation (~15 mins)</div>
          )}

          <div className="payment-extra">
            <label>Special Notes</label>
            <textarea
              value={draft.notes || ""}
              onChange={(e) => onNotesChange?.(e.target.value)}
              maxLength={400}
              placeholder="Allergy info, pickup instructions, etc."
            />
          </div>

          <div className="selected-method">
            <span>Selected Method:</span>
            <strong>{PAYMENT_TITLES[paymentMethod] || "Select a method"}</strong>
          </div>

          <button
            className="primary-button"
            disabled={step !== "details" || isPlacingOrder}
            onClick={handlePlace}
          >
            {isPlacingOrder ? "Processing..." : `Place Order (₹${total})`}
          </button>
          <div className="secure-note">Payments routed through open-source compatible gateway integrations.</div>
        </div>
      </div>
    </div>
  );
};

export default PaymentPage;
