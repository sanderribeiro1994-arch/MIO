# 🎯 Diagrama Visual - Fluxo de Cálculo de Frete

## ANTES das Mudanças ❌

```
┌─────────────────────────────────────────────────────────┐
│ MELHOR ENVIO API RESPONSE (Bruto)                       │
├─────────────────────────────────────────────────────────┤
│ [                                                       │
│   { id: 1, company: "Jadlog", name: ".COM",            │
│     price: 0, delivery_time: 5 },                      │
│   { id: 2, company: "Mini Envios", name: "PAC",        │
│     price: 5, delivery_time: 3 },                      │
│   { id: 3, company: "Correios", name: "PAC",           │
│     price: 14.90, delivery_time: 7, error: null },    │
│   { id: 4, company: "Correios", name: "SEDEX",         │
│     price: 24.90, delivery_time: 1 }                   │
│ ]                                                       │
└─────────────────────────────────────────────────────────┘
            ↓ server.js (sem formatação)
┌─────────────────────────────────────────────────────────┐
│ BACKEND - /api/frete/calcular (ERRADO)                │
├─────────────────────────────────────────────────────────┤
│ opcoes = data.map(o => ({                              │
│   nome: o.name || o.company,  ← CORTADO!               │
│   preco: o.price,             ← 0 PERMITIDO!           │
│   prazo: o.delivery_time + " dia(s) útil(is)"          │
│                   ↓ FORMATO ERRADO!                    │
│ }))                                                     │
└─────────────────────────────────────────────────────────┘
            ↓ Retorna ao Frontend
┌─────────────────────────────────────────────────────────┐
│ FRONTEND - checkout.html (renderiza tudo)              │
├─────────────────────────────────────────────────────────┤
│ opcoesFrete = [                                         │
│   { nome: ".COM", preco: 0, prazo: "5 dia(s) útil(is)" }
│   { nome: "Mini Envios PAC", preco: 5, ... }      ← BUG!
│   { nome: "PAC", preco: 14.90, prazo: "7 dia(s)..." }
│   { nome: "SEDEX", preco: 24.90, prazo: "1 dia(s)..." }
│ ]                                                       │
└─────────────────────────────────────────────────────────┘
            ↓ Exibe para usuário
┌─────────────────────────────────────────────────────────┐
│ UI (ERRADA)                                             │
├─────────────────────────────────────────────────────────┤
│ ☐ .COM                    - 5 dia(s) útil(is)  - R$ 0,00
│ ☐ Mini Envios PAC         - 5 dia(s) útil(is)  - R$ 5,00
│ ☐ PAC                     - 7 dia(s) útil(is)  - R$ 14,90
│ ☐ SEDEX                   - 1 dia(s) útil(is)  - R$ 24,90
│                                                         │
│ Subtotal: R$ 100,00                                     │
│ Frete: GRÁTIS ← ERRADO! (deveria ser R$ 14,90)         │
│ Total: R$ 100,00 ← ERRADO! (deveria ser R$ 114,90)     │
└─────────────────────────────────────────────────────────┘
```

---

## DEPOIS das Mudanças ✅

