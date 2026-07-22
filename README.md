# ORBIT — painel dos seus projetos na Vercel

Lista todos os projetos hospedados na sua conta Vercel, com status do último deploy,
link para o site em produção e exclusão protegida por confirmação dupla.

## Como rodar

```bash
cp .env.local.example .env.local   # e preencha VERCEL_TOKEN
npm run dev
```

Gere o token em https://vercel.com/account/tokens.
Se os projetos pertencem a um time, preencha também `VERCEL_TEAM_ID`.

## Como funciona a exclusão

Três barreiras antes de qualquer projeto sumir:

1. **Etapa 1** — tela de alerta listando tudo que será perdido + checkbox obrigatório
   de "entendo que é irreversível".
2. **Etapa 2** — é preciso digitar o nome exato do projeto e **manter o botão
   pressionado por ~2s** (soltar antes cancela).
3. **Servidor** — a rota `DELETE /api/projects/[id]` busca o projeto na Vercel e só
   executa se o nome enviado bater exatamente com o nome real.

O token nunca vai para o navegador: toda chamada à API da Vercel acontece nas
rotas de servidor em `src/app/api/`.

## Estrutura

| Arquivo | Papel |
| --- | --- |
| `src/lib/vercel.ts` | cliente da API da Vercel (listar, buscar, apagar, whoami) |
| `src/app/api/projects/route.ts` | `GET` — lista paginada de projetos |
| `src/app/api/projects/[id]/route.ts` | `DELETE` — exclusão com revalidação do nome |
| `src/app/page.tsx` | painel: busca, ordenação, cards, estados de erro |
| `src/components/DeleteDialog.tsx` | fluxo de confirmação dupla |
