const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// =============================
// CONFIGURAÇÕES (CORRIGIDAS)
// =============================
const VERIFY_TOKEN = "lis_token_123";
const ACCESS_TOKEN = "EAANvwn5xPGIBRFVpOEMaVOA8oWIui3Ht7BBCocV1z2PkxugL0oLC11cZCw9H0ZAA3rVyJpZA3HT6IoUUdYDMHHA9XoLxnZBmfYVbcFCMHL5VoJ86DowHU0ERiAJZB5vQcgCE3j1XEmy1uuE6ZAhJGinD9yxZCYmWx57bB4WDSN0qxmkfJs90eEZCaRAlqLt2oxeyZCgZDZD";
const PHONE_NUMBER_ID = "1049978348196137";
const OPENAI_API_KEY = "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";

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const memory = {};

// =============================
// VERIFICAÇÃO WEBHOOK (O QUE A META PRECISA)
// =============================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// =============================
// RECEBER MENSAGENS
// =============================
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== "text") return res.sendStatus(200);

    const from = message.from;
    const text = message.text.body;

    if (!memory[from]) memory[from] = [];
    memory[from].push({ role: "user", content: text });

    // COMANDO E MODELO CORRIGIDOS ABAIXO
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      messages: [
        {
          role: "system",
          content: "Você é a Lis, atendente da PlayPrime IPTV. PLANOS: 1 tela: R$30, 2 telas: R$50, 3 telas: R$70. OBJETIVO: Vender. FECHAMENTO: https://wa.me/5521964816185"
        },
        ...memory[from],
      ],
    });

    const resposta = completion.choices[0].message.content;
    memory[from].push({ role: "assistant", content: resposta });

    await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: from,
      text: { body: resposta },
    }, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("ERRO:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 LIS ONLINE NA PORTA", PORT));
