# 📦 Integração Melhor Envio - Guia Completo

## ✅ O que foi feito

O servidor foi atualizado para suportar a integração com a API do Melhor Envio de **2 formas**:

1. **Variáveis de Ambiente** (seguro para produção)
2. **Painel Admin** (fácil para testes)

---

## 🚀 Setup no Render

### Passo 1: Adicione as Variáveis de Ambiente

No seu projeto Render, acesse **Environment Variables** e adicione:

```
MELHOR_ENVIO_TOKEN=seu_token_aqui
MELHOR_ENVIO_CEP=12345678
MELHOR_ENVIO_MODO=sandbox  # ou "produção"
```

### Passo 2: Reinicie o Servidor

Depois de salvar as variáveis, redeploy a aplicação.

---

## 📋 Opção 1: Usar Via Variáveis de Ambiente (Recomendado)

Quando o servidor inicia, ele **automaticamente** detecta essas variáveis.

**Vantagens:**
- ✅ Token protegido (não fica no banco de dados)
- ✅ Mesmo token para produção/staging
- ✅ Sem necessidade de salvar manualmente no painel

**Como testar:**
1. Acesse seu painel admin
2. Vá para **Envio & Expedição**
3. Clique em **"Testar"**
4. Se aparecer ✅ "Credenciais Melhor Envio configuradas! (Via variável de ambiente)" → funcionando!

---

## 📋 Opção 2: Salvar Manualmente no Painel Admin

Se preferir testar localmente ou não usar variáveis de ambiente:

1. Acesse **http://seu-site/admin.html**
2. Vá para aba **Envio & Expedição**
3. Preencha:
   - **Token da API**: `sua_chave_token_aqui`
   - **CEP de Origem**: `12345678`
   - **Modo**: `sandbox` (testes) ou `produção`
4. Clique em **"Salvar Envio"**
5. Clique em **"Testar"** para validar

**Vantagens:**
- ✅ Fácil de testar e mudar
- ✅ Funciona offline/localmente

**Desvantagens:**
- ⚠️ Fica salvo no banco de dados (menos seguro)

---

## 🔄 Ordem de Prioridade

O servidor tenta usar as credenciais nesta ordem:

1. **Variáveis de Ambiente** (MELHOR_ENVIO_TOKEN, MELHOR_ENVIO_CEP)
2. **Banco de Dados** (salvo via painel admin)
3. **CEP da Loja** (endereço do perfil admin como origem)

---

## ✨ Como Funciona no Checkout

Quando um cliente coloca um **CEP de destino no checkout**:

```
Cliente digita CEP → Frontend chama /api/envio/calcular
→ Servidor busca token (env ou banco)
→ API Melhor Envio calcula frete real
→ Retorna opções (PAC, SEDEX, etc)
```

**Se não houver token configurado:**
```
→ Retorna valores de demonstração (PAC R$14.90, SEDEX R$24.90)
```

---

## 🛠️ Troubleshooting

### ❌ Erro: "Token e CEP de origem não preenchidos"

**Solução:**
- [ ] Verifique se as variáveis de ambiente estão definidas no Render
- [ ] Verifique se o token está correto (copie direto do Melhor Envio)
- [ ] Tente salvar manualmente no painel admin
- [ ] Reinicie o servidor

### ❌ "Melhor Envio não configurado. Usando valores de demonstração"

**Significa:** Nenhuma credencial foi encontrada (nem env, nem banco)

**Solução:**
1. Adicione as variáveis de ambiente no Render, OU
2. Salve manualmente via painel admin

### ✅ Teste Rápido no Terminal

```bash
curl -X POST http://seu-site/api/envio/calcular \
  -H "Content-Type: application/json" \
  -d '{"cepDestino":"12345678","itens":[{"quantidade":1,"preco":50}]}'
```

---

## 📚 Rotas Afetadas

| Rota | Função |
|------|--------|
| `GET /api/integracoes` | Busca configurações (lê env se não houver no banco) |
| `PUT /api/integracoes` | Salva configurações no banco |
| `POST /api/integracoes/testar` | Testa credenciais |
| `POST /api/envio/calcular` | Calcula frete (usa env ou banco) |
| `POST /api/frete/calcular` | Alias antigo (mesma função) |

---

## 🔐 Segurança

**Em Produção (Render):**
- Use APENAS variáveis de ambiente
- Não copie o token manualmente no painel admin
- Mude o token periodicamente

**Em Desenvolvimento (Local):**
- Pode usar ambas as formas
- Recomendado: use variáveis de ambiente mesmo localmente

---

## ✅ Checklist Final

- [ ] Criei variáveis de ambiente no Render
- [ ] Token do Melhor Envio foi gerado no painel deles
- [ ] Redeploiei o servidor Render
- [ ] Testei a integração no painel admin (/admin.html)
- [ ] Fiz um checkout teste e verifiquei se o frete apareceu
