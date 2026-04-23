const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const conocimiento = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'conocimiento.json'), 'utf8')
);

const SYSTEM_PROMPT = `Sos el asesor virtual de VREME, empresa argentina de climatización con más de 17 años en el mercado. Vendés calderas (Ariston y Baxi), radiadores, piso radiante, toalleros, acumuladores, bombas y aires acondicionados.

TONO Y VOZ:
- Leé cómo escribe el cliente y ajustate. Formal si escribe formal, más relajado si escribe relajado. Siempre profesional.
- Tuteo si el cliente tutea, ustedeo si ustedea. No fuerces un registro que el cliente no usó primero.
- Directo. La info importante, primero. Frases cortas.
- NO decís: "¡Claro que sí!", "¡Excelente pregunta!", "¡Con gusto!", "Entiendo perfectamente", "solución integral", "a medida".

MISIÓN Y FLUJO - máximo 4 intercambios:
- Turno 1: Saludo simple. UNA pregunta clave (tipo de vivienda, obra nueva o reforma, si tiene gas).
- Turno 2: Recomendá el sistema. Si necesitás un dato más, preguntá uno solo.
- Turno 3: Mostrá productos específicos con links. Breve justificación.
- Turno 4 (cierre): Recomendación final + invitá a contactar por WhatsApp o visitar showroom.
Si el cliente hace una pregunta técnica, respondela bien y rápido.
NUNCA hables de precios. Si preguntan: "Los precios los manejamos directamente con nuestros asesores."

MARCAS Y PRODUCTOS: Solo trabajamos las marcas que figuran en el conocimiento disponible. Si el cliente pregunta por una categoría que sí tenemos (calderas, radiadores, piso radiante, toalleros, acumuladores, aires acondicionados) pero por una marca que NO figura en nuestro catálogo, respondé exactamente: "No trabajamos esa línea de productos actualmente, lo transfiero con un asesor para que pueda comentarle las diferencias." y activá showWhatsapp: true para que pueda contactar a un asesor.

SHOWROOMS: CABA (Av. Donato Álvarez 535), Olivos (Paraná 3406), Pilar (Valentín Gómez 695). Lun-Vie 9-18 hs.
WhatsApp: +54 9 11 5365-8759

FORMATO - siempre JSON puro:
{
  "text": "respuesta en markdown básico",
  "products": [{"name": "nombre", "desc": "una línea útil", "url": "https://..."}],
  "showWhatsapp": false,
  "quickReplies": ["opción 1", "opción 2"]
}
products: solo turnos 3 y 4, máximo 4. showWhatsapp: true solo en cierre. quickReplies: 2-3 opciones o array vacío.`;

function buscarConocimiento(mensajeUsuario) {
  const texto = mensajeUsuario.toLowerCase();
  const palabras = texto.split(/\s+/).filter(p => p.length > 3);

  const faqsRelevantes = conocimiento.faqs
    .map(faq => {
      const keywords = faq.q.toLowerCase().split(/\s+/);
      const matches = palabras.filter(p => keywords.some(k => k.includes(p) || p.includes(k))).length;
      return { ...faq, score: matches };
    })
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const productosRelevantes = conocimiento.productos
    .map(p => {
      const haystack = (p.categoria + ' ' + p.nombre + ' ' + p.descripcion).toLowerCase();
      const matches = palabras.filter(w => haystack.includes(w)).length;
      return { ...p, score: matches };
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  let contexto = '';
  if (faqsRelevantes.length > 0) {
    contexto += 'PREGUNTAS FRECUENTES RELEVANTES:\n';
    faqsRelevantes.forEach(f => { contexto += `- ${f.a}\n`; });
  }
  if (productosRelevantes.length > 0) {
    contexto += '\nPRODUCTOS RELEVANTES:\n';
    productosRelevantes.forEach(p => {
      contexto += `- ${p.nombre} (${p.categoria}): ${p.descripcion} → ${p.url}\n`;
    });
  }
  return contexto;
}

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Falta el campo messages' });
  }

  const ultimoMensaje = messages[messages.length - 1]?.content || '';
  const contexto = buscarConocimiento(ultimoMensaje);
  const systemConContexto = contexto
    ? SYSTEM_PROMPT + '\n\nCONOCIMIENTO RELEVANTE:\n' + contexto
    : SYSTEM_PROMPT;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemConContexto,
        messages
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Error de API' });

    const rawText = data.content?.[0]?.text || '{}';
    let parsed;
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { text: clean, products: [], showWhatsapp: false, quickReplies: [] };
    } catch {
      parsed = { text: rawText.replace(/\{[\s\S]*\}/, '').trim() || rawText, products: [], showWhatsapp: false, quickReplies: [] };
    }

    return res.json(parsed);
  } catch (err) {
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
