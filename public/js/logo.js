// =====================================================
// MIO STREETWEAR - logo.js
// Substitui o texto "MIO" pela imagem da logo definida
// no painel administrativo (Configurações -> Redes & Logo).
// Qualquer elemento com a classe .mio-logo é transformado
// em uma <img> com a logo. Se não houver logo, mantém o texto.
// Use data-logo-h para definir a altura (ex: data-logo-h="32").
// =====================================================
(function () {
  'use strict';

  var LOGO_CONFIG_KEY = 'mio_logo_cache';

  function atualizarIndicadorAdmin() {
    var btnHeader = document.getElementById('btnMembroHeader');
    if (!btnHeader) return;

    fetch('/api/admin/verificar', { credentials: 'include' })
      .then(function (res) {
        btnHeader.style.color = res.ok ? '#fbbf24' : '#ffffff';
        btnHeader.title = res.ok ? 'Administrador conectado' : 'Área de Membros';
      })
      .catch(function () {
        btnHeader.style.color = '#ffffff';
        btnHeader.title = 'Área de Membros';
      });
  }

  function aplicarLogo(cfg) {
    var logo = (cfg && cfg.logo) || {};
    var colecoes = document.querySelectorAll('.mio-logo');
    if (!colecoes.length) return;

    colecoes.forEach(function (el) {
      var altura = el.getAttribute('data-logo-h') || '52';
      var usarImagem = logo.url && logo.url.trim() && logo.url !== '#' && logo.url !== '';

      if (usarImagem) {
        var img = document.createElement('img');
        img.src = logo.url;
        img.alt = logo.texto || 'MIO';
        img.className = 'h-auto object-contain';
        img.style.height = altura + 'px';
        img.style.maxWidth = '100%';
        // Preserva o comportamento de link (se o elemento for um <a>)
        if (el.tagName.toLowerCase() === 'a') {
          el.innerHTML = '';
          el.appendChild(img);
          el.classList.remove('text-2xl', 'font-black', 'tracking-widest', 'text-white', 'text-xl', 'text-3xl');
        } else {
          el.innerHTML = '';
          el.appendChild(img);
          el.classList.remove('text-2xl', 'font-black', 'tracking-widest', 'text-white', 'text-xl', 'text-3xl');
        }
      } else {
        // Sem logo: mantém o texto padrão (fallback)
        if (!el.dataset.logoOriginal) {
          el.dataset.logoOriginal = el.textContent;
        }
        el.textContent = el.dataset.logoOriginal || logo.texto || 'MIO';
      }
    });
  }

  function carregarConfig() {
    fetch('/api/config')
      .then(function (res) {
        if (!res.ok) throw new Error('Falha ao buscar configurações');
        return res.json();
      })
      .then(function (cfg) {
        try { localStorage.setItem(LOGO_CONFIG_KEY, JSON.stringify(cfg)); } catch (e) {}
        aplicarLogo(cfg);
      })
      .catch(function () {
        // Fallback: usa cache local (config já carregada) ou mantém o texto
        try {
          var cache = JSON.parse(localStorage.getItem(LOGO_CONFIG_KEY));
          if (cache) aplicarLogo(cache);
        } catch (e) {}
      });
  }

  function inicializarIndicadorAdmin() {
    atualizarIndicadorAdmin();
    window.addEventListener('storage', atualizarIndicadorAdmin);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      carregarConfig();
      inicializarIndicadorAdmin();
    });
  } else {
    carregarConfig();
    inicializarIndicadorAdmin();
  }
})();
