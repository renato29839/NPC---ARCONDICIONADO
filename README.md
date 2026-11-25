# NPC - Manutenção de Ar Condicionado

Formulário web (funciona como app no celular) para registrar ordens de serviço de manutenção
de ar condicionado das unidades MATRIZ, LIFE e SUL. Cada envio grava uma linha na planilha
**NPC - CONTROLE DE OS - AR CONDICIONADOS**, salva fotos e assinatura no Google Drive e gera
o PDF da OS.

## O que o formulário faz

- **Número de OS** sequencial por ano (`OS-2026-0001`), gerado pelo Apps Script.
- **PDF da OS** com dados, checklist, fotos e assinatura, salvo na pasta da OS no Drive e
  enviado por e-mail (opcional).
- **Checklist PMOC** na manutenção preventiva (Lei 13.589/2018), com medições opcionais.
- **Funciona sem internet**: o relatório fica guardado no aparelho e é enviado sozinho quando a
  conexão volta. Um aviso amarelo mostra quantos estão aguardando.
- **App instalável**: no celular, use "Adicionar à tela inicial".
- **Sem duplicidade**: cada envio tem um ID; reenvios não criam outra linha.
- **Locais padronizados**: o campo de localização sugere os nomes já usados na planilha, para o
  histórico de cada máquina não se dividir ("Sala 4" × "Sala 04").
- **Etiquetas QR Code** (pasta `etiquetas/`): ao escanear a etiqueta colada no aparelho, o
  formulário abre já preenchido com cliente, local, marca, modelo, série e capacidade.
- **Revisão antes de enviar**, ditado por voz e rascunho automático.

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `index.html`, `style.css`, `script.js` | O formulário |
| `etiquetas/` (`index.html`, `etiquetas.css`, `etiquetas.js`) | Gerador e impressão de etiquetas QR, separado do formulário |
| `sw.js`, `manifest.webmanifest`, `icons/` | App instalável e abertura offline |
| `apps-script/Codigo.gs` | Código do Google Apps Script (servidor) |

## Publicar o formulário

O site é estático. Com o GitHub Pages: **Settings > Pages > Deploy from a branch > main / (root)**.
O app offline exige `https` (o GitHub Pages já usa).

## Configurar o Apps Script

1. Abra a planilha > **Extensões > Apps Script**.
2. Substitua o conteúdo do arquivo de código pelo de `apps-script/Codigo.gs` e salve.
3. Em **Configurações do projeto > Propriedades do script**, crie (todas opcionais, mas
   `CODIGO_ACESSO` é muito recomendada):
   - `CODIGO_ACESSO`: código que os técnicos digitam no formulário. Sem ele, qualquer pessoa
     que descubra a URL consegue gravar na planilha.
   - `EMAIL_COPIA`: e-mails (separados por vírgula) que recebem o PDF de toda OS.
   - `LOGO_FILE_ID`: ID de uma imagem do logo no Drive, para o cabeçalho do PDF.
4. **Implantar > Gerenciar implantações > editar (lápis) > Versão: Nova versão > Implantar.**
   Editar a implantação existente mantém a mesma URL `/exec`. Executar como: **Eu**; acesso:
   **Qualquer pessoa**.
5. Na primeira execução o Google pede autorização para Planilhas, Drive e Gmail (envio do PDF).
   Para disparar essa autorização, rode qualquer função manualmente no editor (por exemplo `doGet`).

Se criar uma implantação nova (URL diferente), atualize `API_URL` no começo do `script.js`.

### Planilha

Os dados vão para a aba **Página1** (pelo nome, não pela posição). As 17 colunas originais
continuam na mesma ordem; as novas são acrescentadas à direita e o cabeçalho delas é criado
automaticamente no primeiro envio: Nº da OS, ID do Envio, Técnico, Responsável na Unidade,
Cargo do Responsável, Hora Início, Hora Término, Capacidade (BTUs), Gás Refrigerante,
Checklist PMOC, Medições, E-mail da OS e PDF da OS. Erros vão para a aba **LOG_ERROS**.

As fotos, a assinatura e o PDF de cada OS ficam em `EVIDENCIAS_MANUTENCAO/<nº da OS> - <cliente> - <local>`
no Drive de quem publicou o Apps Script.

## Etiquetas QR

Abra `<endereço do site>/etiquetas/` no site publicado, cadastre cada aparelho, clique em **Imprimir** e cole
as etiquetas (de preferência em papel adesivo plastificado). O link pode ser aberto por
qualquer câmera de celular.

## Cadastrar um cliente novo

Um cliente (unidade) precisa ser incluído em **quatro lugares**, sempre com o mesmo nome
(maiúsculas e acentos iguais):

1. `index.html`: uma `<option>` na lista "Identificação do Cliente".
2. `script.js`: o endereço em `ADDRESSES`.
3. `etiquetas/index.html`: uma `<option>` na lista "Cliente".
4. `apps-script/Codigo.gs`: o nome em `NPC_CONFIG.clientes`. Depois, cole o código no editor do
   Apps Script e publique uma **nova versão** da implantação (Implantar > Gerenciar implantações >
   lápis > Nova versão). Sem esse passo, o envio é recusado com "Cliente inválido".
