# 🧪 Guia de Testes - Frete e Checkout

## 📋 Testes Manuais Recomendados

### Teste 1: Compra Abaixo da Meta de Frete Grátis

**Cenário:** Subtotal R$ 99,90 (< R$ 249,00)

**Passos:**
1. Adicione 1 item de R$ 99,90 à sacola
2. Vá para checkout
3. Preencha dados e endereço
4. Clique em "Calcular Frete"
5. Verifique as opções que aparecem

**Resultado Esperado ✅:**
- Nenhuma opção "Mini Envios" deve aparecer
- Nenhuma opção com preço R$ 0,00
- Prazo exibido como "5 dias úteis" (não "5 dia(s) útil(is)")
- Ao selecionar frete (ex: R$ 14,90), o resumo deve exibir:
  - Subtotal: R$ 99,90
  - Frete: R$ 14,90 (não "GRÁTIS")
  - **Total: R$ 114,80** ✅

**Resultado Errado ❌:**
- Frete: GRÁTIS (deve cobrar!)
- Total: R$ 99,90 (deveria ser R$ 114,80)

---

### Teste 2: Compra na Meta de Frete Grátis

**Cenário:** Subtotal R$ 249,00 (= R$ 249,00)

**Passos:**
1. Adicione itens que totalizem R$ 249,00
2. Vá para checkout
3. Preencha dados e endereço
4. Clique em "Calcular Frete"
5. Verifique o resumo

**Resultado Esperado ✅:**
- Ao selecionar qualquer frete, o resumo deve exibir:
  - Subtotal: R$ 249,00
  - Frete: GRÁTIS ✅
  - **Total: R$ 249,00**

**Resultado Errado ❌:**
- Frete: R$ 14,90 (deveria ser GRÁTIS!)
- Total: R$ 263,90 (deveria ser R$ 249,00)

---

### Teste 3: Compra Acima da Meta de Frete Grátis

**Cenário:** Subtotal R$ 500,00 (> R$ 249,00)

**Passos:**
1. Adicione itens que totalizem R$ 500,00
2. Vá para checkout
3. Preencha dados e endereço
4. Clique em "Calcular Frete"
5. Verifique o resumo

**Resultado Esperado ✅:**
- Ao selecionar qualquer frete, o resumo deve exibir:
  - Subtotal: R$ 500,00
  - Frete: GRÁTIS ✅
  - **Total: R$ 500,00**

---

### Teste 4: Formatação de Nomes e Prazos

**Cenário:** Calcular frete com API real do Melhor Envio

**Passos:**
1. Ter token do Melhor Envio configurado no painel admin
2. Fazer checkout com CEP real
3. Verificar lista de opções exibidas

**Resultado Esperado ✅:**
```
☐ Jadlog .COM      - 5 dias úteis  - R$ 10,50
☐ Jadlog .Package  - 3 dias úteis  - R$ 15,90
☐ Correios PAC     - 7 dias úteis  - R$ 14,90
☐ Correios SEDEX   - 1 dia útil    - R$ 24,90
```

**Resultado Errado ❌:**
```
☐ .COM             - 5 dia(s) útil(is)  - R$ 10,50
☐ Mini Envios      - 1 dia(s) útil(is)  - R$ 0,00
☐ Jadlog .Package  - 3 dia(s) útil(is)  - R$ 15,90
```

---

### Teste 5: Cupom + Frete

**Cenário:** Subtotal R$ 100,00 + Cupom 10% + Frete

**Passos:**
1. Adicione item R$ 100,00
2. Aplique cupom com 10% desconto
3. Calcule frete
4. Verifique o total

**Cálculo Esperado ✅:**
- Subtotal: R$ 100,00
- Desconto (10%): -R$ 10,00
- Subtotal com Desconto: R$ 90,00
- Frete (porque 90,00 < 249,00): +R$ 14,90
- **Total: R$ 104,90**

**Fórmula Correta:**
```
Total = (Subtotal - Desconto) + Frete
Total = (100,00 - 10,00) + 14,90 = 104,90 ✅
```

**Resultado Errado ❌:**
```
Total = Subtotal - Desconto = 90,00 (frete não foi somado!)
```

---

### Teste 6: Cupom + Frete Grátis

**Cenário:** Subtotal R$ 300,00 + Cupom 15% + Frete

**Passos:**
1. Adicione itens totalizando R$ 300,00
2. Aplique cupom com 15% desconto
3. Calcule frete
4. Verifique o total

**Cálculo Esperado ✅:**
- Subtotal: R$ 300,00
- Como 300,00 >= 249,00 → Frete GRÁTIS ✓
- Desconto (15%): -R$ 45,00
- **Total: R$ 255,00**

