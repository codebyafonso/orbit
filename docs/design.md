# Painel Vercel multiusuário — design

Data: 2026-07-22
Revisado: 2026-07-22 (OAuth descartado — exige plano pago; adotado token com expiração semanal)
Status: aprovado, em implementação

## Objetivo

Transformar o painel local de projetos da Vercel (single-user, token em `.env.local`)
num aplicativo multiusuário publicável: cada pessoa cria uma conta, informa o próprio
token da Vercel, vê os próprios projetos e pode apagá-los com confirmação dupla.
O projeto serve como peça de portfólio no GitHub/LinkedIn, então o tratamento dado
ao token é parte central do que ele demonstra.

## Decisões tomadas

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Conexão com a Vercel | Token pessoal informado pelo usuário | Sign in with Vercel exige plano pago; inviável no free |
| Custódia do token | Criptografado no MongoDB, apagado automaticamente após 7 dias | Limita a janela de exposição e força reautorização periódica |
| Login | Conta própria: email + senha (Argon2id) | Sem OAuth disponível, é o caminho restante |
| Escopo da v1 | Painel de gestão atual + multiusuário | Escopo fechado, aproveita o que já existe |
| Banco | MongoDB local em desenvolvimento | Já rodando na máquina (porta 27017) |
| Hospedagem | Adiada | Fora do escopo desta spec |

## Risco assumido, explicitamente

Um token pessoal da Vercel dá **acesso total** à conta: listar, criar e apagar
projetos, ler variáveis de ambiente. Guardá-lo, mesmo cifrado, torna a aplicação
custodiante de credenciais de terceiros. As mitigações abaixo são obrigatórias,
não opcionais:

1. **Cifrado em repouso** com AES-256-GCM; a chave (`TOKEN_SECRET`) vive só no
   ambiente do servidor, nunca no banco. Banco vazado sem a chave não rende tokens.
2. **Expiração automática em 7 dias** via índice TTL do MongoDB — o banco apaga o
   documento sozinho, sem depender de rotina da aplicação.
3. **Nunca devolvido ao cliente, nem em parte.** Nenhuma rota serializa o token
   e nenhum pedaço dele é guardado em claro: a interface mostra apenas se há
   conexão ativa e quando ela vence.
4. **Descriptografado apenas em memória**, no momento da chamada à API da Vercel.
5. **Auditoria** de toda exclusão, com o usuário responsável.
6. **Aviso explícito no cadastro** de que o token é de acesso total e de que ele
   pode ser revogado a qualquer momento em vercel.com/account/tokens.

## Arquitetura

Next.js 16 (App Router) — evolução do app existente, não reescrita.

```
navegador
   │  cookie de sessão (httpOnly, JWE) — contém userId, nunca o token
   ▼
Route Handlers ──► MongoDB ──► token cifrado (TTL 7 dias)
   │                              │
   │        decifra em memória ◄──┘
   └──────────────────────────────► api.vercel.com
```

### Autenticação da conta

- `POST /api/auth/register` — email, senha (mínimo 10 caracteres) e token da Vercel.
  Valida o token chamando `GET /v2/user` antes de aceitar o cadastro: token inválido
  não cria conta.
- `POST /api/auth/login` — email e senha; cria a sessão.
- `POST /api/auth/logout` — destrói o cookie.
- Senha com Argon2id (`@node-rs/argon2`). Comparação sempre em tempo constante, e a
  mesma mensagem de erro para email inexistente e senha errada.

### Sessão

Cookie `orbit_session`, JWE (`dir` + A256GCM), `httpOnly`, `SameSite=Lax`,
`Secure` fora de desenvolvimento. Payload: `userId`, `email`, `expiresAt`.
**O token da Vercel não entra na sessão** — fica no banco, cifrado.

### Ciclo de vida do token

1. No cadastro, o usuário informa o token. Ele é cifrado e gravado com
   `expiresAt = agora + 7 dias`.
2. O índice TTL (`expireAfterSeconds: 0` sobre `expiresAt`) faz o MongoDB remover o
   documento na virada. O usuário perde o acesso aos dados, não a conta.
3. Ao entrar sem token válido, o painel exibe a tela "informe seu token" em vez da
   grade de projetos.
4. O painel mostra sempre quantos dias faltam, e um botão para substituir o token
   antes do prazo.

