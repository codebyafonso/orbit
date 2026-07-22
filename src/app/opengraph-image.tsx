import { ImageResponse } from "next/og";

export const alt = "ORBIT — seus projetos da Vercel em um so lugar";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Imagem de preview gerada no servidor.
 *
 * Sem fonte externa de proposito: baixar arquivo de fonte a cada geracao
 * adicionaria uma dependencia de rede a algo que precisa responder rapido para
 * o robo do LinkedIn/WhatsApp.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#08090b",
          backgroundImage:
            "radial-gradient(900px 500px at 10% -10%, rgba(255,176,32,0.16), transparent 60%), radial-gradient(700px 420px at 100% 0%, rgba(61,220,132,0.08), transparent 55%)",
          padding: 72,
          fontFamily: "system-ui, sans-serif",
          color: "#e8e6e1",
          border: "1px solid #24282d",
        }}
      >
        {/* topo: etiqueta */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: "#ffb020" }} />
          <div
            style={{
              fontSize: 20,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: "#7c848d",
            }}
          >
            painel de controle // vercel
          </div>
        </div>

        {/* meio: nome e promessa */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <div style={{ fontSize: 156, fontWeight: 800, lineHeight: 0.9, letterSpacing: -4 }}>
              ORBIT
            </div>
            <div style={{ fontSize: 156, fontWeight: 800, lineHeight: 0.9, color: "#ffb020" }}>
              .
            </div>
          </div>
          <div style={{ fontSize: 34, color: "#7c848d", maxWidth: 900, lineHeight: 1.35 }}>
            Seus projetos hospedados na Vercel em um so lugar — com radar de higiene, tendencias e
            exclusao protegida.
          </div>
        </div>

        {/* base: os tres recursos */}
        <div style={{ display: "flex", gap: 16 }}>
          {["radar de higiene", "tendencias", "linha do tempo"].map((item) => (
            <div
              key={item}
              style={{
                display: "flex",
                fontSize: 22,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "#e8e6e1",
                border: "1px solid #24282d",
                padding: "14px 22px",
                background: "#0e1013",
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
