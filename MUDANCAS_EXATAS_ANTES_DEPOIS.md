# 🎯 Alterações Exatas - Antes e Depois

## 1️⃣ BACKEND: server.js

### ✅ NOVO: Função `formatarOpcoesFrete()`

**Arquivo:** `server.js`  
**Localização:** Adicionar ANTES da rota `app.post('/api/frete/calcular'...)`

```javascript
// Helper: Formata e filtra opções de frete
function formatarOpcoesFrete(data) {
  if (!Array.isArray(data)) return [];
  
  return data
    .filter(o => {
      // Remove opções com erro
      if (o.error) return false;
      // Remove Mini Envios
      if ((o.name || '').toLowerCase().includes('mini envio')) return false;
      // Remove opções com preço zerado ou inválido
      if (!o.price || Number(o.price) <= 0) return false;
      return true;
    })
    .map(o => {
      // Combina nome da empresa + serviço para exibição melhor
      const nomeEmpresa = (o.company || '').trim();
      const nomeServico = (o.name || '').trim();
      let nomeFinal = nomeEmpresa;
      
      // Se houver nome de serviço diferente da empresa, combina
      if (nomeServico && !nomeServico.toLowerCase().startsWith(nomeEmpresa.toLowerCase())) {
        nomeFinal = `${nomeEmpresa} ${nomeServico}`.trim();
      } else if (!nomeEmpresa && nomeServico) {
        nomeFinal = nomeServico;
      }
      
      // Formata prazo: converte "8" em "8 dias úteis" (singular/plural)
      const tempoEntrega = Number(o.delivery_time || 0);
      let prazoFinal = '5 dias úteis'; // padrão
      if (tempoEntrega > 0) {
        prazoFinal = tempoEntrega === 1 ? '1 dia útil' : `${tempoEntrega} dias úteis`;
      }
      
      return {
        nome: nomeFinal || 'Entrega Padrão',
        preco: Number(o.price || 0),
        prazo: prazoFinal
      };
    });
}
```

---

### ✅ MODIFICADA: Rota `/api/frete/calcular`

**Arquivo:** `server.js` (linha ~1108)

#### ❌ ANTES:
```javascript
    const data = await resApi.json().catch(() => ({}));
    if (!resApi.ok) return res.status(502).json({ error: data.message || 'Erro ao calcular frete.' });
    const opcoes = Array.isArray(data) ? data.map(o => ({
      nome: o.name || o.company || 'Entrega',
      preco: Number(o.price || 0),
      prazo: `${o.delivery_time || 0} dia(s) útil(is)`
    })) : [];
    return res.json({ ok: true, opcoes, demo: false });
```

#### ✅ DEPOIS:
```javascript
    const data = await resApi.json().catch(() => ({}));
    if (!resApi.ok) return res.status(502).json({ error: data.message || 'Erro ao calcular frete.' });
    
    // Formata e filtra as opções
    const opcoes = formatarOpcoesFrete(data);
    return res.json({ ok: true, opcoes: opcoes.length > 0 ? opcoes : [], demo: false });
```

---

### ✅ MODIFICADA: Rota `/api/envio/calcular`

**Arquivo:** `server.js` (linha ~1168)

#### ❌ ANTES:
```javascript
    const data = await resApi.json().catch(() => ({}));
    if (!resApi.ok) return res.status(502).json({ error: data.message || "Erro ao calcular frete." });
    if (Array.isArray(data)) {
      const opcoes = data.map(o => ({ nome: o.name, preco: o.price, prazo: o.delivery_time + ' dia(s) útil(is)' }));
      return res.json({ ok: true, opcoes });
    }
    res.json({ ok: true, opcoes: [] });
```

#### ✅ DEPOIS:
```javascript
    const data = await resApi.json().catch(() => ({}));
    if (!resApi.ok) return res.status(502).json({ error: data.message || "Erro ao calcular frete." });
    
    // Formata e filtra as opções
    const opcoes = formatarOpcoesFrete(data);
    return res.json({ ok: true, opcoes: opcoes.length > 0 ? opcoes : [] });
```

---

## 2️⃣ FRONTEND: checkout.html

### ✅ MODIFICADA: Função `renderizarOpcoesFrete()`

**Arquivo:** `public/checkout.html` (linha ~524)

