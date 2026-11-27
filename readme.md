# WA - Download Guard 🛡️

Bloqueio inteligente de **downloads no WhatsApp Web** para reduzir risco de malware e vazamento de dados.

> **Manifest:** v3 • **Alvo:** `https://web.whatsapp.com/*`
> **Propósito único:** bloquear automaticamente downloads de tipos de arquivo não permitidos no WhatsApp Web.

---

## Índice

- [WA - Download Guard 🛡️](#wa---download-guard-️)
  - [Índice](#índice)
  - [Apresentação](#apresentação)
  - [Recursos](#recursos)
  - [Como funciona](#como-funciona)
  - [Instalação (desenvolvimento)](#instalação-desenvolvimento)
  - [Publicar uma versão no GitHub](#publicar-uma-versão-no-github)
  - [Permissões \& Privacidade](#permissões--privacidade)
  - [Configuração](#configuração)
  - [Políticas (policy.md)](#políticas-policymd)
  - [Estrutura do projeto](#estrutura-do-projeto)
  - [FAQ / Solução de problemas](#faq--solução-de-problemas)

---

## Apresentação

O **WA - Download Guard** aplica uma allowlist de extensões e tipos MIME a downloads identificados como originados no WhatsApp Web.

---

## Recursos

* ✅ **Atualização automática** — verifica a política ao iniciar o navegador e consulta a fonte a cada 60 minutos.
* ✅ **Listas flexíveis** — por **extensão** (ex.: `.zip`, `.exe`, `.js`) e por **MIME type**.
* ✅ **Aviso amigável** — feedback visual quando um download é bloqueado.
* ✅ **Decisão local** — as informações dos downloads ficam no navegador. A extensão consulta a URL configurada para baixar a allowlist.

---

## Como funciona

1. O **service worker** verifica a URL inicial, a URL final, a origem embutida em URLs `blob:` e a referência fornecida pelo Chrome.
2. Para downloads do WhatsApp, mantém a determinação do nome aberta até avaliar a extensão e o MIME. Se a política bloquear o arquivo, tenta cancelar e verifica o estado retornado pelo Chrome.
3. Quando o arquivo já foi concluído, o aviso orienta a conferir o arquivo no disco. O histórico do navegador é preservado.
4. O script do WhatsApp exibe avisos e pode impedir cliques em links `blob:` da própria página ou `data:` com atributo `download`. A identificação pelo navegador depende dos metadados disponíveis.

O cache pertence à URL que forneceu a política. A extensão busca uma política ao ser instalada ou atualizada, ao salvar um endereço, no alarme de 60 minutos e ao clicar em **Atualizar agora**. Ao iniciar ou avaliar um download, verifica se o cache precisa ser atualizado.

---

## Instalação (desenvolvimento)

1. Baixe/clone o projeto.
2. Abra `chrome://extensions/` e ative **Modo do desenvolvedor**.
3. Clique **Carregar sem compactação** e selecione a pasta da extensão.
4. Em **Opções**, confirme que a allowlist padrão foi carregada. Para usar outro endereço, informe a URL HTTPS e clique em **Salvar e atualizar**.
5. No **WhatsApp Web**, teste um arquivo permitido e um arquivo bloqueado. Faça também um download de outro site para conferir o escopo.

Para rodar os testes automatizados, execute `node --test` com Node.js 22 ou posterior.

> Dica: pra empacotar localmente, use **“Empacotar extensão…”** em `chrome://extensions/`.

---

## Publicar uma versão no GitHub

Atualize a versão em `manifest.json` e envie o commit para a `main`. Em seguida, crie e envie a tag correspondente. Por exemplo, para a versão `1.0.6`:

```sh
git tag v1.0.6
git push origin v1.0.6
```

O GitHub Actions roda os testes e publica o arquivo `wa-download-guard-v1.0.6.zip` em **Releases**. O ZIP contém os arquivos da extensão, com `manifest.json` na raiz. A publicação na Chrome Web Store continua sendo feita no painel da loja.

---

## Permissões & Privacidade

**Permissões**

* `downloads`: interceptar/cancelar downloads não permitidos.
* `storage`: guardar configurações e listas localmente.
* `alarms`: atualizar a policy automaticamente a cada 60 minutos.
* `notifications`: mostrar avisos do navegador quando o aviso na página não estiver disponível.
* Host `https://*.whatsapp.com/*`, `https://*.whatsapp.net/*`, `https://wa.me/*`: escopo do WhatsApp.
* Host `https://wazap.coopavel.com.br/*`: acesso à fonte interna disponível nas versões anteriores e em configurações personalizadas.

**Privacidade**

* **Sem coleta de dados pessoais.**
* **Busca apenas a policy (allowlist) na URL configurada.**
* Tudo fica **no seu navegador**.

---

## Configuração

A extensão carrega a [allowlist padrão do Pastefy](https://pastefy.app/qsgAfmgn/raw) automaticamente. Para usar outro endereço, salve em **Opções** uma URL HTTPS que responda com a allowlist em JSON. O servidor precisa permitir a leitura por CORS quando o manifesto não concede acesso ao host. Para voltar ao padrão, limpe o campo e clique em **Salvar e atualizar**.

As opções exibem a política em vigor, a última atualização bem-sucedida e o erro da última tentativa. Se a atualização falhar, a última política válida da mesma URL continua em vigor. Na atualização da 1.0.4, a URL que vinha por padrão na versão publicada é substituída pelo Pastefy. Outros endereços salvos são preservados. A política entra em vigor assim que a nova URL fornecer um JSON válido.

**Exemplo mínimo de allowlist:**

```json
{
  "schema_version": 1,
  "updated_at": "2026-01-14T12:00:00Z",
  "mode": "allow",
  "default_action": "block",
  "ttl_seconds": 3600,
  "allowed": {
    "extensions": ["pdf", "png"],
    "mime_types": ["application/pdf", "image/png"]
  }
}
```

Notas rápidas:
* extensões em minúsculas, sem ponto.
* inclua os principais MIME types do seu ambiente.
* se o MIME vier genérico (ex.: `application/octet-stream`), a decisão cai na extensão.

---

## Políticas (policy.md)

Este repositório inclui um guia de políticas em [`policy.md`](./policy.md).
Lá você encontra:

* Objetivo e escopo da extensão (propósito único).
* Diretrizes de **criação/alteração** das listas de bloqueio/permitidos.
* Justificativas de permissões e boas práticas de privacidade.
* Padrões de mensagem ao usuário (ex.: textos de bloqueio/aviso).
* Processo de revisão de mudanças (como propor e aprovar updates).
* Versionamento e registro de alterações de política.

> Qualquer mudança de comportamento da extensão que impacte regras, mensagens ou permissões **deve** seguir o fluxo descrito no `policy.md`.

---

## Estrutura do projeto

```
/ (raiz)
├─ manifest.json                # Manifest V3
├─ sw.js                        # Service worker (background) — bloqueio + preload das regras
├─ policy-refresh.js            # Atualização e cache por URL
├─ policy-rules.js              # Validação e decisão compartilhadas
├─ content-whatsapp.js          # Avisos e interceptação de links explícitos
├─ options/
│  ├─ options.html              # Página de opções
│  └─ options.js
├─ icons/
│  ├─ 16.png
│  ├─ 32.png
│  ├─ 48.png
│  └─ 128.png
├─ policy.md                    # Guia oficial de políticas do projeto
└─ readme.md
```

---

## FAQ / Solução de problemas

**“Como verifico se a política está funcionando?”**

* Abra **Opções** e verifique a allowlist em vigor e a data da última atualização.
* Use **Atualizar agora** para testar a URL salva. Se aparecer um erro, confira o endereço RAW, o HTTP e o formato do JSON.

**“Quero liberar só PDF e PNG.”**

* Use `allowed.extensions` com `["pdf", "png"]` e `allowed.mime_types` com `["application/pdf", "image/png"]`.

**“Funciona em outros sites?”**

* O foco é **WhatsApp Web**. Outras origens não são alvo do projeto.

---
