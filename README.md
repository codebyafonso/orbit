# ORBIT

Painel multiusuário para gerenciar projetos hospedados na Vercel. Cada pessoa cria
uma conta, conecta o próprio token da Vercel e passa a ver os projetos dela com
status de deploy, radar de higiene, tendências e exclusão protegida.

O token nunca é guardado em texto claro e expira sozinho a cada 7 dias.

## O que ele faz que o painel da Vercel não faz

| Recurso | Por que existe |
| --- | --- |
| **Radar de higiene** | Marca projetos parados, com build quebrado, sem endereço de produção ou sem repositório — cada um com o motivo escrito, e seleção em lote para limpar |
| **Tendências** | Taxa de falha, tempo médio de build e ranking de quem mais quebra, cruzando todos os projetos |
| **Linha do tempo unificada** | Todos os deploys de todos os projetos em ordem cronológica |
| **Memória própria** | Resumo diário guardado no banco, para comparar semanas — a API da Vercel só devolve o estado atual |
| **Exclusão em lote com dupla confirmação** | Apagar vários projetos sem clicar um a um, e sem risco de acidente |

## Requisitos

- Node 24
- MongoDB (local ou remoto)
- Um token pessoal da Vercel por usuário, gerado em <https://vercel.com/account/tokens>

## Como rodar

```bash
npm install
cp .env.local.example .env.local
```

Preencha o `.env.local`:

```bash
# chaves de 32 bytes em hex, DIFERENTES entre si
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('TOKEN_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

| Variável | Papel |
| --- | --- |
| `SESSION_SECRET` | Criptografa o cookie de sessão |
| `TOKEN_SECRET` | Criptografa o token da Vercel guardado no banco |
| `MONGODB_URI` | Contas, tokens cifrados, auditoria e snapshots |
| `APP_ORIGIN` | Origem esperada nas requisições (opcional; sem ela, usa o `Host`) |
| `TRUST_PROXY` | `1` quando houver proxy confiável à frente, para o limite por IP funcionar |
| `APP_TIMEZONE` | Fuso usado no corte diário dos snapshots (padrão: `America/Sao_Paulo`) |

```bash
npm run dev     # http://localhost:3000
npm test        # 89 testes
npm run build
```

## Segurança

O projeto custodia credenciais de acesso total a contas de terceiros. As decisões
abaixo são o núcleo dele, não detalhe de implementação:

- **Token cifrado em repouso** com AES-256-GCM, usando o `userId` como dado
  autenticado — um ciphertext copiado para o documento de outro usuário não decifra.
- **Chave fora do banco.** Um dump do MongoDB sem a `TOKEN_SECRET` não rende token.
- **Expiração em 7 dias** por índice TTL: o próprio banco esquece, sem depender de
  rotina da aplicação. O código também recusa documento vencido na leitura.
- **Nenhum pedaço do token sai para o cliente** — nem os últimos caracteres.
- **Sessão revogável**: o cookie carrega um `sid` registrado no banco; sair invalida
  a sessão mesmo para uma cópia do cookie que tenha vazado.
- **Senhas com Argon2id**, com hash descartável no caminho de email inexistente para
  não vazar contas por diferença de tempo.
- **Limite de tentativas** em login, cadastro e insights, por origem e por conta.
- **Exclusão auditada**: quem apagou o quê e quando.

## Estrutura

```
src/
  app/
    page.tsx              landing pública com cadastro e login
    painel/               painel protegido (abas: projetos, radar, atividade)
    api/
      auth/               cadastro, login e logout
      projects/           listagem e exclusão
      token/              validade, substituição e revogação do token
      insights/           radar, tendências e linha do tempo
  components/             AuthForm, TokenGate, DeleteDialog, Radar, Atividade
  lib/
    auth/                 sessão, usuários, cifra, limites, validação de entrada
    db/                   conexão, tokens, auditoria, snapshots
    vercel/               cliente da API e regras derivadas (insights)
  middleware.ts           protege /painel
```

## Como funciona a exclusão

Três barreiras antes de qualquer projeto sumir:

1. Tela de alerta listando o que será perdido, com confirmação obrigatória.
2. Digitar o nome exato do projeto (ou `apagar N projetos`, no lote) e manter o
   botão pressionado por ~2s.
3. O servidor busca o projeto na Vercel e só executa se o nome enviado bater com o
   real — a resposta de erro não revela o nome, para não virar um oráculo.

## Documentação

- [`docs/design.md`](docs/design.md) — decisões de arquitetura, o risco assumido ao
  custodiar tokens de terceiros e as mitigações adotadas