**Fórmula Correta:**
```
Total = (Subtotal - Desconto) + 0
Total = (300,00 - 45,00) + 0 = 255,00 ✅
```

---

## 🔍 Verificação da API

### Teste 7: Verificar Respostas da API

**Para testar o backend diretamente:**

```bash
# Terminal Windows (PowerShell)
$body = @{
    cepDestino = "01310100"
    itens = @(
        @{
            id = "1"
            quantidade = 1
            preco = 50
            width = 16
            height = 4
            length = 25
            weight = 0.3
        }
    )
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/api/frete/calcular" `
    -Method POST `
    -Headers @{"Content-Type"="application/json"} `
    -Body $body | Select-Object -ExpandProperty Content
```

**Resultado Esperado ✅:**
```json
{
  "ok": true,
  "opcoes": [
    {
      "nome": "Jadlog .COM",
      "preco": 10.5,
      "prazo": "5 dias úteis"
    },
    {
      "nome": "Correios PAC",
      "preco": 14.9,
      "prazo": "7 dias úteis"
    }
  ],
  "demo": false
}
```

**Resultado Errado ❌:**
```json
{
  "ok": true,
  "opcoes": [
    {
      "nome": ".COM",
      "preco": 0,
      "prazo": "5 dia(s) útil(is)"
    },
    {
      "nome": "Mini Envios",
      "preco": 5,
      "prazo": "1 dia(s) útil(is)"
    }
  ],
  "demo": false
}
```

---

## 📊 Tabela de Casos de Teste

| ID | Teste | Input | Expected | Status |
|----|----|-------|----------|--------|
| T1 | Subtotal R$ 99,90 | CEP válido | Frete: R$ 14,90 Total: R$ 114,80 | [ ] |
| T2 | Subtotal R$ 249,00 | CEP válido | Frete: GRÁTIS Total: R$ 249,00 | [ ] |
| T3 | Subtotal R$ 500,00 | CEP válido | Frete: GRÁTIS Total: R$ 500,00 | [ ] |
| T4 | Nomes/Prazos | API real | Jadlog .COM, 5 dias úteis | [ ] |
| T5 | Mini Envios | API real | Não exibida | [ ] |
| T6 | Preço R$ 0 | API real | Não exibida | [ ] |
| T7 | Cupom + Frete | R$ 100 + 10% | Total: R$ 104,90 | [ ] |
| T8 | Cupom + Frete Grátis | R$ 300 + 15% | Total: R$ 255,00 | [ ] |
| T9 | API Response | POST /api/frete | Sem Mini Envios, preço > 0 | [ ] |
| T10 | UI Singular/Plural | 1 dia | "1 dia útil" (não "dias") | [ ] |

---

## 🐛 Debugging

Se algo não funcionar como esperado:

### Verificar Console do Navegador
```javascript
// Abrir DevTools (F12) → Console

// Ver variáveis de frete
console.log('freteCotado:', freteCotado);
console.log('opcoesFrete:', opcoesFrete);
console.log('META_FRETE_GRATIS:', META_FRETE_GRATIS);

// Ver localStorage
console.log(JSON.parse(localStorage.getItem('mio_sacola_itens')));
console.log(JSON.parse(localStorage.getItem('mio_cupom_ativo')));
```

### Verificar Network
1. Abrir DevTools (F12) → Network
2. Clicar em "Calcular Frete"
3. Procurar requisição para `/api/frete/calcular` ou `/api/envio/calcular`
4. Ver resposta em "Response"
5. Verificar se contém "Mini Envios" ou preços zerados

### Verificar Servidor
```bash
# Ver logs do servidor
node server.js

# Deve exibir "🚀 Servidor rodando em http://localhost:3000"
```

---

## ✅ Checklist Final Pré-Produção

- [ ] Teste T1 passou (subtotal < 249 = frete cobrado)
- [ ] Teste T2 passou (subtotal = 249 = frete grátis)
- [ ] Teste T3 passou (subtotal > 249 = frete grátis)
- [ ] Teste T4 passou (nomes/prazos formatados)
- [ ] Teste T5 passou (Mini Envios não exibida)
- [ ] Teste T6 passou (Preço R$ 0 não exibida)
- [ ] Teste T7 passou (cupom + frete calculado corretamente)
- [ ] Teste T8 passou (cupom + frete grátis calculado corretamente)
- [ ] Teste T9 passou (API response formatada corretamente)
- [ ] Teste T10 passou (plurais/singulares corretos)
- [ ] Redeploy no Render feito
- [ ] Cache do navegador limpo (Ctrl+F5)
- [ ] Pronto para produção! 🚀