## Dados (MongoDB)

Coleção `users`:

| Campo | Tipo | Nota |
| --- | --- | --- |
| `_id` | ObjectId | |
| `email` | string | índice único, normalizado em minúsculas |
| `passwordHash` | string | Argon2id |
| `createdAt` | Date | |
| `lastLoginAt` | Date | |
| `preferences` | objeto | ordenação padrão e afins |

Coleção `vercel_tokens`:

| Campo | Tipo | Nota |
| --- | --- | --- |
| `userId` | ObjectId | índice único — um token por usuário |
| `ciphertext` | string | base64: IV + tag + dados, AES-256-GCM |
| `teamId` | string \| null | |
| `vercelUsername` | string \| null | de `/v2/user`, na validação |
| `createdAt` | Date | |
| `expiresAt` | Date | índice TTL `expireAfterSeconds: 0` |

Coleção `audit_logs`:

| Campo | Tipo | Nota |
| --- | --- | --- |
| `userId` | ObjectId | |
| `action` | string | `project.delete` |
| `projectId`, `projectName` | string | |
| `result` | `"ok"` \| `"error"` | |
| `error` | string \| null | truncado em 500 caracteres |
| `at` | Date | índice descendente |

Nenhuma coleção guarda token em texto claro ou senha reversível.

## Mudanças no código existente

- `src/lib/vercel.ts` — já concluído: recebe `VercelAuth` por parâmetro.
- `src/lib/session.ts` — já concluído; o payload passa a carregar `userId` em vez do
  token da Vercel.
- `src/app/api/projects/*` — resolvem a sessão, buscam e decifram o token do usuário,
  respondem 401 sem sessão e 428 quando não há token válido.
- `src/app/page.tsx` — landing pública com cadastro e login; o painel vai para
  `/painel`.
- `src/components/DeleteDialog.tsx` — sem alteração.

## Erros e degradação

- **Sem token ou token expirado** → 428 e a tela de "informe seu token".
- **Token revogado na Vercel** → 401/403 da API; o app apaga o documento e pede um
  novo token.
- **MongoDB indisponível** → o app não funciona (o token vive lá). A mensagem
  precisa ser explícita, não um erro genérico. Esta é a diferença em relação ao
  desenho anterior, em que o banco era secundário.
- **Falha parcial em exclusão em lote** → cada projeto é uma requisição
  independente; os que falharem são reportados por nome.

## Testes

- Vitest nas funções puras (`normalize`, `repoFrom`, sessão) — já concluído.
- Cifra: o texto cifrado não contém o token; decifrar devolve o original; texto
  adulterado falha.
- Expiração: token com `expiresAt` no passado é tratado como ausente pela aplicação,
  independentemente do TTL do banco (que roda a cada ~60s).
- Rotas: sem sessão → 401; sem token → 428; confirmação errada não apaga.

## Pendências

1. **Definir a hospedagem** (app e banco). Ao publicar, preencher `APP_ORIGIN`
   (o preview de link depende dela) e `TRUST_PROXY=1` (sem isso o limite por IP
   cai num balde único).
2. **Recuperação de senha — adiada por decisão.** Hoje, senha esquecida significa
   conta perdida: não há autoatendimento nem rota administrativa. O caminho
   preferido quando for retomado é link por email de uso único (guardar só o hash
   do token, validade de 30 min, resposta idêntica exista ou não a conta, e
   derrubar todas as sessões ao redefinir). Alternativa sem infraestrutura:
   código de recuperação entregue no cadastro.
3. **Backup da `TOKEN_SECRET`** tratado como segredo. Perdê-la torna todos os
   tokens guardados ilegíveis e obriga cada usuário a informar o dele de novo.
4. **Apagar a conta de teste** `afonso@orbit.local` antes de qualquer publicação:
   a senha dela é conhecida.

## Decisões conscientes de escopo

- **Sem CI.** A Vercel executa o build a cada push, o que cobre quebra de
  compilação; testes e lint ficam por conta de quem desenvolve.
- **Sem troca de email.** Por isso operações destrutivas resolvem o usuário pelo
  `_id` da sessão, e não pelo email — o dia em que a troca existir, nada quebra.

## Fora de escopo

Métricas e gráficos, ações de deploy, equipes/organizações, recuperação de senha.
