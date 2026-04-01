// RAILWAY PROXY - Node.js ESM
// Deploy este arquivo no Railway para fazer mTLS com a API PIX da Efí
// Variáveis de ambiente necessárias: EFI_PROXY_SECRET, EFI_CLIENT_ID,
// EFI_CLIENT_SECRET, EFI_PIX_KEY, EFI_CERT_BASE64

import express from "express";
import https from "https";

const app = express();
app.use(express.json());

const getEnv = (k) => process.env[k]; // eslint-disable-line
const PORT = getEnv("PORT") || 3000;
const PROXY_SECRET = getEnv("EFI_PROXY_SECRET");
const EFI_CLIENT_ID = getEnv("EFI_CLIENT_ID");
const EFI_CLIENT_SECRET = getEnv("EFI_CLIENT_SECRET");
const EFI_PIX_KEY = getEnv("EFI_PIX_KEY");
const EFI_CERT_BASE64 = getEnv("EFI_CERT_BASE64");

// Auth middleware
app.use((req, res, next) => {
  if (!PROXY_SECRET || req.headers["x-proxy-secret"] !== PROXY_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

function createEfiAgent() {
  const certBuffer = Buffer.from(EFI_CERT_BASE64, "base64"); // eslint-disable-line
  return new https.Agent({ pfx: certBuffer, passphrase: "" });
}

async function getEfiToken(agent) {
  const credentials = Buffer.from(`${EFI_CLIENT_ID}:${EFI_CLIENT_SECRET}`).toString("base64"); // eslint-disable-line
  const res = await fetch("https://pix.api.efipay.com.br/oauth/token", {
    method: "POST",
    headers: { "Authorization": `Basic ${credentials}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials" }),
    agent,
  });
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

app.post("/pix/cobranca", async (req, res) => {
  try {
    const { leadId, amount, cpf, name } = req.body;
    if (!leadId || !amount || !cpf || !name) {
      return res.status(400).json({ error: "Parâmetros obrigatórios: leadId, amount, cpf, name" });
    }

    const agent = createEfiAgent();
    const token = await getEfiToken(agent);

    const cobRes = await fetch("https://pix.api.efipay.com.br/v2/cob", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        calendario: { expiracao: 3600 },
        devedor: { cpf, nome: name },
        valor: { original: Number(amount).toFixed(2) },
        chave: EFI_PIX_KEY,
        solicitacaoPagador: `Limpa Nome - Pedido #${leadId}`,
      }),
      agent,
    });

    if (!cobRes.ok) throw new Error(`Cobrança error: ${await cobRes.text()}`);
    const cob = await cobRes.json();

    let qrCode = null;
    let pixCopiaECola = null;

    if (cob.loc?.id) {
      const qrRes = await fetch(`https://pix.api.efipay.com.br/v2/loc/${cob.loc.id}/qrcode`, {
        headers: { "Authorization": `Bearer ${token}` },
        agent,
      });
      if (qrRes.ok) {
        const qr = await qrRes.json();
        qrCode = qr.imagemQrcode;
        pixCopiaECola = qr.qrcode;
      }
    }

    return res.json({ txid: cob.txid, qrCode, pixCopiaECola, valor: Number(amount).toFixed(2) });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.listen(PORT, () => console.log(`Proxy rodando na porta ${PORT}`));
