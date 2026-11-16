import { OpenAI } from "openai";
import dotenv from "dotenv";
import { convertibleTypeFromUrl, detectConvertibleType, fetchImage, toPngDataUrl } from "./imageConverter.js";

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
        - Não deve conter CARACTERES ESPECIAIS, como ENTER, aspas nem parágrafos. 
        - ADICIONAR: Descrição da imagem: ao início de todas as descrições.
        - ADICIONAR: Fim da descrição. ao final de todas  as descrições.
        - SUBSTITUIR TODAS: “” (este tipo de aspas) por este ´´´´
        - Descrever cores, apenas quando forem necessárias para a compreensão do conteúdo da imagem.
        - Quando for o caso de imagens com códigos fontes considerar todas as quebras de linhas nele presentes.
    `;

    // A API não aceita SVG nem GIF animado: quando a URL indica um desses formatos,
    // baixa e converte para PNG antes de enviar (GIF vira o primeiro quadro).
    const urlType = convertibleTypeFromUrl(imageUrl);
    if (urlType) {
        const { contentType, buffer } = await fetchImage(imageUrl);
        const type = detectConvertibleType(contentType, buffer) || urlType;
        return requestDescription(prompt, await toPngDataUrl(type, buffer));
    }

    try {
        return await requestDescription(prompt, imageUrl);
    } catch (err) {
        // URL sem extensão que serve SVG/GIF (ex.: /render?id=123): a API recusa
        // com 400. Nesse caso baixa, confirma o formato e tenta de novo como PNG.
        if (err?.status !== 400) throw err;
        let fetched;
        try {
            fetched = await fetchImage(imageUrl);
        } catch {
            throw err;
        }
        const type = detectConvertibleType(fetched.contentType, fetched.buffer);
        if (!type) throw err;
        return requestDescription(prompt, await toPngDataUrl(type, fetched.buffer));
    }
}

async function requestDescription(prompt, imageUrl) {
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