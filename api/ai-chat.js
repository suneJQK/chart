module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY on server" });
    return;
  }

  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const chartReport = typeof body.chartReport === "string" ? body.chartReport : "Chua co du lieu chart.";

    const cleanedMessages = messages
      .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .slice(-12)
      .map((item) => ({ role: item.role, content: item.content.trim() }));

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "Ban la chuyen gia chiem tinh Tay phuong. Tra loi bang tieng Viet co dau, ro rang, trung lap, co canh bao ve gioi han cua chiem tinh. Khong khang dinh tuyet doi ve suc khoe, tai chinh, phap ly."
          },
          {
            role: "system",
            content: `Du lieu ban do sao hien tai:\n${chartReport}`
          },
          ...cleanedMessages
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || "OpenAI request failed";
      res.status(response.status).json({ error: message });
      return;
    }

    const reply = data?.choices?.[0]?.message?.content?.trim();
    res.status(200).json({ reply: reply || "AI chua tra ve noi dung." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    res.status(500).json({ error: message });
  }
};