#### ❌ ANTES:
```javascript
    function renderizarOpcoesFrete() {
      const container = document.getElementById('opcoesFrete');
      if (opcoesFrete.length === 0) {
        container.innerHTML = `<p class="text-xs text-zinc-500 font-mono py-2">Nenhuma opção de frete disponível. Usando o valor padrão.</p>`;
        return;
      }
      container.innerHTML = opcoesFrete.map((o, idx) => `
        <label class="flex items-center gap-3 bg-zinc-900 border ${o.preco === freteCotado.valor ? 'border-amber-400' : 'border-zinc-800'} rounded-lg px-3 py-2.5 cursor-pointer hover:border-amber-400 transition">
          <input type="radio" name="opcaoFrete" value="${idx}" ${o.preco === freteCotado.valor ? 'checked' : ''} onchange="selecionarFrete(${idx})" class="accent-amber-400">
          <div class="flex-1">
            <p class="text-xs font-bold text-white uppercase">${o.nome}</p>
            <p class="text-[10px] font-mono text-zinc-500">${o.prazo}</p>
          </div>
          <span class="text-sm font-black font-mono text-amber-400">R$ ${Number(o.preco).toFixed(2).replace('.', ',')}</span>
        </label>
      `).join('');
    }
```

#### ✅ DEPOIS:
```javascript
    function renderizarOpcoesFrete() {
      const container = document.getElementById('opcoesFrete');
      if (opcoesFrete.length === 0) {
        container.innerHTML = `<p class="text-xs text-zinc-500 font-mono py-2">Nenhuma opção de frete disponível. Usando o valor padrão.</p>`;
        return;
      }
      
      // Filtra novamente no frontend como camada adicional de segurança
      const opcoesFiltradas = opcoesFrete.filter(o => {
        // Remove opções com preço 0 ou inválido
        if (!o.preco || Number(o.preco) <= 0) return false;
        // Remove opções com nome "Mini Envios"
        if ((o.nome || '').toLowerCase().includes('mini envio')) return false;
        return true;
      });
      
      if (opcoesFiltradas.length === 0) {
        container.innerHTML = `<p class="text-xs text-zinc-500 font-mono py-2">Nenhuma opção de frete disponível. Usando o valor padrão.</p>`;
        return;
      }
      
      container.innerHTML = opcoesFiltradas.map((o, idx) => `
        <label class="flex items-center gap-3 bg-zinc-900 border ${o.preco === freteCotado.valor ? 'border-amber-400' : 'border-zinc-800'} rounded-lg px-3 py-2.5 cursor-pointer hover:border-amber-400 transition">
          <input type="radio" name="opcaoFrete" value="${idx}" ${o.preco === freteCotado.valor ? 'checked' : ''} onchange="selecionarFrete(${idx})" class="accent-amber-400">
          <div class="flex-1">
            <p class="text-xs font-bold text-white uppercase">${o.nome}</p>
            <p class="text-[10px] font-mono text-zinc-500">${o.prazo}</p>
          </div>
          <span class="text-sm font-black font-mono text-amber-400">R$ ${Number(o.preco).toFixed(2).replace('.', ',')}</span>
        </label>
      `).join('');
    }
```

---

### ✅ MODIFICADA: Função `carregarItensCheckout()`

**Arquivo:** `public/checkout.html` (linha ~410)

#### ❌ ANTES (seção de cálculo de frete):
```javascript
// Frete: usa o valor cotado (Melhor Envio ou fallback), respeitando a meta de frete grátis
      const valorFrete = subtotal >= META_FRETE_GRATIS ? 0 : freteCotado.valor;
      const totalFinal = Math.max(0, subtotal - valorDesconto) + valorFrete;

      document.getElementById('subtotalCheckout').innerText = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
      document.getElementById('freteCheckout').innerText = valorFrete === 0 ? 'GRÁTIS' : `R$ ${valorFrete.toFixed(2).replace('.', ',')}`;
      document.getElementById('totalFinalCheckout').innerText = `R$ ${totalFinal.toFixed(2).replace('.', ',')}`;
```

#### ✅ DEPOIS (seção de cálculo de frete):
```javascript
      // FRETE: Regra de frete grátis
      // - Se subtotal >= R$ 249,00 → frete GRÁTIS
      // - Se subtotal < R$ 249,00 → cobra o frete da opção selecionada
      const temDireitoAFreteGratis = subtotal >= META_FRETE_GRATIS;
      const valorFrete = temDireitoAFreteGratis ? 0 : freteCotado.valor;
      const totalFinal = Math.max(0, subtotal - valorDesconto) + valorFrete;

      document.getElementById('subtotalCheckout').innerText = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
      
      // Exibe "GRÁTIS" apenas se subtotal >= 249
      if (valorFrete === 0 && temDireitoAFreteGratis) {
        document.getElementById('freteCheckout').innerText = 'GRÁTIS';
      } else {
        document.getElementById('freteCheckout').innerText = `R$ ${valorFrete.toFixed(2).replace('.', ',')}`;
      }
      
      document.getElementById('totalFinalCheckout').innerText = `R$ ${totalFinal.toFixed(2).replace('.', ',')}`;
```

