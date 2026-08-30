# 🔄 Guia Completo: Sincronização Bidirecional Bling ↔ Supabase ↔ Site

## ✅ Implementação Completa

### Arquitetura

```
                    ┌─────────────────────┐
                    │   Painel Bling      │
                    │     (ERP)           │
                    └──────────┬──────────┘
                               │
                   ┌───────────┴────────────┐
                   │                        │
            POST /webhooks/          GET /api/bling/
            bling-produto            sync/produtos
                   │                        │
                   ▼                        ▼
        ┌──────────────────────────────────────────┐
        │     Servidor Node.js/Express             │
        │     (Render)                             │
        │  ┌────────────────────────────────────┐  │
        │  │  Funções de Sync:                  │  │
        │  │  • upsertProdutoBling()            │  │
        │  │  • sincronizarProdutoBlingParaSite │  │
        │  │  • enviarProdutoParaBling()        │  │
        │  └────────────────────────────────────┘  │
        └──────────────────┬───────────────────────┘
                           │
                ┌──────────┴──────────┐
                │                     │
        POST /api/                GET /api/
        produtos              produtos/sync/bling
                │                     │
                ▼                     ▼
        ┌─────────────────────────────────────┐
        │      Supabase (PostgreSQL)          │
        │  ┌─────────────────────────────────┐│
        │  │ produtos                        ││
        │  │ - id (PK)                       ││
        │  │ - bling_id (UNIQUE INDEX)       ││
        │  │ - nome, preco, estoque, ...     ││
        │  │ - data_last_sync                ││
        │  │ - sync_status                   ││
        │  │ - sync_tentativas               ││
        │  │ - sync_erro                     ││
        │  └─────────────────────────────────┘│
        └─────────────────────────────────────┘
```

---

## 🔧 Fluxos Implementados

### A. Criação de Produto: Site → Bling → Supabase

```
1. Admin cria produto no site
   POST /api/produtos
   Payload: { nome, preco, categoria, ... }

2. Salvar em Supabase (local)
   INSERT INTO produtos (...)
   ↓ Retorna: id do produto local

3. Auto-enviar para Bling
   await enviarProdutoParaBling(produto)
   ↓ Bling retorna: blingId

4. Vincular bing_id ao produto local
   UPDATE produtos SET bling_id = ?
   ↓ Status: VINCULADO

5. Resposta ao admin
   { ok: true, id: 123, sync: 'enviado-para-bling' }
```

**Campos auditados:**
- ✅ data_last_sync = agora
- ✅ sync_status = 'sucesso'
- ✅ sync_tentativas = 1
- ✅ sync_erro = null

---

### B. Importação de Produto: Bling → Supabase

**Rota manual (admin clica botão):**
```
1. Admin clica "Sincronizar Catálogo"
   GET /api/produtos/sync/bling

2. Consultar Bling API
   GET https://www.bling.com.br/Api/v3/produtos

3. Para CADA produto do Bling:
   - Extrair ID/código (chave única)
   - Mapear estrutura (nome, preco, estoque, ...)
   - Verificar se bling_id já existe em Supabase

4. Se existe: ATUALIZAR
   UPDATE produtos SET nome=?, preco=?, ...
   WHERE bling_id = ?

5. Se não existe: CRIAR
   INSERT INTO produtos (bling_id, nome, ...)

6. Retornar resultado
   { ok: true, importados: 15, total: 15 }
```

**Campos auditados:**
- ✅ bling_id = ID do Bling (único)
- ✅ data_last_sync = agora
- ✅ sync_status = 'sucesso'
- ✅ sync_tentativas = 1

---

### C. Atualização de Produto: Bling → Supabase (Webhook)

**NOVO! Webhook automático quando produto alterado no Bling:**
```
1. Produto alterado no Painel Bling
   ↓ Bling envia POST

2. Webhook recebido
   POST /api/webhooks/bling-produto
   Payload: { id: "123", codigo: "SKU-001", nome: "...", ... }

3. Validar e mapear
   - Extrair bling_id (id ou codigo)
   - Validar campos obrigatórios
   - Mapear para formato Supabase

4. Sincronizar
   await sincronizarProdutoBlingParaSite(dadosBling)
   ↓ Chama upsertProdutoBling(dados, bling_id)

5. Operação:
   - Se bling_id existe: ATUALIZAR (sync_status='sucesso')
   - Se bling_id novo: CRIAR (sync_status='sucesso')
   - Se deletado no Bling: DELETAR do Supabase

6. Resposta ao Bling
   { ok: true, operacao: 'update|insert|delete', bling_id: "123" }
```

