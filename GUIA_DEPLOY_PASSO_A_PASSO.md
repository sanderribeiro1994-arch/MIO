# 🎬 GUIA DE DEPLOY - PASSO A PASSO

**Duração:** ~15 minutos  
**Risco:** Baixo (mudanças testadas sintaticamente)  
**Rollback:** Git revert simples

---

## ⚠️ ANTES DE COMEÇAR

- [ ] Ter acesso ao repositório Git
- [ ] Ter acesso ao painel do Render
- [ ] Ter navegador com DevTools
- [ ] Ter ~15 minutos disponíveis

---

## FASE 1: VALIDAÇÃO LOCAL (5 min)

### Passo 1.1: Iniciar Servidor
```bash
cd c:\Users\sande\Documents\site\ mio
node server.js
```

**Resultado esperado:**
```
🚀 Servidor rodando em http://localhost:3000
```

### Passo 1.2: Abrir Navegador
```
Acesso: http://localhost:3000
```

### Passo 1.3: Fazer Checkout com Subtotal < R$ 249

**Cenário Teste 1:**
1. Adicione 1 item de R$ 99,90 ao carrinho
2. Vá para Checkout
3. Preencha endereço com CEP válido (ex: 01310100)
4. Clique em "Calcular Frete"

**Verificar:**
- [ ] Nenhuma opção "Mini Envios" aparece
- [ ] Nenhuma opção com preço R$ 0,00
- [ ] Ao selecionar um frete (ex: R$ 14,90)
- [ ] Resumo mostra:
  - Subtotal: R$ 99,90
  - Frete: R$ 14,90 ← **NÃO deve ser "GRÁTIS"**
  - Total: R$ 114,80

**Se viu "GRÁTIS" aqui:** ❌ Problema! Volte e revise o código.

### Passo 1.4: Fazer Checkout com Subtotal >= R$ 249

**Cenário Teste 2:**
1. Limpe carrinho (localStorage)
2. Adicione 5 itens de R$ 50,00 cada (total R$ 250,00)
3. Vá para Checkout
4. Mesmo endereço anterior
5. Clique em "Calcular Frete"

**Verificar:**
- [ ] Ao selecionar qualquer frete
- [ ] Resumo mostra:
  - Subtotal: R$ 250,00
  - Frete: GRÁTIS ← **Deve ser "GRÁTIS"**
  - Total: R$ 250,00

**Se viu preço aqui:** ❌ Problema! Volte e revise o código.

### Passo 1.5: Abrir Console (F12)

```javascript
// Digite no console:
console.log('Variável META_FRETE_GRATIS:', META_FRETE_GRATIS);
console.log('Opções de frete:', opcoesFrete);
console.log('Frete cotado:', freteCotado);
```

**Verificar:**
- [ ] `META_FRETE_GRATIS` = 249
- [ ] `opcoesFrete` não contém Mini Envios
- [ ] `freteCotado` tem estrutura {valor, prazo, ...}

---

## FASE 2: COMMIT & PUSH (3 min)

### Passo 2.1: Parar Servidor
```bash
Ctrl+C (no terminal)
```

### Passo 2.2: Verificar Status Git
```bash
git status
```

**Resultado esperado:**
```
Modified: server.js
Modified: public/checkout.html
```

### Passo 2.3: Adicionar Mudanças
```bash
git add server.js public/checkout.html
```

### Passo 2.4: Commitar
```bash
git commit -m "fix: formatação de fretes e regra de frete grátis >= R$ 249"
```

### Passo 2.5: Fazer Push
```bash
git push origin main
```

**Resultado esperado:**
```
✓ main → origin/main
```

---

## FASE 3: DEPLOY NO RENDER (3 min)

### Passo 3.1: Acessar Painel Render
```
URL: https://dashboard.render.com
Login: seu email/senha
```

### Passo 3.2: Encontrar o Serviço
```
Dashboard → Seu Serviço → (selecionar "site-mio" ou similar)
```

### Passo 3.3: Verificar Deploy Automático
```
Events → Deve exibir novo deploy iniciado
Status → "Building" → "Deployed" ✅
```

**Tempo esperado:** 2-3 minutos

### Passo 3.4: Aguardar Status "Live"
```
Se ficar vermelho (erro):
→ Clicar "Manual Deploy" novamente
→ Ou verificar logs em "Logs"
```

### Passo 3.5: Copiar URL da Aplicação
```
Ex: https://seu-site.render.app
(anotará para o próximo passo)
```

---

## FASE 4: VALIDAÇÃO EM PRODUÇÃO (4 min)

### Passo 4.1: Acessar Site em Produção
```
URL: https://seu-site.render.app
```

### Passo 4.2: Forçar Atualização (IMPORTANTE!)
```
Ctrl+Shift+Delete (abre limpeza de cache)
OU
Ctrl+F5 (hardrefresh)
```

**Sem fazer isso, ainda verá código antigo em cache!**

### Passo 4.3: Repetir Teste 1 (Subtotal < 249)
```
1. Carrinho com R$ 99,90
2. Checkout
3. Frete calculado
4. Verificar: Frete = R$ 14,90 (não "GRÁTIS")
```

**✅ Se passou:** Ótimo!

### Passo 4.4: Repetir Teste 2 (Subtotal >= 249)
```
1. Carrinho com R$ 250,00
2. Checkout
3. Frete calculado
4. Verificar: Frete = "GRÁTIS"
```

