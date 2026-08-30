# ⚡ Ação Necessária: Aplicar Schema Supabase

## 🎯 O Que Você Precisa Fazer

Para que a sincronização completa funcione, você precisa **aplicar os updates de schema** no Supabase.

---

## ✅ Passo 1: Acessar Supabase SQL Editor

```
1. Vá para: https://supabase.com/dashboard
2. Selecione seu projeto
3. Clique em: SQL Editor (no menu esquerdo)
4. Clique em: New Query
```

---

## ✅ Passo 2: Copiar e Colar o SQL

Abra o arquivo: **`supabase-schema.sql`**

Procure pela seção comentada:
```
-- Adicionar coluna de comentário para rastrear mudanças
comment on column public.produtos.bling_id is ...
```

Copie TODO o SQL dessa seção até a próxima tabela (CREATE TABLE ... banners).

No Supabase SQL Editor, cole o SQL.

---

## ✅ Passo 3: Executar

```
Clique em: RUN (botão azul no canto superior direito)
```

O SQL vai:
- ✅ Adicionar coluna `data_last_sync`
- ✅ Adicionar coluna `sync_status`
- ✅ Adicionar coluna `sync_tentativas`
- ✅ Adicionar coluna `sync_erro`
- ✅ Criar índices para performance

**Leva ~2-5 segundos para completar.**

---

## ✅ Passo 4: Validar

```sql
-- Cole este comando para verificar se funcionou:
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'produtos' 
ORDER BY ordinal_position;
```

Procure por:
- `data_last_sync` ✅
- `sync_status` ✅
- `sync_tentativas` ✅
- `sync_erro` ✅

Se aparecerem, significa que tudo funcionou!

---

## 🐛 Se Der Erro

### Erro: "Column already exists"
```
Significa que você já tem a coluna.
Isso é OK! Pode continuar.
O código vai funcionar mesmo assim.
```

### Erro: "Table does not exist"
```
Significa que sua tabela 'produtos' não existe.
Algo está muito errado. Contate suporte.
```

### Outro erro qualquer
```
Copie a mensagem de erro
Cole em: https://github.com/sanderribeiro1994-arch/MIO/issues
```

---

## 🎁 Bônus: SQL Útil para Debug

Depois de rodar o schema, você pode usar estes comandos:

### Ver último status de sync
```sql
SELECT nome, bling_id, sync_status, data_last_sync 
FROM produtos 
ORDER BY data_last_sync DESC 
LIMIT 10;
```

### Ver produtos com erro
```sql
SELECT nome, sync_erro, sync_tentativas 
FROM produtos 
WHERE sync_status = 'falha';
```

### Ver estatísticas
```sql
SELECT 
  sync_status,
  COUNT(*) as total,
  MAX(data_last_sync) as ultima_sync
FROM produtos
GROUP BY sync_status;
```

---

## ⏰ Tempo Estimado

- **Copiar SQL:** 30 segundos
- **Executar no Supabase:** 2-5 segundos
- **Validar:** 30 segundos
- **Total:** ~2 minutos

---

## ✨ Depois de Fazer Isso

A sincronização **bidirecional completa** estará ativa:

✅ Criar produto no site → vai para Bling automaticamente  
✅ Criar produto no Bling → importa clicando botão no site  
✅ Produto alterado no Bling → webhook sincroniza automaticamente  
✅ Auditoria completa → logs de todas as sincronizações  

---

## 📞 Próximo Passo

Depois de aplicar o schema:

1. **Opcional:** Configure o webhook do Bling
   - Ver instruções em: `GUIA_SINCRONIZACAO_BIDIRECIONAL.md`

2. **Teste:** Crie um produto no site
   - Deve aparecer no Bling em ~5 minutos
   - Campo `bling_id` deve estar preenchido no Supabase

3. **Teste:** Importe produtos do Bling
   - Clique "Sincronizar Catálogo" no admin
   - Produtos devem aparecer com `bling_id` vinculado

---

**Pronto! Depois de fazer isso, tudo funciona! 🚀**
