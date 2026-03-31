const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// =========================================================
// 🛡️ CONFIGURAÇÕES - INSIRA SEUS DADOS ENTRE AS ASPAS
// =========================================================
const VERIFY_TOKEN = "lis_token_123"; 
const ACCESS_TOKEN = "EAANvwn5xPGIBRBeaUAge4DvVG4ujPahMDZCdmMZCke2jAzDtVCOZAFk7EuAGZC6BjyrpAURbZBf6O21B1NuRmRdygyt5XsbgFTrN82cSbxvix6rDbujRq6o04OyOPZCduUYZB7XgPfZCxVjKUj0hZB5fx5DBGg5nqyPzmKVHIEeSmdHZAojsT03IcqbIzqlQUY59Q3yQZDZD"; 
const PHONE_NUMBER_ID = "1049978348196137"; 
const OPENAI_API_KEY = "sk-proj-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"; 

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const memory = {};

// 1. VALIDAÇÃO DO WEBHOOK (PARA O PAINEL DA META FICAR VERDE)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VALIDADO PELA META!");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// 2. RECEBIMENTO DE MENSAGENS
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // Ignora se não for mensagem de texto ou se for status de leitura
    if (!message || !message.text) return res.sendStatus(200);

    const from = message.from;
    const text = message.text.body;

    console.log(`📩 Mensagem recebida de ${from}: ${text}`);

    if (!memory[from]) memory[from] = [];
    memory[from].push({ role: "user", content: text });

    // 3. CHAMADA PARA A OPENAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "Você é a Lis, atendente da PlayPrime IPTV. Planos: 1 tela R$30, 2 telas R$50, 3 telas R$70. Seja direta e vendedora. Link de fechamento: https://wa.me/5521964816185" 
        },
        ...memory[from].slice(-6) // Mantém as últimas 6 mensagens na memória
      ],
    });

    const resposta = completion.choices[0].message.content;
    memory[from].push({ role: "assistant", content: resposta });

    // 4. ENVIO PARA O WHATSAPP
    await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: resposta },
    }, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    res.sendStatus(200);
  } catch (error) {
    // Log detalhado para sabermos se o erro é a chave ou saldo
    const errorMsg = error.response?.data?.error?.message || error.message;
    console.error("❌ ERRO NO PROCESSAMENTO:", errorMsg);
    
    // Responde 200 para a Meta não ficar tentando reenviar a mesma mensagem com erro
    res.sendStatus(200); 
  }
});

// INICIALIZAÇÃO DO SERVIDOR
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("=====================================");
  console.log("🚀 ARMADURA MARK 85: LIS ONLINE!");
  console.log("=====================================");
});
