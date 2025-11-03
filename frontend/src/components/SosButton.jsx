import React from "react";
import PropTypes from "prop-types";

const SosButton = ({ isActive, onTrigger, onResolve, disabled }) => {
  const handleClick = () => {
    if (isActive) {
      const confirmResolve = window.confirm("Resolve the active SOS alert and notify everyone that the hazard is cleared?");
      if (!confirmResolve) return;
      onResolve?.();
    } else {
      const confirmTrigger = window.confirm("Trigger SOS alert and notify everyone to evacuate? This will send hazard alerts to all employees.");
      if (!confirmTrigger) return;
      onTrigger?.();
    }
  };

  return (
    <div className="sos-button-container">
      <button
        type="button"
        className={`sos-button ${isActive ? "active" : ""}`}
        onClick={handleClick}
        disabled={disabled}
      >
        {isActive ? "Resolve SOS" : "SOS"}
      </button>
      <p className="sos-button-caption">
        {isActive ? "Tap to send all-clear" : "Emergency evacuation alert"}
      </p>
    </div>
  );
};

SosButton.propTypes = {
  isActive: PropTypes.bool,
  onTrigger: PropTypes.func,
  onResolve: PropTypes.func,
  disabled: PropTypes.bool
};

SosButton.defaultProps = {
  isActive: false,
  onTrigger: null,
  onResolve: null,
  disabled: false
};

export default SosButton;