**✅ Se passou:** Perfeito!

### Passo 4.5: Verificar Formatação de Opções
```
Na lista de fretes, verificar:
✅ Sem "Mini Envios"
✅ Sem preço R$ 0,00
✅ Nomes como "Jadlog .COM" (completo)
✅ Prazos como "5 dias úteis" (não "dia(s)")
```

### Passo 4.6: Abrir Console (F12) em Produção
```javascript
console.log('opcoesFrete:', opcoesFrete);
```

**Verificar:** Sem Mini Envios, sem preço 0

---

## ✅ CHECKLIST PÓS-DEPLOY

- [ ] Teste 1 passou (subtotal < 249 cobra frete)
- [ ] Teste 2 passou (subtotal >= 249 grátis)
- [ ] Nenhuma opção "Mini Envios" visível
- [ ] Nenhuma opção com preço R$ 0,00
- [ ] Nomes de transportadoras completos
- [ ] Prazos com singular/plural correto
- [ ] Console sem erros (F12)
- [ ] Página carrega rápido
- [ ] Checkout funciona até final

**Se tudo passou:** ✅ **DEPLOY BEM-SUCEDIDO!**

---

## 🆘 TROUBLESHOOTING

### Problema: "GRÁTIS" aparece para subtotal < 249

**Solução rápida:**
```bash
# 1. Parar servidor
Ctrl+C

# 2. Verificar checkout.html
# Buscar: carregarItensCheckout()
# Verificar: temDireitoAFreteGratis = subtotal >= 249

# 3. Se estiver errado, corrigir e salvar

# 4. Reiniciar
node server.js
```

**Se em produção:**
```bash
# 1. Fazer rollback
git revert HEAD

# 2. Push
git push

# 3. Render fará redeploy automaticamente
```

### Problema: "Mini Envios" ainda aparece

**Verificar:**
1. Abrir server.js
2. Buscar: `formatarOpcoesFrete`
3. Verificar se função existe
4. Verificar se `/api/frete/calcular` usa a função
5. Verificar se `/api/envio/calcular` usa a função

Se tudo está lá:
```bash
# Limpar cache e redeploy
git push
# Esperar 3 minutos
# Ctrl+F5 no navegador
```

### Problema: Deploy falhou no Render

**Ver logs:**
1. Painel Render → Seu Serviço
2. Clicar em "Logs"
3. Procurar por "error" ou "Error"

**Causas comuns:**
- Sintaxe JavaScript errada → Revisar código
- Arquivo não encontrado → Verificar caminho
- Variável indefinida → Verificar nomes

**Se não conseguir resolver:**
```bash
# Fazer rollback simples
git revert HEAD
git push
# Render redeployará versão anterior automaticamente
```

---

## 📊 PROGRESSO DO DEPLOY

```
FASE 1: Validação Local
├─ Iniciar servidor ........... 1 min
├─ Teste subtotal < 249 ....... 2 min
├─ Teste subtotal >= 249 ...... 1 min
├─ Verificar console .......... 1 min
└─ Total ...................... 5 min ✅

FASE 2: Commit & Push
├─ Git status ................. < 1 min
├─ Git add .................... < 1 min
├─ Git commit ................. < 1 min
├─ Git push ................... 1 min
└─ Total ...................... 3 min ✅

FASE 3: Deploy Render
├─ Acessar painel ............. < 1 min
├─ Verificar auto-deploy ...... 2 min (aguardar)
├─ Copiar URL ................. < 1 min
└─ Total ...................... 3 min ✅

FASE 4: Validação Produção
├─ Acessar site ............... < 1 min
├─ Limpar cache ............... < 1 min
├─ Teste 1 (< 249) ............ 1 min
├─ Teste 2 (>= 249) ........... 1 min
├─ Verificar formatação ....... 1 min
└─ Total ...................... 4 min ✅

TEMPO TOTAL: ~15 minutos ⏱️
```

---

## ✨ APÓS DEPLOY CONFIRMADO

### Documentar Sucesso
```bash
# Criar commit de validação (opcional)
git commit --allow-empty -m "docs: validação de deploy bem-sucedida"
git push
```

### Notificar Equipe
```
✅ Deploy realizado com sucesso
✅ Regra de frete grátis >= R$ 249,00 ativada
✅ Opções de frete filtradas e formatadas
✅ Todos os testes passaram
```

### Monitorar Próximas Horas
- Verificar logs do Render (erros?)
- Testar alguns checkouts reais
- Monitorar taxa de erros

---

## 🎯 REFERÊNCIA RÁPIDA

| Etapa | Comando |
|-------|---------|
| Validar Local | `node server.js` |
| Testar Local | `http://localhost:3000` |
| Commit | `git commit -m "..."` |
| Push | `git push origin main` |
| Ver Deploy | `https://dashboard.render.com` |
| Acessar Prod | `https://seu-site.render.app` |

---

## 📞 SUPORTE

**Se algo não funcionar após deploy:**

1. Consulte: `GUIA_TESTES_FRETE.md` (testes detalhados)
2. Consulte: `MUDANCAS_EXATAS_ANTES_DEPOIS.md` (código)
3. Consulte: `DIAGRAMA_VISUAL_FLUXO.md` (fluxo)
4. Tente rollback simples: `git revert HEAD && git push`

---

**Pronto? Comece pela FASE 1! 🚀**
