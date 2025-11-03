import React, { useState } from "react";
import { submitGrievance } from "../api";
import { toast } from "react-toastify";

const GrievanceModal = ({ order, onClose }) => {
  const [issueType, setIssueType] = useState("food_quality");
  const [description, setDescription] = useState("");
  const [contactPreference, setContactPreference] = useState("email");

  const handleSubmit = async () => {
    if (!description.trim()) {
      toast.error("Please describe your issue");
      return;
    }

    try {
      await submitGrievance({
        orderId: order.id,
        billingId: order.billingId,
        issueType,
        description,
        contactPreference,
        shopId: order.shopId
      });
      toast.success("Your complaint has been submitted. We'll contact you soon.");
      onClose();
    } catch (error) {
      toast.error("Failed to submit complaint");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <h3>Report Issue - Order #{order.billingId}</h3>
        
        <div style={{ background: "#f8f9fa", padding: 15, borderRadius: 6, marginBottom: 20 }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: 14 }}>Customer Support Contact</h4>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div>📞 <strong>Phone:</strong> +91-80-4112-3456</div>
            <div>📧 <strong>Email:</strong> foodcourt.support@infosys.com</div>
            <div>⏰ <strong>Hours:</strong> 8:00 AM - 8:00 PM (Mon-Sat)</div>
            <div>📍 <strong>Location:</strong> Ground Floor, Building 12</div>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <label style={{ display: "block", marginBottom: 10, fontWeight: "bold" }}>
            Issue Type:
          </label>
          <select 
            value={issueType} 
            onChange={(e) => setIssueType(e.target.value)}
            style={{ width: "100%", padding: 10 }}
          >
            <option value="food_quality">Food Quality Issue</option>
            <option value="wrong_order">Wrong Order Received</option>
            <option value="missing_items">Missing Items</option>
            <option value="service_issue">Service Issue</option>
            <option value="hygiene">Hygiene Concern</option>
            <option value="delay">Excessive Delay</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div style={{ marginTop: 20 }}>
          <label style={{ display: "block", marginBottom: 10, fontWeight: "bold" }}>
            Describe Your Issue:
          </label>
          <textarea 
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Please provide details about your complaint..."
            style={{ width: "100%", padding: 10, minHeight: 120, fontFamily: "inherit" }}
          />
        </div>

        <div style={{ marginTop: 20 }}>
          <label style={{ display: "block", marginBottom: 10, fontWeight: "bold" }}>
            Preferred Contact Method:
          </label>
          <select 
            value={contactPreference} 
            onChange={(e) => setContactPreference(e.target.value)}
            style={{ width: "100%", padding: 10 }}
          >
            <option value="email">Email</option>
            <option value="phone">Phone Call</option>
            <option value="in_person">In Person</option>
          </select>
        </div>

        <div style={{ marginTop: 25, display: "flex", gap: 10 }}>
          <button onClick={handleSubmit} style={{ flex: 1, background: "#e74c3c", padding: "12px" }}>
            Submit Complaint
          </button>
          <button onClick={onClose} style={{ background: "#95a5a6", padding: "12px" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default GrievanceModal;