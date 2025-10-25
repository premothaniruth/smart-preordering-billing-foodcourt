import React, { useState } from "react";
import { submitRating } from "../api";
import { toast } from "react-toastify";

const RatingModal = ({ orderId, onClose }) => {
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [hoveredRating, setHoveredRating] = useState(0);

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error("Please select a rating");
      return;
    }

    try {
      await submitRating(orderId, rating, feedback);
      toast.success("Thank you for your feedback!");
      onClose();
    } catch (error) {
      toast.error("Failed to submit rating");
    }
  };

  const handleSkip = () => {
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <h3>Rate Your Experience</h3>
        <p style={{ fontSize: 14, color: "#666" }}>How was your order?</p>

        <div style={{ textAlign: "center", margin: "30px 0" }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <span
              key={star}
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
              style={{
                fontSize: 48,
                cursor: "pointer",
                color: (hoveredRating || rating) >= star ? "#f39c12" : "#ddd",
                transition: "color 0.2s"
              }}
            >
              ⭐
            </span>
          ))}
        </div>

        {rating > 0 && (
          <div style={{ textAlign: "center", marginBottom: 20, fontSize: 14, color: "#666" }}>
            {rating === 5 && "Excellent! 🎉"}
            {rating === 4 && "Very Good! 👍"}
            {rating === 3 && "Good 👌"}
            {rating === 2 && "Could be better 😐"}
            {rating === 1 && "Needs improvement 😞"}
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <label style={{ display: "block", marginBottom: 10, fontWeight: "bold", fontSize: 14 }}>
            Additional Feedback (Optional):
          </label>
          <textarea 
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Tell us more about your experience..."
            style={{ width: "100%", padding: 10, minHeight: 80, fontFamily: "inherit", fontSize: 14 }}
          />
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <button onClick={handleSubmit} style={{ flex: 1, background: "#27ae60", padding: "12px" }}>
            Submit Rating
          </button>
          <button onClick={handleSkip} style={{ background: "#95a5a6", padding: "12px" }}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
};

export default RatingModal;