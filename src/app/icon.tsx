import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Favicon: a inicial sobre o ambar da marca. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#08090b",
          color: "#ffb020",
          fontSize: 22,
          fontWeight: 800,
          fontFamily: "system-ui, sans-serif",
          border: "1px solid #24282d",
        }}
      >
        O
      </div>
    ),
    size,
  );
}
