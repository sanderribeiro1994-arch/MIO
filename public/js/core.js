// =====================================================
// MIO STREETWEAR - core.js
// Funções compartilhadas por todas as páginas do site.
// Sacola, cupons, sessão de usuário, frete e utilitários.
// =====================================================

(function (window) {
  'use strict';

  const FRETE_GRATIS_META = 249.00;
  const CHAVE_SACOLA = 'mio_sacola_itens';
  const CHAVE_CUPOM = 'mio_cupom_ativo';
  const CHAVE_USUARIO = 'mio_usuario_logado';
  const CHAVE_TOKEN = 'mio_usuario_token';

  // ---------- UTILITÁRIOS DE ESTADO ----------
  function obterSacola() {
    try { return JSON.parse(localStorage.getItem(CHAVE_SACOLA)) || []; }
    catch (e) { return []; }
  }

  function salvarSacola(itens) {
    localStorage.setItem(CHAVE_SACOLA, JSON.stringify(itens));
  }

  function obterCupom() {
    try { return JSON.parse(localStorage.getItem(CHAVE_CUPOM)); }
    catch (e) { return null; }
  }

  function obterUsuario() {
    try { return JSON.parse(localStorage.getItem(CHAVE_USUARIO)); }
    catch (e) { return null; }
  }

  function obterToken() {
    return localStorage.getItem(CHAVE_TOKEN);
  }

  // ---------- FORMATAÇÃO DE MOEDA ----------
  function formatarMoeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // ---------- CÁLCULO DE SUBTOTAL ----------
  function calcularSubtotal(itens) {
    return (itens || []).reduce((acc, i) => acc + (Number(i.preco) * Number(i.quantidade || 1)), 0);
  }

  // ---------- CONTADOR DO HEADER (SACOLA) ----------
  function atualizarContadorHeader() {
    const itens = obterSacola();
    const totalItens = itens.reduce((acc, i) => acc + (i.quantidade || 1), 0);
    document.querySelectorAll('.contador-sacola, #contador-sacola-header').forEach(el => {
      el.innerText = totalItens;
    });
  }

  // ---------- SCROLL DO MENU (fecha ao clicar fora) ----------
  function fecharMenuAoClicarFora(event) {
    const drawer = document.getElementById('sideMenuDrawer');
    if (drawer && !drawer.contains(event.target)) {
      const menu = document.getElementById('sideMenu');
      if (menu && !menu.classList.contains('opacity-0')) {
        menu.classList.add('opacity-0', 'pointer-events-none');
        drawer.classList.add('-translate-x-full');
      }
    }
  }

  // ---------- SESSÃO DE USUÁRIO (header dinâmico) ----------
  function verificarSessaoUsuario() {
    const usuario = obterUsuario();
    const token = obterToken();
    const btnHeader = document.getElementById('btnMembroHeader');
    const btnMenu = document.getElementById('linkMenuMembro');

    if (usuario && token && btnMenu) {
      btnMenu.href = 'perfil.html';
      btnMenu.removeAttribute('onclick');
      btnMenu.setAttribute('style', 'background-color:#fbbf24 !important;color:#000 !important;font-weight:900 !important;');
      btnMenu.innerHTML = '<i data-lucide="user" class="w-5 h-5" style="color:#000"></i> MEU PERFIL';
      if (btnHeader) {
        btnHeader.setAttribute('onclick', "window.location.href='perfil.html'");
        btnHeader.title = 'Meu Perfil';
        btnHeader.innerHTML = usuario.foto
          ? '<img src="' + usuario.foto + '" class="w-7 h-7 rounded-full object-cover border-2 border-amber-400">'
          : '<i data-lucide="user" class="w-6 h-6 text-amber-400"></i>';
      }
    } else if (btnMenu) {
      btnMenu.setAttribute('style', 'background-color:#fff !important;color:#000 !important;');
    }
    if (window.lucide) lucide.createIcons();
  }

  // ---------- EXPOR PARA O WINDOW ----------
  window.MIO = {
    FRETE_GRATIS_META,
    obterSacola,
    salvarSacola,
    obterCupom,
    obterUsuario,
    obterToken,
    formatarMoeda,
    calcularSubtotal,
    atualizarContadorHeader,
    verificarSessaoUsuario,
    fecharMenuAoClicarFora
  };

  // Auto-init leve: contador da sacola em qualquer página
  document.addEventListener('DOMContentLoaded', () => {
    window.MIO.atualizarContadorHeader();
    window.MIO.verificarSessaoUsuario();
  });

})(window);
