import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "76px",
        background: "#0b0d11",
        color: "#edf0f5",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          color: "#91aaff",
          fontSize: 28,
          fontWeight: 700,
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: "#4158b4",
          }}
        />{" "}
        HOLYMEDIA MCP
      </div>
      <div
        style={{
          marginTop: 42,
          maxWidth: 900,
          fontSize: 70,
          fontWeight: 700,
          lineHeight: 1.08,
        }}
      >
        AI-доступ к рекламным кабинетам
      </div>
      <div style={{ marginTop: 24, color: "#a4adbb", fontSize: 30 }}>
        Рекламная аналитика и отчёты в вашем AI-чате
      </div>
    </div>,
    size,
  );
}