---

### ✅ MODIFICADA: Função `calcularTotaisCheckout()`

**Arquivo:** `public/checkout.html` (linha ~663)

#### ❌ ANTES:
```javascript
    function calcularTotaisCheckout() {
      const sacola = JSON.parse(localStorage.getItem('mio_sacola_itens') || '[]');
      const cupomAtivo = JSON.parse(localStorage.getItem('mio_cupom_ativo') || 'null');
      let subtotal = sacola.reduce((acc, i) => acc + (i.preco * i.quantidade), 0);
      let valorDesconto = 0;
      if (cupomAtivo) {
        valorDesconto = cupomAtivo.tipo === 'porcentagem'
          ? subtotal * (cupomAtivo.valor / 100)
          : cupomAtivo.valor;
      }
      const valorFrete = subtotal >= META_FRETE_GRATIS ? 0 : freteCotado.valor;
      return {
        subtotal,
        desconto: valorDesconto,
        frete: valorFrete,
        total: Math.max(0, subtotal - valorDesconto) + valorFrete
      };
    }
```

#### ✅ DEPOIS:
```javascript
    function calcularTotaisCheckout() {
      const sacola = JSON.parse(localStorage.getItem('mio_sacola_itens') || '[]');
      const cupomAtivo = JSON.parse(localStorage.getItem('mio_cupom_ativo') || 'null');
      let subtotal = sacola.reduce((acc, i) => acc + (i.preco * i.quantidade), 0);
      let valorDesconto = 0;
      if (cupomAtivo) {
        valorDesconto = cupomAtivo.tipo === 'porcentagem'
          ? subtotal * (cupomAtivo.valor / 100)
          : cupomAtivo.valor;
      }
      
      // FRETE: Regra de frete grátis
      // - Se subtotal >= R$ 249,00 → frete GRÁTIS
      // - Se subtotal < R$ 249,00 → cobra o frete da opção selecionada
      const temDireitoAFreteGratis = subtotal >= META_FRETE_GRATIS;
      const valorFrete = temDireitoAFreteGratis ? 0 : freteCotado.valor;
      
      return {
        subtotal,
        desconto: valorDesconto,
        frete: valorFrete,
        total: Math.max(0, subtotal - valorDesconto) + valorFrete
      };
    }
```

---

## 📊 Resumo das Linhas Alteradas

| Arquivo | Função/Rota | Linhas | Mudança |
|---------|-------------|-------|---------|
| `server.js` | `formatarOpcoesFrete()` | NEW | **Nova função** - Filtra e formata opções |
| `server.js` | `POST /api/frete/calcular` | ~1160 | Usa `formatarOpcoesFrete()` |
| `server.js` | `POST /api/envio/calcular` | ~1230 | Usa `formatarOpcoesFrete()` |
| `checkout.html` | `renderizarOpcoesFrete()` | ~525-560 | Filtra opções no frontend |
| `checkout.html` | `carregarItensCheckout()` | ~465-485 | Lógica de frete grátis melhorada |
| `checkout.html` | `calcularTotaisCheckout()` | ~670-690 | Lógica de frete grátis melhorada |

---

## 🚀 Como Aplicar as Alterações

### Opção 1: Manual (Recomendado para validar)
1. Abrir `server.js`
2. Adicionar função `formatarOpcoesFrete()` antes de `app.post('/api/frete/calcular'...)`
3. Modificar as duas rotas conforme especificado
4. Salvar e testar localmente
5. Abrir `checkout.html`
6. Fazer as 3 modificações no JavaScript
7. Salvar e testar

### Opção 2: Automática (Git)
```bash
git add server.js public/checkout.html
git commit -m "fix: formatação de fretes e regra de frete grátis"
git push origin main
```

---

## ✅ Checklist de Validação

- [ ] Função `formatarOpcoesFrete()` adicionada em `server.js`
- [ ] Rota `/api/frete/calcular` modificada
- [ ] Rota `/api/envio/calcular` modificada
- [ ] Função `renderizarOpcoesFrete()` modificada em `checkout.html`
- [ ] Função `carregarItensCheckout()` modificada
- [ ] Função `calcularTotaisCheckout()` modificada
- [ ] Servidor redeploy no Render
- [ ] Testado com subtotal < R$ 249,00 → frete cobrado ✓
- [ ] Testado com subtotal >= R$ 249,00 → frete grátis ✓
- [ ] Opções "Mini Envios" não aparecem ✓
- [ ] Nomes de transportadoras completos ✓
- [ ] Prazos formatados corretamente ✓
