import React, { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";

const VendorConcernsMenu = ({ onRaiseNew, onViewStatus }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="concern-menu" ref={menuRef}>
      <button className="secondary-button" type="button" onClick={() => setOpen((prev) => !prev)}>
        Raise Concern
      </button>
      {open && (
        <div className="concern-dropdown">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onRaiseNew();
            }}
          >
            New Concern
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onViewStatus();
            }}
          >
            View Status
          </button>
        </div>
      )}
    </div>
  );
};

VendorConcernsMenu.propTypes = {
  onRaiseNew: PropTypes.func.isRequired,
  onViewStatus: PropTypes.func.isRequired
};

export default VendorConcernsMenu;
