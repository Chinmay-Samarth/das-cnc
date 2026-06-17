// components/ImageLightbox.jsx
import { useEffect } from "react";

export default function ImageLightbox({ src, alt = "", onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.85)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 16, right: 20,
          background: "none", border: "none", color: "#fff",
          fontSize: 28, cursor: "pointer", lineHeight: 1,
        }}
        aria-label="Close"
      >
        ×
      </button>

      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()} // don't close when clicking the image itself
        style={{
          maxWidth: "90vw", maxHeight: "90vh",
          objectFit: "contain", borderRadius: 8,
        }}
      />
    </div>
  );
}