```
┌─────────────────────────────────────────────────────────┐
│ MELHOR ENVIO API RESPONSE (Bruto)                       │
├─────────────────────────────────────────────────────────┤
│ [                                                       │
│   { id: 1, company: "Jadlog", name: ".COM",            │
│     price: 0, delivery_time: 5 },                      │
│   { id: 2, company: "Mini Envios", name: "PAC",        │
│     price: 5, delivery_time: 3 },                      │
│   { id: 3, company: "Correios", name: "PAC",           │
│     price: 14.90, delivery_time: 7 },                  │
│   { id: 4, company: "Correios", name: "SEDEX",         │
│     price: 24.90, delivery_time: 1 }                   │
│ ]                                                       │
└─────────────────────────────────────────────────────────┘
            ↓ server.js (COM formatarOpcoesFrete)
┌─────────────────────────────────────────────────────────┐
│ BACKEND - /api/frete/calcular (CORRETO)               │
├─────────────────────────────────────────────────────────┤
│ 1. FILTRA:                                              │
│    ✓ Remove price = 0 (Jadlog .COM)                    │
│    ✓ Remove "Mini Envios"                              │
│    ✓ Mantém Correios PAC e SEDEX                       │
│                                                         │
│ 2. FORMATA:                                             │
│    ✓ "Correios" + " PAC" = "Correios PAC"              │
│    ✓ Delivery 7 = "7 dias úteis" (plural)              │
│    ✓ Delivery 1 = "1 dia útil" (singular)              │
│                                                         │
│ opcoes = [                                              │
│   { nome: "Correios PAC",                              │
│     preco: 14.90,                                       │
│     prazo: "7 dias úteis" },   ← CORRETO!              │
│   { nome: "Correios SEDEX",                            │
│     preco: 24.90,                                       │
│     prazo: "1 dia útil" }      ← CORRETO!              │
│ ]                                                       │
└─────────────────────────────────────────────────────────┘
            ↓ Retorna ao Frontend
┌─────────────────────────────────────────────────────────┐
│ FRONTEND - checkout.html                               │
│ renderizarOpcoesFrete() (com filtro extra)             │
├─────────────────────────────────────────────────────────┤
│ opcoesFiltradas = opcoesFrete.filter(o => {            │
│   if (o.preco <= 0) return false;  ← Camada extra!    │
│   if (o.nome.includes("mini envio")) return false;     │
│   return true;                                          │
│ })                                                      │
│                                                         │
│ Resultado:                                              │
│ [                                                       │
│   { nome: "Correios PAC",    preco: 14.90, ... },     │
│   { nome: "Correios SEDEX",  preco: 24.90, ... }      │
│ ]                                                       │
└─────────────────────────────────────────────────────────┘
            ↓ Exibe para usuário
┌─────────────────────────────────────────────────────────┐
│ UI (CORRETA)                                            │
├─────────────────────────────────────────────────────────┤
│ ☐ Correios PAC             - 7 dias úteis    - R$ 14,90
│ ☐ Correios SEDEX           - 1 dia útil      - R$ 24,90
│                                                         │
│ Subtotal: R$ 100,00                                     │
│ Frete: R$ 14,90 ← CORRETO! (não é grátis)              │
│ Total: R$ 114,90 ← CORRETO!                            │
└─────────────────────────────────────────────────────────┘
```

---

## Lógica de Frete Grátis

### ANTES ❌

```
function carregarItensCheckout() {
  const subtotal = 100;
  const frete = 14.90;
  
  // PROBLEMA: exibe "GRÁTIS" mesmo quando deve cobrar
  if (frete === 0) {
    display "GRÁTIS"
  } else {
    display "R$ 14.90"
  }
  
  // Mas o frete foi zerado? Por quê?
  // → Sem checar se pedido qualifica (subtotal >= 249)
  // → Apenas zerava se subtotal >= 249 no cálculo
  // → Mas exibia "GRÁTIS" para QUALQUER frete = 0
}
```

### DEPOIS ✅

```
function carregarItensCheckout() {
  const subtotal = 100;
  const META_FRETE_GRATIS = 249;
  const freteCotado = 14.90;
  
  // 1️⃣ VERIFICA QUALIFICAÇÃO
  const temDireitoAFreteGratis = subtotal >= META_FRETE_GRATIS;
  
  // 2️⃣ CALCULA O FRETE
  const valorFrete = temDireitoAFreteGratis ? 0 : freteCotado.valor;
  // Se subtotal >= 249 → frete = 0
  // Se subtotal < 249  → frete = 14.90
  
  // 3️⃣ EXIBE COM LÓGICA CLARA
  if (valorFrete === 0 && temDireitoAFreteGratis) {
    display "GRÁTIS"  ← Só se AMBAS são true
  } else {
    display "R$ 14.90"
  }
  
  // 4️⃣ CALCULA TOTAL CORRETAMENTE
  const total = subtotal - desconto + valorFrete;
  // = 100 - 0 + 14.90 = 114.90 ✅
}
```

---

## Exemplos de Cálculo

### Exemplo 1: Compra sem direito a frete grátis

```
INPUT:
  subtotal = R$ 100,00
  desconto = R$ 0,00
  freteCotado = R$ 14,90
  META_FRETE_GRATIS = R$ 249,00

FLUXO:
  temDireitoAFreteGratis = (100 >= 249) → FALSE
  valorFrete = FALSE ? 0 : 14.90 → 14.90
  
EXIBIÇÃO:
  Frete: "R$ 14,90" ✅ (não é grátis)
  
CÁLCULO:
  total = (100 - 0) + 14.90 = 114.90 ✅

RESULTADO:
  ✓ Subtotal: R$ 100,00
  ✓ Frete: R$ 14,90
  ✓ Total: R$ 114,90
```

