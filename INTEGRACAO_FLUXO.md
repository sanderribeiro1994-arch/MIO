# 🔄 Fluxo Completo de Integração: Checkout → PagSeguro → Melhor Envio → Upseller

## ✅ Status Atual: PRONTO PARA PRODUÇÃO

---

## 📋 FLUXO DE COMPRA

### 1️⃣ **ETAPA 1: DADOS PESSOAIS** (checkout.html)
- ✅ Coleta nome, CPF, telefone, email
- ✅ Valida e prossegue

### 2️⃣ **ETAPA 2: ENDEREÇO DE ENTREGA** (checkout.html)
- ✅ Busca CEP automático via ViaCEP
- ✅ **Calcula frete via Melhor Envio** → POST `/api/envio/calcular`
  - Se Melhor Envio não configurado: usa fallback por UF
  - Cliente escolhe transportadora (PAC, SEDEX, etc.)
- ✅ Mostra prazo e valor do frete

### 3️⃣ **ETAPA 3: PAGAMENTO** (checkout.html)
Cliente escolhe entre:
- **PIX**: Gera código via PagSeguro → POST `/api/pagamento/pix`
- **Cartão**: Processa imediatamente via PagSeguro → POST `/api/pagamento/cartao`

---

## 💳 PROCESSAMENTO DE PAGAMENTO

### ✅ PIX
1. Checkout gera PIX via PagSeguro
2. Mostra QR Code para o usuário escanear
3. **Webhook do PagSeguro** → POST `/api/pagamento/webhook`
   - PagSeguro notifica quando PIX é pago
   - Atualiza status do pedido para **"Pago"**
   - **Envia automaticamente ao Upseller** ✅

### ✅ CARTÃO
1. Checkout envia dados do cartão ao PagSeguro
2. Se aprovado:
   - Atualiza status para **"Pago"**
   - **Envia imediatamente ao Upseller** ✅

---

## 📦 ENVIO AO UPSELLER (Expedição)

### Automático:
- ✅ Quando pagamento é confirmado (PIX/Cartão)
- ✅ Webhook envia automaticamente → POST `/api/upseller/pedido`
- ✅ Pedido aparece no painel Upseller para expedição

### Manual (Backup):
- ✅ Admin pode reenviar pelo painel → POST `/api/upseller/reenviar/{numeroPedido}`
- ✅ Se enviou automaticamente mas falhou, pode tentar de novo

---

## 🎯 ONDE VER OS DADOS

### 📱 Painel Admin (admin.html)
- **Aba: Pedidos** → Lista todos os pedidos
- **Coluna Status**: Mostra "Aguardando Pagamento" ou "Pago"
- **Ação Manual**: Botão para reenviar ao Upseller (se necessário)

### 📊 Upseller
- Acesse https://upseller.com.br
- Pedidos aparecem automaticamente quando pagos
- Status: "Novo", "Separando", "Enviado", etc.

### 📧 Painel PagSeguro
- Acesse https://pagseguro.uol.com.br
- Veja pagamentos confirmados
- Transações PIX e Cartão

### 📤 Melhor Envio
- Acesse https://melhorenvio.com.br
- Veja fretes cotados e etiquetas
- Imprima rótulos de envio

---

## 🔧 CONFIGURAÇÃO NECESSÁRIA

No painel admin, ir para **Configurações**:

### 1. **Pagamentos (PagSeguro)**
- [ ] Email da conta PagSeguro
- [ ] Token
- [ ] Application ID
- [ ] Application Key
- [ ] Ativar checkbox "Ativar recebimento via PagSeguro"
- [ ] Testar conexão
- [ ] Salvar

### 2. **Envio & Expedição (Melhor Envio)**
- [ ] Token da API Melhor Envio
- [ ] CEP de Origem (de onde os produtos saem)
- [ ] Modo: Sandbox (testes) ou Produção
- [ ] Ativar checkbox
- [ ] Testar conexão
- [ ] Salvar

### 3. **Expedição (Upseller)**
- [ ] Token da API Upseller
- [ ] Store ID
- [ ] URL da API (padrão: https://api.upseller.com.br)
- [ ] Ativar checkbox
- [ ] Testar conexão
- [ ] Salvar

---

## 🚀 FLUXO TÉCNICO (Resumo)

```
CHECKOUT.HTML
    ↓
ETAPA 1: Dados Pessoais → Validação Local
    ↓
ETAPA 2: Endereço de Entrega
    ├→ ViaCEP (busca automática)
    └→ GET /api/envio/calcular (Melhor Envio)
        ↓
        Mostra opções de frete (PAC, SEDEX, etc.)
    ↓
ETAPA 3: Pagamento
    ├→ PIX
    │   ├→ POST /api/pedidos (salva pedido)
    │   ├→ POST /api/pagamento/pix (gera PIX)
    │   └→ Mostra QR Code
    │       ↓
    │       (Usuário paga via banco)
    │       ↓
    │       Webhook /api/pagamento/webhook (PagSeguro notifica)
    │       ├→ UPDATE pedidos SET status = 'Pago'
    │       └→ POST /api/upseller/pedido (envia ao Upseller)
    │
    └→ CARTÃO
        ├→ POST /api/pedidos (salva pedido)
        ├→ POST /api/pagamento/cartao (processa PagSeguro)
        │   ↓
        │   Se Aprovado:
        │   ├→ UPDATE pedidos SET status = 'Pago'
        │   └→ POST /api/upseller/pedido (envia ao Upseller)
        │
        └→ Mostra confirmação
```

---

## ✨ O QUE ESTÁ PRONTO

| Serviço | API Backend | Checkout | Webhook | Status |
|---------|-------------|----------|---------|--------|
| **PagSeguro PIX** | ✅ | ✅ | ✅ | ✅ PRONTO |
| **PagSeguro Cartão** | ✅ | ✅ | ✅ | ✅ PRONTO |
| **Melhor Envio** | ✅ | ✅ | N/A | ✅ PRONTO |
| **Upseller** | ✅ | ✅ | ✅ | ✅ PRONTO |
| **Painel Admin** | ✅ | N/A | N/A | ✅ PRONTO |

---

## 🔐 SEGURANÇA

- ✅ Cartão NÃO é salvo no banco de dados
- ✅ Dados de pagamento são processados via PagSeguro
- ✅ Webhook validado (recebe apenas de PagSeguro)
- ✅ APIs protegidas com autenticação

---

## 🆘 TROUBLESHOOTING

### Pedido não apareceu no Upseller?
1. Verifique se Upseller está ativado no painel admin
2. Teste a conexão
3. Verifique Token e Store ID
4. Use o botão "Reenviar ao Upseller" no painel admin

### Frete não está sendo calculado?
1. Verifique se Melhor Envio está ativado
2. Teste a conexão
3. Verifique Token e CEP de Origem
4. Checkout exibe fallback com valor padrão se falhar

### Pagamento não foi confirmado?
1. Verifique credenciais PagSeguro
2. PIX: Aguarde até 30 min para webhook confirmar
3. Cartão: Teste em modo Sandbox primeiro
4. Verifique logs do servidor

---

## 📞 PRÓXIMOS PASSOS

1. Obter credenciais das 3 plataformas:
   - PagSeguro: https://pagseguro.uol.com.br
   - Melhor Envio: https://melhorenvio.com.br
   - Upseller: https://upseller.com.br

2. Configurar no painel admin

3. Testar em Sandbox

4. Migrar para Produção

5. Fazer compra de teste

6. Confirmar no Upseller

---

**Tudo pronto! 🎉**
