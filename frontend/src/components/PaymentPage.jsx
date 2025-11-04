import React, { useMemo, useState } from "react";

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
    holder: ""
  });

  const total = Number(draft?.totals?.totalPayable ?? 0).toFixed(2);
  const subtotal = Number(draft?.totals?.subtotalBeforeDiscount ?? total).toFixed(2);
  const discount = Number(draft?.totals?.discountTotal ?? 0).toFixed(2);

  const upiApps = useMemo(
    () => PAYMENT_GROUPS.find((g) => g.id === "upi")?.options.filter((opt) => opt.id.startsWith("upi_app")) || [],
    []
  );

  const handleOptionSelect = (optionId) => {
    if (typeof onPaymentMethodChange === "function") {
      onPaymentMethodChange(optionId);
    }
  };

  const handlePlace = () => {
    const method = inferMethod(paymentMethod);
    const payload = {};

    const notify = (message, type = "error") => {
      if (typeof emitToast === "function") {
        emitToast(type, message);
      } else {
        if (type === "error") alert(message);
        else console.log(message);
      }
    };

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

  return (
    <div className="payment-page">
      <div className="payment-layout">
        <div className="payment-card">
          <button className="link-button" onClick={onBack}>&larr; Back to Cart</button>
          <h2>Choose Payment Method</h2>
          <p className="payment-intro">
            We support a wide range of open-source friendly payment options. Pick what works best for you and complete the order via our internal gateway powered by Razorpay open-source SDK integrations.
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

          {paymentMethod === "upi_id" && (
            <div className="payment-extra">
              <label>Enter UPI ID</label>
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="example@upi"
              />
            </div>
          )}

          {paymentMethod.startsWith("upi_app") && (
            <div className="payment-extra hint">
              Selected UPI App: {upiApps.find((app) => app.id === paymentMethod)?.label || "UPI App"}. You will be prompted on the selected app to authorize this payment.
            </div>
          )}

          {paymentMethod === "upi_qr" && (
            <div className="payment-extra hint">
              Scan the QR code displayed on the kiosk to complete the payment. Our staff will confirm the transaction.
            </div>
          )}

          {paymentMethod === "wallet" && (
            <div className="payment-extra hint">
              Wallet balance available: ₹{Number(draft?.wallet?.balance || 0).toFixed(2)}
              {!draft?.wallet?.enabled && <span style={{ color: '#c0392b', marginLeft: 6 }}>• Login required</span>}
            </div>
          )}

          {paymentMethod === "cash" && (
            <div className="payment-extra hint">
              Please carry the exact amount and hand it over at pickup. A receipt will be provided.
            </div>
          )}

          {inferMethod(paymentMethod) === "gateway" && (
            <div className="payment-extra">
              <label>Card Details</label>
              <input
                type="text"
                value={cardDetails.number}
                onChange={(e) => setCardDetails((prev) => ({ ...prev, number: e.target.value }))}
                placeholder="Card Number"
                maxLength={19}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <input
                  type="text"
                  value={cardDetails.expiry}
                  onChange={(e) => setCardDetails((prev) => ({ ...prev, expiry: e.target.value }))}
                  placeholder="MM/YY"
                  maxLength={5}
                  style={{ width: '80px' }}
                />
                <input
                  type="text"
                  value={cardDetails.holder}
                  onChange={(e) => setCardDetails((prev) => ({ ...prev, holder: e.target.value }))}
                  placeholder="Name on Card"
                />
              </div>
            </div>
          )}
        </div>

        <div className="payment-card summary">
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
            disabled={isPlacingOrder}
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
