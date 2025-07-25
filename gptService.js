import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateImageDescription(imageUrl) {
    const prompt = `
        Você é um especialista em acessibilidade digital e comunicação inclusiva. Sua tarefa é analisar a imagem fornecida e gerar uma descrição longa, detalhada e clara, adequada para o atributo alt em HTML.

        A descrição deve:
        - Permitir que uma pessoa com deficiência visual compreenda o conteúdo e o contexto visual da imagem.
        - Ser precisa, descritiva e visualmente rica, informando o que aparece, como está disposto, as cores, as relações espaciais e o propósito da imagem.
        - Evitar redundância como "imagem de", "foto de", etc.
        - Ter no máximo 300 palavras.
    `;

    const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    {
                        type: "image_url",
                        image_url: {
                            url: imageUrl,
                        },
                    },
                ],
            },
        ],
        max_tokens: 1000,
    });

    return completion.choices[0].message.content.trim();
}