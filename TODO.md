# TODO - Correções de Segurança e Funcionais

## Fase 1 - Segurança (server.js) - ✅ Já implementado no backend
- [x] 1. Trocar SHA-256 por bcrypt (admin + clientes) com migração automática
- [x] 2. Adicionar rate limiting de login (helmet + express-rate-limit)
- [x] 3. Validar total do pedido no servidor (recalcular a partir dos itens)
- [x] 4. Criar endpoint /api/cupons/validar (validação no servidor)
- [x] 5. Adicionar redirect HTTPS em produção + headers de segurança

## Fase 1 - Clientes (frontend)
- [ ] 6. Remover credenciais admin hardcoded e fallback inseguro (login.html)
- [x] 7. Validar token via /api/admin/verificar ao restaurar sessão (admin.html)
- [ ] 8. Remover cartões em texto puro e senha em texto puro (perfil.html)
- [ ] 9. Mover avaliações para aprovação no servidor (produto.html)

## Fase 2 - Funcionais
- [ ] 10. Acompanhar pedido busca pedidos reais por e-mail no backend
- [ ] 11. Padronizar cupom {codigo, tipo, valor} e validar via /api/cupons/validar
- [ ] 12. Corrigir busca do sobre.html para produto.html
- [ ] 13. Aplicar logo no checkout.html

## Mobile
- [ ] 14. Garantir responsividade mobile em todas as páginas corrigidas

## Testes
- [ ] 15. Testar login admin, login cliente, checkout, cupom, frete