**Campos auditados:**
- ✅ data_last_sync = timestamp webhook
- ✅ sync_status = 'sucesso' (webhook processado)
- ✅ sync_tentativas += 1
- ✅ sync_erro = null

---

## 📊 Novo Campo: bling_id (Chave Única)

**Uso:**
```sql
-- Buscar produto por Bling ID
SELECT * FROM produtos WHERE bling_id = 'SKU-001';

-- Verificar se há duplicatas (não deve ter!)
SELECT bling_id, COUNT(*) FROM produtos 
GROUP BY bling_id HAVING COUNT(*) > 1;

-- Listar produtos não sincronizados
SELECT * FROM produtos WHERE bling_id IS NULL;

-- Listar produtos com erro de sync
SELECT * FROM produtos 
WHERE sync_status = 'falha' AND sync_tentativas > 3;
```

**Índices para performance:**
- `idx_produtos_bling_id` - Lookup rápido por bling_id
- `idx_produtos_sync_status` - Filtro por status
- `idx_produtos_data_last_sync` - Ordenação cronológica

---

## 🚀 Como Configurar o Webhook do Bling

### Passo 1: Acesse o Painel do Bling
1. Login em https://www.bling.com.br
2. Vá para: **Configurações** → **API** → **Webhooks**

### Passo 2: Criar Novo Webhook
1. Clique em "Adicionar Webhook"
2. **URL:** `https://usemio.com.br/api/webhooks/bling-produto`
3. **Evento:** Selecione um ou mais:
   - `produto.criado`
   - `produto.atualizado`
   - `produto.deletado`
4. **Selecione todos os campos do produto** (para receber informação completa)
5. Clique em "Salvar"

### Passo 3: Testar
```bash
# Depois que configurar, edite um produto no Bling
# O webhook será chamado automaticamente

# Você verá logs em:
# Render Dashboard → Logs → filtrar por "Bling Webhook"
```

---

## 🔍 Monitoramento e Debugging

### Ver Últimas Sincronizações
```bash
# SQL no Supabase
SELECT 
  id, nome, bling_id, sync_status, 
  data_last_sync, sync_tentativas, sync_erro
FROM produtos 
WHERE sync_status IS NOT NULL
ORDER BY data_last_sync DESC 
LIMIT 10;
```

### Produtos com Erro de Sync
```bash
SELECT * FROM produtos 
WHERE sync_status = 'falha' 
ORDER BY sync_tentativas DESC;
```

### Contar Sincronizados vs Não Sincronizados
```bash
SELECT 
  COUNT(CASE WHEN bling_id IS NOT NULL THEN 1 END) as "Com bling_id",
  COUNT(CASE WHEN bling_id IS NULL THEN 1 END) as "Sem bling_id",
  COUNT(*) as "Total"
FROM produtos;
```

### Logs do Servidor (Render)
1. Acesse: https://dashboard.render.com
2. Selecione seu serviço
3. Vá para **Logs**
4. Procure por:
   - `[Sync Bling→Site]` - Sincronizações Bling→Supabase
   - `[Bling Webhook]` - Webhooks recebidos
   - `Erro ao sincronizar` - Erros de sync

---

## ✅ Checklist de Validação

### Antes de Usar em Produção

- [ ] Schema Supabase atualizado (colunas audit adicionadas)
- [ ] Código do servidor deployado (Render)
- [ ] Webhook do Bling configurado (se quiser sync automático)
- [ ] Testou criação de produto Site → Bling
- [ ] Testou importação Bling → Site
- [ ] Testou webhook de produto
- [ ] Sem duplicatas de bling_id em Supabase
- [ ] Logs mostrando "sucesso" nas sincronizações

### Testes Práticos

**Teste 1: Site → Bling**
```
1. Admin cria novo produto no painel
2. Preenche: Nome, Preço, Categoria
3. Clica "Salvar"
4. Aguarda 5 segundos
5. Verifica em Render Logs: "[Sync Bling→Site] create: bing_id-123"
✓ Produto deve ter aparecido no Bling dentro de 5 minutos
✓ Campo bling_id deve estar preenchido no Supabase
```

