const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// ==========================================
// CONFIGURAÇÕES (COLE SUAS CHAVES AQUI)
// ==========================================
const VERIFY_TOKEN = "lis_token_123"; 
const ACCESS_TOKEN = "EAANvwn5xPGIBRBz2rznmn0sYtm7j6U7bK02nNTqGaO6IDZCCQ3PiZBFPFhZB0Hi61ydq9YQ4OrecCnzxvejZB6MIRZCHEfeZA6B2buOl6Voev59bEuuljjKMU7tjMg1puOHYEy2lduYDhyrhGanZCxZCOBej4WvCHJMKR65ZBixh1dFrXTw7vomZArjFDZCsamZCbUkn9AZDZD"; 
const PHONE_NUMBER_ID = "1049978348196137"; 
const OPENAI_API_KEY = "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"; 

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const memory = {};

// VERIFICAÇÃO DO WEBHOOK
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VALIDADO COM SUCESSO!");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// PROCESSAMENTO DE MENSAGENS
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message || message.type !== "text") return res.sendStatus(200);

    const from = message.from;
    const text = message.text.body;

    if (!memory[from]) memory[from] = [];
    memory[from].push({ role: "user", content: text });

    // CHAMADA CORRIGIDA PARA GPT-4O-MINI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "Você é a Lis, atendente da PlayPrime IPTV. Planos: 1 tela R$30, 2 telas R$50, 3 telas R$70. Seja direta e vendedora. Link de fechamento: https://wa.me/5521964816185" 
        },
        ...memory[from]
      ],
    });

    const resposta = completion.choices[0].message.content;
    memory[from].push({ role: "assistant", content: resposta });

    // ENVIO PARA WHATSAPP
    await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: from,
      text: { body: resposta },
    }, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ ERRO NO SISTEMA:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("=====================================");
  console.log("🚀 ARMADURA MARK 85: LIS ONLINE!");
  console.log("=====================================");
});