### Exemplo 2: Compra COM direito a frete grátis

```
INPUT:
  subtotal = R$ 249,00
  desconto = R$ 0,00
  freteCotado = R$ 24,90
  META_FRETE_GRATIS = R$ 249,00

FLUXO:
  temDireitoAFreteGratis = (249 >= 249) → TRUE
  valorFrete = TRUE ? 0 : 24.90 → 0
  
EXIBIÇÃO:
  Frete: "GRÁTIS" ✅ (qualifica)
  
CÁLCULO:
  total = (249 - 0) + 0 = 249 ✅

RESULTADO:
  ✓ Subtotal: R$ 249,00
  ✓ Frete: GRÁTIS
  ✓ Total: R$ 249,00
```

### Exemplo 3: Cupom + Frete

```
INPUT:
  subtotal = R$ 100,00
  cupom desconto = 10%
  freteCotado = R$ 14,90
  META_FRETE_GRATIS = R$ 249,00

FLUXO:
  desconto = 100 * 0.10 = 10
  temDireitoAFreteGratis = (100 >= 249) → FALSE
  valorFrete = 14.90
  
EXIBIÇÃO:
  Subtotal: R$ 100,00
  Desconto: -R$ 10,00
  Frete: R$ 14,90
  
CÁLCULO:
  total = (100 - 10) + 14.90 = 104.90 ✅

RESULTADO:
  ✓ Total: R$ 104,90
```

---

## Resumo das Transformações

| Aspecto | Antes ❌ | Depois ✅ |
|---------|----------|----------|
| **Mini Envios** | Exibido | Filtrado |
| **Preço R$ 0** | Exibido | Filtrado |
| **Nome** | ".COM" | "Jadlog .COM" |
| **Prazo** | "5 dia(s) útil(is)" | "5 dias úteis" |
| **Frete < 249** | GRÁTIS (errado) | Cobrado (correto) |
| **Frete >= 249** | GRÁTIS (correto) | GRÁTIS (correto) |
| **Total < 249** | Sem frete somado | Frete somado ✅ |
| **Total >= 249** | Sem frete cobrado | Sem frete cobrado ✅ |

---

## Fluxo de Dados - Visão Geral

```
                    ┌──────────────┐
                    │ API Bruta    │
                    │ Melhor Envio │
                    └──────┬───────┘
                           │ [raw data]
                           ↓
                ┌──────────────────────────┐
                │ server.js                │
                │ formatarOpcoesFrete()    │ ← FILTRA + FORMATA
                └──────────┬───────────────┘
                           │ [filtered & formatted]
                           ↓
                ┌──────────────────────────┐
                │ HTTP Response            │
                │ /api/frete/calcular      │
                └──────────┬───────────────┘
                           │ JSON opcoes[]
                           ↓
                ┌──────────────────────────┐
                │ checkout.html            │
                │ renderizarOpcoesFrete()  │ ← FILTRA NOVAMENTE (defesa)
                └──────────┬───────────────┘
                           │ [doubly filtered]
                           ↓
                ┌──────────────────────────┐
                │ User Interface           │
                │ Radio buttons listados   │
                └──────────┬───────────────┘
                           │ Usuário seleciona
                           ↓
                ┌──────────────────────────┐
                │ carregarItensCheckout()  │
                │ calcularTotaisCheckout() │ ← CALCULA FRETE GRÁTIS
                └──────────┬───────────────┘
                           │ {total, frete, desconto}
                           ↓
                ┌──────────────────────────┐
                │ Exibe Resumo             │
                │ Subtotal / Desconto      │
                │ Frete / Total            │
                └──────────────────────────┘
```

---

## Camadas de Validação (Defense in Depth)

```
CAMADA 1: Backend (server.js)
└─ formatarOpcoesFrete() filtra e formata
   ✓ Remove Mini Envios
   ✓ Remove preço = 0
   ✓ Remove com erro
   ✓ Formata nomes
   ✓ Formata prazos

       ↓

CAMADA 2: Frontend (checkout.html)
└─ renderizarOpcoesFrete() filtra novamente
   ✓ Remove preço <= 0
   ✓ Remove "mini envio"
   
       ↓

CAMADA 3: Lógica (checkout.html)
└─ carregarItensCheckout() valida total
   ✓ Verifica subtotal >= 249
   ✓ Aplica regra de frete grátis
   ✓ Calcula total corretamente
```

Resultado: Mesmo se uma camada falhar, as outras garantem o funcionamento correto! 🔐