**Teste 2: Bling → Site (Manual)**
```
1. Cria produto direto no Bling (não no site)
2. Aguarda 1 minuto (para produto "assentar" no Bling)
3. No painel site, clica "Sincronizar Catálogo"
4. Aguarda resposta: "Importados: N"
✓ Produto novo deve aparecer em Supabase com bling_id
✓ Deve aparecer na loja em segundos
```

**Teste 3: Webhook (Automático)**
```
1. Edita um produto existente no Bling
2. Muda preço ou nome
3. Salva no Bling
4. Verifica Render Logs: "[Bling Webhook] Evento: produto.atualizado"
✓ Produto no Supabase deve estar atualizado em até 10 segundos
✓ Campo data_last_sync deve ter novo timestamp
✓ sync_status deve ser 'sucesso'
```

---

## 🔐 Segurança

### Validações Implementadas

1. **Webhook de Produtos**
   - Valida se bling_id/codigo está presente
   - Trata múltiplos formatos de payload
   - Logging de tudo para auditoria
   - Suporta remoção (delete) segura

2. **Upsert com Chave Única**
   - Usa UNIQUE constraint em bling_id
   - Previne duplicatas automáticamente
   - Índice para performance

3. **Auditoria Completa**
   - data_last_sync: quando ocorreu
   - sync_status: sucesso/falha/pendente
   - sync_tentativas: quantas vezes tentou
   - sync_erro: mensagem do erro (se houver)

---

## 📞 Troubleshooting

### ❌ "Produto não aparece no Bling após criar no site"

**Causas possíveis:**
1. Token OAuth do Bling expirou
2. Credenciais incorretas no Render env
3. Bling API retorna erro 500

**Solução:**
```bash
# 1. Verificar token
GET /api/bling/test

# 2. Reconectar OAuth
Admin → Envio & Expedição → "Conectar Bling"

# 3. Ver logs detalhados
Render Dashboard → Logs → filtrar "Erro ao enviar"
```

### ❌ "Webhook não está funcionando"

**Causas possíveis:**
1. Webhook não configurado no Bling
2. URL incorreta no Bling
3. Firewall bloqueando requisições

**Solução:**
```bash
# 1. Verificar configuração no Bling
Bling → Configurações → Webhooks → verificar URL

# 2. Testar endpoint manualmente
curl -X POST https://usemio.com.br/api/webhooks/bling-produto \
  -H "Content-Type: application/json" \
  -d '{"id":"123","codigo":"SKU-001","nome":"Teste"}'

# 3. Ver logs
Render → Logs → filtrar "[Bling Webhook]"
```

### ❌ "Muitos erros de sync em Render"

**Ver quais produtos falharam:**
```sql
SELECT nome, sync_erro, sync_tentativas FROM produtos 
WHERE sync_status = 'falha'
ORDER BY sync_tentativas DESC;
```

**Retentar manualmente:**
```bash
# Por produto
POST /api/produtos/:id/sync/bling

# Todos de uma vez
GET /api/produtos/sync/bling
```

---

## 📈 Próximos Passos

1. ✅ Webhook de Produtos implementado
2. ✅ Upsert com bling_id como chave única
3. ✅ Auditoria (data_last_sync, sync_status, etc)
4. ⏳ Retry automático (próxima fase)
5. ⏳ Dashboard de sync status (futuro)

---

## 📖 Referência Rápida de Endpoints

| Rota | Método | Descrição |
|------|--------|-----------|
| `/api/produtos` | POST | Criar produto (auto-envia para Bling) |
| `/api/produtos/:id` | PUT | Atualizar produto (auto-envia para Bling) |
| `/api/produtos/sync/bling` | GET | Importar todos do Bling |
| `/api/produtos/:id/sync/bling` | POST | Forçar sync de um produto |
| `/api/webhooks/bling-produto` | POST | Webhook de produtos do Bling |
| `/api/webhooks/bling` | POST | Webhook de pedidos do Bling |
| `/api/bling/test` | GET | Testar conexão Bling |

---

**Documentação criada:** 30/08/2026  
**Versão:** 2.0 (Com Webhook de Produtos)  
**Status:** ✅ Pronto para Produção
