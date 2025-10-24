import React from "react";

const Payment = ({ cart, scheduledTime, onSuccess }) => {
  const handlePayment = () => {
    alert("Payment Successful! Order placed.");
    onSuccess();
  };

  return (
    <div>
      <h2>Payment</h2>
      <p>
        {scheduledTime
          ? `Order will be ready on: ${new Date(scheduledTime).toLocaleString()}`
          : "Order will be prepared immediately."}
      </p>
      <button disabled={cart.length === 0} onClick={handlePayment}>
        Pay Now
      </button>
    </div>
  );
};

export default Payment;