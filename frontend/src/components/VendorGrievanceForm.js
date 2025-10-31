import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { submitVendorGrievance } from "../api";
import { toast } from "react-toastify";

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];

const VendorGrievanceForm = ({ token, onClose }) => {
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState("medium");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const resetForm = () => {
    setSubject("");
    setPriority("medium");
    setDescription("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedSubject = subject.trim();
    const trimmedDescription = description.trim();
    if (trimmedSubject.length < 5) {
      toast.error("Please provide a brief subject (min 5 characters)");
      return;
    }
    if (trimmedDescription.length < 10) {
      toast.error("Description should be at least 10 characters");
      return;
    }
    setSubmitting(true);
    try {
      const response = await submitVendorGrievance(
        {
          subject: trimmedSubject,
          description: trimmedDescription,
          priority
        },
        token
      );
      if (response?.status === "success") {
        toast.success("Your concern has been shared with the admin team");
        resetForm();
        onClose();
      } else {
        toast.error(response?.message || "Could not submit grievance");
      }
    } catch (error) {
      toast.error(error?.message || "Failed to submit grievance");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content vendor-concern-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>Raise a Concern</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" style={{ fontSize: 20 }}>
            ×
          </button>
        </div>
        <p style={{ color: "#6c7a89", fontSize: 14, marginTop: 0 }}>
          Share operational hurdles, billing issues, or any support needed from the admin team.
        </p>
        <form onSubmit={handleSubmit} className="form-vertical">
          <div className="form-group">
            <label htmlFor="vendor-concern-subject">Subject</label>
            <input
              id="vendor-concern-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief title for your concern"
              disabled={submitting}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="vendor-concern-priority">Priority</label>
            <select
              id="vendor-concern-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              disabled={submitting}
            >
              {priorityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="vendor-concern-description">Description</label>
            <textarea
              id="vendor-concern-description"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue with any relevant order IDs, date/time, or screenshots sent separately."
              disabled={submitting}
              required
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Concern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

VendorGrievanceForm.propTypes = {
  token: PropTypes.string.isRequired,
  onClose: PropTypes.func
};

VendorGrievanceForm.defaultProps = {
  onClose: () => {}
};

export default VendorGrievanceForm;
