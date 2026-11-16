# image-describer

image-describer é uma ferramenta de linha de comando (CLI) que utiliza a API do ChatGPT com o modelo gpt-4o para gerar descrições acessíveis e detalhadas de imagens, especialmente para uso em atributos alt e tecnologias assistivas.

## Formatos suportados

| Formato | Suporte |
|---------|---------|
| PNG, JPEG, WEBP | Enviados diretamente à API |
| SVG | Convertido localmente para PNG (mín. 1024 px de largura, máx. 2048 px no maior lado, fundo branco) |
| GIF (inclusive animado) | Convertido localmente para PNG a partir do primeiro quadro |

A API de visão da OpenAI não aceita SVG nem GIF animado, então essas imagens são baixadas e rasterizadas com [`@resvg/resvg-wasm`](https://github.com/yisibl/resvg-js) (WASM, sem dependências nativas — funciona também nos binários gerados pelo `yarn build`). A detecção usa a extensão da URL; para URLs sem extensão, se a API recusar a imagem, o conteúdo é inspecionado e convertido automaticamente. Textos dentro de SVGs são renderizados com fontes comuns do sistema (Arial, DejaVu, Liberation etc.).

## Requisitos

- Node.js v18+
- Yarn v1+
- Conta na OpenAI
- Chave de API do ChatGPT com acesso ao modelo gpt-4o

## Instalação

Clone o repositório:

```bash
git clone https://github.com/seu-usuario/image-describer.git
cd image-describer
```

Instale as dependências:

```bash
yarn install
```

Configure sua chave da OpenAI em um arquivo `.env`:

```bash
echo 'OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx' > .env
```

Registre o comando globalmente com:

```bash
yarn link
```

Após isso, o comando `describe` estará disponível globalmente no seu terminal.

## Uso

### Gerar descrição de uma única imagem por URL:

```bash
describe --url https://example.com/imagem.png
```

### Processar várias imagens de um arquivo .txt

Crie um arquivo com links públicos (um por linha), por exemplo:

```
https://site.com/img1.png
https://site.com/img2.jpg
```

Por organização, guarde as listas de URLs em `data/entradas/` e os CSVs gerados em `data/saidas/` (a pasta `data/` fica fora do Git). A pasta do `--output` é criada automaticamente se não existir.

Execute:

```bash
describe --file data/entradas/imagens.txt
```

Por padrão, isso gerará um arquivo CSV chamado:

```
output-YYYY-MM-DD-HHmm.csv
```

### Personalizar o nome do CSV:

```bash
describe --file data/entradas/imagens.txt --output data/saidas/resultado.csv
```

### Retomar um processamento interrompido

Se o processamento parar antes de terminar (por exemplo, créditos da OpenAI esgotados, chave inválida, ou qualquer outra falha), use `--resume` apontando para o mesmo `--output` para continuar de onde parou, sem refazer as imagens já concluídas com sucesso:

```bash
describe --file data/entradas/imagens.txt --output data/saidas/resultado.csv --resume
```

Imagens que já têm uma descrição no CSV são puladas; imagens ausentes ou marcadas com `ERRO:` são (re)processadas.

## Estrutura do CSV gerado

| URL                          | Description               |
|-----------------------------|---------------------------|
| https://.../img1.png        | Descrição gerada pela IA  |
| https://.../img2.png        | Descrição gerada pela IA  |

## Variáveis de ambiente

- `OPENAI_API_KEY`: sua chave de API da OpenAI (obrigatório)

Você pode definir no `.env` ou exportar diretamente no terminal:

```bash
export OPENAI_API_KEY=sk-xxxx
```

## Desinstalar o comando global

Se desejar remover o comando `describe`:

```bash
yarn unlink
```

## Licença

MIT © Gustavo Leitão