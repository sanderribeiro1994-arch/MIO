// =====================================================
// MIO STREETWEAR - site-content.js
// Carrega o conteúdo das páginas através da configuração do painel admin.
// =====================================================
(function () {
  'use strict';

  function atualizarTexto(id, valor) {
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = valor != null && String(valor).trim() !== '' ? String(valor) : el.textContent;
  }

  function atualizarImagem(id, valor) {
    if (!id) return;
    const el = document.getElementById(id);
    if (!el || !(el.tagName.toLowerCase() === 'img')) return;
    if (valor != null && String(valor).trim() !== '') {
      el.src = String(valor);
    }
  }

  function atualizarLink(id, valor) {
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (valor != null && String(valor).trim() !== '') {
      el.textContent = String(valor);
      if (el.tagName.toLowerCase() === 'a') {
        el.href = valor.startsWith('mailto:') ? valor : 'mailto:' + valor;
      }
    }
  }

  function carregarConteudo() {
    fetch('/api/config')
      .then(function (res) {
        if (!res.ok) throw new Error('Falha ao carregar o conteúdo do site.');
        return res.json();
      })
      .then(function (config) {
        const paginas = config.paginas || {};
        const sobre = paginas.sobre || {};
        const politicas = paginas.politicas || {};
        const faleConosco = paginas.faleConosco || {};
        const rodape = config.rodape || {};
        const carrossel = config.carrossel || [];
        const bannersGrelha = config.bannersGrelha || [];
        const bannerIntermediario = config.bannerIntermediario || {};

        // Atualizar carrossel
        carrossel.forEach((slide, i) => {
          atualizarImagem('carrossel-img-' + i, slide.imagem);
        });

        // Atualizar banners da grelha
        bannersGrelha.forEach((banner, i) => {
          atualizarImagem('banner-grelha-img-' + i, banner.imagem);
        });

        // Atualizar banner intermediário
        if (bannerIntermediario.imagem) {
          const section = document.getElementById('banner-intermediario');
          if (section) {
            section.style.backgroundImage = 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.7)), url(' + bannerIntermediario.imagem + ')';
          }
        }

        atualizarTexto('sobreTitulo', sobre.titulo);
        atualizarTexto('sobreTexto1', sobre.texto1);
        atualizarTexto('sobreTexto2', sobre.texto2);
        atualizarImagem('sobreImg1', (sobre.imagens || [])[0]);
        atualizarImagem('sobreImg2', (sobre.imagens || [])[1]);
        atualizarImagem('sobreImg3', (sobre.imagens || [])[2]);

        atualizarTexto('politicasTitulo', politicas.titulo);
        atualizarTexto('politicasSec1Titulo', politicas.sec1Titulo);
        atualizarTexto('politicasSec1Texto', politicas.sec1Texto);
        atualizarTexto('politicasSec2Titulo', politicas.sec2Titulo);
        atualizarTexto('politicasSec2Texto', politicas.sec2Texto);
        atualizarTexto('politicasSec3Titulo', politicas.sec3Titulo);
        atualizarTexto('politicasSec3Texto', politicas.sec3Texto);

        atualizarTexto('faleConoscoTitulo', faleConosco.titulo);
        atualizarTexto('faleConoscoTexto', faleConosco.texto);
        atualizarLink('faleConoscoEmailAtendimento', faleConosco.emailAtendimento);
        atualizarLink('faleConoscoEmailParcerias', faleConosco.emailParcerias);
        atualizarLink('faleConoscoEmailCarreiras', faleConosco.emailCarreiras);

        atualizarTexto('rodapeSlogan', rodape.slogan);
        atualizarTexto('rodapeDireitos', rodape.direitos);
        if (rodape.politicasTexto) {
          const el = document.getElementById('rodapePoliticasLink');
          if (el) el.textContent = rodape.politicasTexto;
        }
        if (rodape.privacidadeTexto) {
          const el = document.getElementById('rodapePrivacidadeLink');
          if (el) el.textContent = rodape.privacidadeTexto;
        }
      })
      .catch(function (err) {
        console.warn(err.message || err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', carregarConteudo);
  } else {
    carregarConteudo();
  }
})();
