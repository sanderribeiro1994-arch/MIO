# MIO Streetwear — Loja Online

Loja de streetwear com painel administrativo, carrinho, checkout, login de membros e integrações (PagSeguro, Melhor Envio, Upseller).

## 🚀 Como rodar localmente

```bash
npm install
npm start
```

Acesse `http://localhost:3000`

### Supabase

Configure no ambiente do servidor:

```bash
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-chave-anon
SUPABASE_SERVICE_ROLE_KEY=sua-chave-service-role
SUPABASE_STORAGE_BUCKET=images
```

Execute [supabase-schema.sql](supabase-schema.sql) no SQL Editor do Supabase. O script cria as tabelas `produtos`, `banners`, `pedidos`, `clientes`, `cupons` e `admin_sessoes`. A `SUPABASE_SERVICE_ROLE_KEY` deve ficar apenas nas variáveis privadas do servidor. Produtos e banners guardam apenas URLs; os arquivos enviados pelo painel são armazenados no bucket público `images` do Supabase Storage.

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

### 3. Armazenamento persistente no Render
O banco e os uploads são salvos no diretório definido por `MIO_DATA_DIR` (por padrão, na pasta do projeto). Em serviços gratuitos do Render, o filesystem é efêmero e apaga as edições do admin após reinícios.

Para manter banners, textos, links, imagens, clientes, pedidos e produtos:
1. Adicione um **Persistent Disk** ao Web Service no Render.
2. Use o ponto de montagem `/var/data`.
3. Em **Environment → Environment Variables**, crie `MIO_DATA_DIR` com o valor `/var/data`.
4. Faça um novo deploy.

Depois disso, o `database.db` e os arquivos enviados pelo painel ficarão no disco persistente e continuarão disponíveis até a próxima edição no admin. Sem Persistent Disk, não é possível garantir permanência usando SQLite no Render.

## 🔒 Segurança
- Troque a senha padrão do admin pelo painel (aba **Configurações → Segurança**).
- Configure as integrações de pagamento (PagSeguro) como **produção** antes de vender de verdade.
