# 🔄 Guia Completo de Sincronização Bling ↔ Site MIO

## ✅ Checklist de Configuração

### 1. Variáveis de Ambiente (Render)
Verifique se estas estão configuradas no painel do Render:

```
✓ SUPABASE_URL
✓ SUPABASE_ANON_KEY
✓ SUPABASE_SERVICE_ROLE_KEY
✓ BLING_CLIENT_ID
✓ BLING_CLIENT_SECRET
✓ BLING_CALLBACK_URL
✓ NODE_ENV=production
```

---

## 📋 Fluxo de Sincronização

### A. Produtos: Bling → Site (Catálogo)

**O que acontece:**
1. Você cadastra produtos no Bling
2. Clica em "Sincronizar Catálogo" no admin
3. Produtos aparecem no site automaticamente

**Para testar:**

```bash
# 1. No painel admin: https://usemio.com.br/admin
# 2. Vá para: Envio & Expedição → Bling
# 3. Clique em: "Sincronizar Catálogo"
# 4. Você verá: "Catálogo sincronizado: X produtos importados"
```

**Se não funcionar:**
```bash
# Execute este teste no console do navegador (F12):
fetch('/api/bling/test', { credentials: 'include' })
  .then(r => r.json())
  .then(d => console.log(JSON.stringify(d, null, 2)))
```

Procure por:
- ✓ `oauth_conectado: true`
- ✓ `token_valido: true`  
- ✓ `produtos_api: "OK"`

---

### B. Produtos: Site → Bling (Novo Cadastro)

**O que acontece:**
1. Você cria um novo produto no admin
2. Sistema envia automaticamente para o Bling
3. Produto fica vinculado (bling_id) no banco

**Para testar:**

```bash
# 1. Admin → Produtos → Novo Produto
# 2. Preencha os dados e clique em "Salvar"
# 3. Procure pela resposta:
#    - "Produto sincronizado com o Bling" = sucesso
#    - Se falhar, produto fica no site mesmo assim
```

---

### C. Pedidos: Site → Bling (Após Pagamento)

**O que acontece:**
1. Cliente faz pedido e paga no site
2. Após confirmação do pagamento (webhook)
3. Pedido é automaticamente enviado ao Bling
4. Você controla a expedição pelo Bling

**Para testar:**

```bash
# 1. Simule um pedido no site (ou use um real)
# 2. Após pagamento confirmado, vá ao admin
# 3. Admin → Pedidos
# 4. Procure pela coluna "Bling ID" ou "Bling Status"
# 5. Se aparecer um ID = sucesso!
```

**Manual:**
Se um pedido não foi enviado, você pode reenviar:
```bash
# Admin → Envio & Expedição → Selecione o pedido
# Clique em: "Reenviar para Bling"
```

---

### D. Pedidos: Bling → Site (Status & Rastreio)

**O que acontece:**
1. Você marca pedido como "Enviado" no Bling
2. Adiciona código de rastreamento
3. Clica em "Sincronizar Pedidos" no site
4. Status e rastreio aparecem no site

**Para testar:**

```bash
# 1. Admin → Envio & Expedição → Bling
# 2. Clique em: "Sincronizar Pedidos"
# 3. Você verá: "Pedidos sincronizados: X"
# 4. Volta a Admin → Pedidos
# 5. Procure por:
#    - Status atualizado (ex: "Enviado", "Entregue")
#    - Código de rastreamento preenchido
```

---

## 🔧 Endpoints de Teste

### 1. Teste de Conectividade Bling

```bash
curl -X GET https://usemio.com.br/api/bling/test \
  -H "Accept: application/json" \
  -b "admin_token=seu_token_aqui"

# Resposta esperada:
{
  "ok": true,
  "mensagem": "Bling conectado e respondendo corretamente",
  "diagnosticos": {
    "oauth_conectado": true,
    "token_valido": true,
    "produtos_api": "OK",
    "pedidos_api": "OK",
    "estoque_api": "OK"
  }
}
```

### 2. Sincronizar Catálogo Manualmente

```bash
curl -X GET https://usemio.com.br/api/produtos/sync/bling \
  -H "Accept: application/json" \
  -b "admin_token=seu_token_aqui"

# Resposta esperada:
{
  "ok": true,
  "importados": 15,
  "total": 15
}
```

