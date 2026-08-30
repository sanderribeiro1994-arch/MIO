# 📋 Auditoria Completa: Sincronização Bling ↔ Supabase ↔ Site

## 🔍 Diagnóstico Atual

### ✅ Rotas Implementadas (5 de 8)

| Rota | Tipo | Status | Função |
|------|------|--------|---------|
| `POST /api/produtos` | Admin | ✅ Funcional | Cria produto no site + auto-envia para Bling |
| `PUT /api/produtos/:id` | Admin | ✅ Funcional | Atualiza produto no site + auto-envia para Bling |
| `GET /api/produtos/sync/bling` | Admin | ✅ Funcional | Importa produtos do Bling para Supabase |
| `POST /api/produtos/:id/sync/bling` | Admin | ✅ Funcional | Força sync de um produto específico |
| `POST /api/webhooks/bling` | Público | ✅ Funcional | Webhook de PEDIDOS do Bling (status/rastreio) |
| `POST /api/webhooks/bling-produto` | Público | ❌ FALTANDO | Webhook de PRODUTOS do Bling |
| `GET /api/bling/sync/pedidos` | Admin | ✅ Funcional | Sincroniza pedidos e status do Bling |
| `GET /api/bling/test` | Admin | ✅ Funcional | Testa conectividade Bling |

---

## 📊 Fluxos Atuais

### A. Site → Bling (Produtos)
```
1. Admin cria/edita produto no site
   ↓
2. POST /api/produtos ou PUT /api/produtos/:id
   ↓
3. Sistema chama enviarProdutoParaBling()
   ↓
4. Bling retorna ID (blingId)
   ↓
5. Sistema salva bling_id em Supabase (produtos.bling_id)
   ↓
6. ✅ PRONTO - Produto vinculado
```

**Problemas:**
- Sem verificação de SKU único (pode duplicar em Bling)
- Sem retry se Bling falhar
- Sem log de quem/quando sincronizou

---

### B. Bling → Site (Produtos)
```
1. Admin clica "Sincronizar Catálogo" no site
   ↓
2. GET /api/produtos/sync/bling
   ↓
3. Sistema consulta Bling API
   ↓
4. Mapeia estrutura Bling → Site
   ↓
5. Faz UPSERT em Supabase (produtos.bling_id = chave)
   ↓
6. ✅ PRONTO - Produtos importados
```

**Problemas:**
- Manual (não automático)
- Sem webhook do Bling
- Produto alterado no Bling não aparece no site até clicar sync

---

### C. Faltando: Bling → Site (Webhook)
```
❌ NÃO FUNCIONA:
1. Produto atualizado no Bling ERP
2. Bling deveria enviar POST /api/webhooks/bling-produto
3. Sistema deveria atualizar Supabase
4. Produto alterado aparecia imediatamente no site
```

**O que falta:**
- Rota `/api/webhooks/bling-produto` não existe
- Não há tratamento de evento de produto do Bling
- Não há validação de assinatura do webhook

---

## 🔧 Implementações Necessárias

### 1. Nova Rota: Webhook de Produtos Bling
**Arquivo:** `server.js`
**Rota:** `POST /api/webhooks/bling-produto`
**O que fazer:**
- Receber evento de produto do Bling
- Validar assinatura do webhook (se Bling envia)
- Extrair dados do produto (id, nome, preço, estoque, etc)
- Buscar produto no Supabase por bling_id
- Se existe: atualizar; se não: criar
- Retornar sucesso/erro

**Payload esperado do Bling:**
```json
{
  "evento": "produto.atualizado",
  "id": "123456",
  "codigo": "SKU-001",
  "nome": "Produto Teste",
  "descricao": "Descrição do produto",
  "preco": 99.90,
  "estoque": 50,
  "categoria": "Eletrônicos",
  "imagem": "https://..."
}
```

### 2. Função: Upsert de Produto com SKU Único
**Função:** `upsertProdutoBling(dados, blingId)`
**O que fazer:**
- Verificar se produto com bling_id já existe
- Se existe: atualizar todos os campos
- Se não existe: criar novo com bling_id
- Usar Supabase UPSERT com bling_id como chave
- Retornar ID do produto (criado ou atualizado)

### 3. Auditoria: Campos de Log de Sync
**Tabela:** `produtos`
**Campos a adicionar:**
- `data_last_sync` (timestamptz) - Quando foi última sync
- `sync_status` (text) - 'sucesso', 'falha', 'pendente'
- `sync_tentativas` (integer) - Quantas vezes tentou sincronizar
- `sync_erro` (text) - Mensagem do último erro

### 4. Validação: SKU Único no Bling
**O que fazer:**
- Antes de enviar produto para Bling, verificar se SKU já existe
- Se sim: fazer PUT (atualizar) em vez de POST (criar)
- Adicionar verificação de duplicatas

---

## 🚀 Implementação Passo a Passo

### Fase 1: Webhook de Produtos (CRÍTICO)
✅ Criar POST /api/webhooks/bling-produto
✅ Implementar upsertProdutoBling()
✅ Adicionar campos de auditoria no schema

### Fase 2: Validação e Retry (IMPORTANTE)
✅ Verificar SKU único antes de enviar
✅ Implementar retry automático em caso de falha
✅ Logar cada tentativa de sync

### Fase 3: Documentação e Testes (FINAL)
✅ Atualizar admin.html com novos status
✅ Criar guia de configuração de webhook no Bling
✅ Adicionar testes de sync bidirecional

---

## 📋 Checklist de Validação

Após implementação, verificar:

- [ ] Rota POST /api/webhooks/bling-produto existe e recebe dados
- [ ] Produto criado no Bling → Webhook enviado → Aparece no Supabase
- [ ] Produto atualizado no Bling → Webhook enviado → Atualizado no Supabase
- [ ] Produto criado no Site → Aparece no Bling com SKU correto
- [ ] Campo bling_id está preenchido para todos os produtos sincronizados
- [ ] Sem produtos duplicados em Supabase (mesmo bling_id)
- [ ] Logs de sync visíveis no painel admin
- [ ] Webhook do Bling validado e seguro

---

## 🔐 Segurança

**Considerações para o Webhook:**
1. Validar origem da requisição (IP whitelist do Bling)
2. Validar assinatura/token do webhook se Bling envia
3. Rate limit para evitar spam (máximo 100 webhooks/minuto)
4. Logar todas as requisições de webhook para auditoria
5. Não expor erro detalhado em resposta (apenas log interno)

---

## 📞 Próximos Passos

1. **Hoje:** Implementar webhook POST /api/webhooks/bling-produto
2. **Hoje:** Adicionar campos de auditoria em banco
3. **Amanhã:** Testar com produtos reais do Bling
4. **Amanhã:** Configurar webhook no painel do Bling
5. **Semana que vem:** Monitorar logs e ajustar conforme necessário

---

Documento criado em: 2026-08-30
Próxima revisão: Após implementação das fases 1-2
