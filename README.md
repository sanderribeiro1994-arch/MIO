# MIO Streetwear — Loja Online

Loja de streetwear com painel administrativo, carrinho, checkout, login de membros e integrações (PagSeguro, Melhor Envio, Upseller).

## 🚀 Como rodar localmente

```bash
npm install
npm start
```

Acesse `http://localhost:3000`

### Credenciais de acesso ao painel admin
- URL: `http://localhost:3000/admin`
- Email: `admin@miostreetwear.com.br`
- Senha: `admin123` (**troque após o primeiro login!**)

## ☁️ Deploy no Render (gratuito)

Este projeto usa **Node.js + Express + SQLite**. O GitHub Pages **não é compatível** (não roda backend).

### 1. Enviar para o GitHub
```bash
git init
git add .
git commit -m "MIO Streetwear"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/mio-streetwear.git
git push -u origin main
```

### 2. Criar o serviço no Render
1. Acesse **render.com** e crie uma conta (login com GitHub).
2. Clique em **New + → Web Service**.
3. Conecte seu repositório `mio-streetwear`.
4. Preencha:
   - **Name:** `mio-streetwear`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Clique em **Create Web Service**.

### 3. Importante sobre o banco de dados
O banco `database.db` é criado automaticamente na primeira vez que o servidor roda (o servidor já inclui os produtos iniciais). **Porém**, em serviços gratuitos do Render, o sistema de arquivos é **efêmero** — os dados são perdidos a cada novo deploy/restart.

Para manter os dados (clientes, pedidos, produtos) de forma permanente, o recomendado é usar um **banco PostgreSQL** (o Render oferece um plano gratuito) e ajustar o `server.js` para usar esse banco. Se preferir começar simples, os dados funcionam normalmente até o próximo deploy.

## 🔒 Segurança
- Troque a senha padrão do admin pelo painel (aba **Configurações → Segurança**).
- Configure as integrações de pagamento (PagSeguro) como **produção** antes de vender de verdade.