### 3. Sincronizar Pedidos Manualmente

```bash
curl -X GET https://usemio.com.br/api/bling/sync/pedidos \
  -H "Accept: application/json" \
  -b "admin_token=seu_token_aqui"

# Resposta esperada:
{
  "ok": true,
  "atualizados": 3,
  "total": 5,
  "pedidos": [...]
}
```

---

## ⚠️ Problemas Comuns & Soluções

### ❌ "Erro ao conectar ao Bling"

**Causa:** OAuth token inválido ou expirado

**Solução:**
1. Admin → Envio & Expedição → Bling
2. Clique em "Conectar Bling"
3. Autorize o acesso novamente
4. Você verá: "Bling conectado com sucesso!"

---

### ❌ "0 produtos importados"

**Causa 1:** Nenhum produto no Bling
- Verifique no painel do Bling se há produtos cadastrados

**Causa 2:** Token sem permissão
- Verifique se o OAuth do Bling tem os escopos:
  - `produto:read`
  - `produto:write`

**Causa 3:** API do Bling fora do ar
- Execute `/api/bling/test` para diagnóstico detalhado

---

### ❌ "Pedido não aparece no Bling"

**Verificar:**
1. O pedido foi pago? (Status deve ser "PAGO")
2. Há um "Bling ID" no pedido? (Admin → Pedidos → coluna Bling)

**Se não houver Bling ID:**
1. Admin → Envio & Expedição → Selecione o pedido
2. Clique em "Reenviar para Bling"
3. Aguarde 30 segundos e recarregue

---

### ❌ "Produtos no Bling não aparecem no site"

**Verificar:**
1. Execute o teste `/api/bling/test`
2. Procure por: `"produtos_api": "OK"`

**Se falhar:**
- Reconecte o Bling (faça logout e login novamente)
- Verifique se há produtos no Bling com preço > 0

---

## 📊 Estrutura de Dados

### Campo `bling_id` (Vínculo)

Cada produto/pedido tem um `bling_id` que vincula ao Bling:

```sql
-- Produtos
SELECT id, nome, bling_id FROM produtos WHERE bling_id IS NOT NULL;

-- Pedidos
SELECT numero, bling_id, bling_status FROM pedidos WHERE bling_id IS NOT NULL;
```

### Status de Sincronização

```
PEDIDOS:
- Aguardando Pagamento → (não enviado)
- PAGO → (envia para Bling automaticamente)
- Enviado → (atualizado pelo webhook do Bling)
- Entregue → (atualizado pelo webhook do Bling)

PRODUTOS:
- Criado no site → (enviado automaticamente para Bling)
- Criado no Bling → (importado ao sincronizar)
```

---

## 🚀 Próximas Verificações

### Após ativar sincronização:

- [ ] Login no Bling via OAuth funciona
- [ ] Botão "Sincronizar Catálogo" retorna produtos
- [ ] Novo produto no site aparece no Bling em 5 minutos
- [ ] Pedido pago é enviado para o Bling automaticamente
- [ ] Código de rastreamento sync do Bling para site funciona
- [ ] Teste `/api/bling/test` retorna tudo OK

---

## 📞 Debug Avançado

### Ver último erro de sync no banco:

```bash
# No Supabase SQL Editor:
SELECT chave, valor FROM config 
WHERE chave LIKE 'bling_sync%' 
ORDER BY chave DESC LIMIT 5;
```

### Verificar logs do servidor (Render):

1. Vá para Render Dashboard
2. Selecione seu serviço
3. Clique em "Logs"
4. Procure por: `Bling`, `sync`, `webhook`

---

## ✨ Resumo Final

**Sistema está funcionando quando:**

```
✓ Conexão OAuth ativa (Bling conectado no painel)
✓ Produtos fluem Bling → Site (clicando Sincronizar)
✓ Produtos fluem Site → Bling (criando novo)
✓ Pedidos fluem Site → Bling (após pagamento)
✓ Rastreio flui Bling → Site (clicando Sincronizar)
```

Se algum desses não funcionar, use `/api/bling/test` para diagnosticar!
