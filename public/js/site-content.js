// =====================================================
// MIO STREETWEAR - site-content.js
// Carrega o conteúdo das páginas através da configuração do painel admin.
// =====================================================
(function () {
  'use strict';

  const estadosApi = { config: false, produtos: false };
  window.mioMarkApiReady = function (tipo, sucesso) {
    estadosApi[tipo] = Boolean(sucesso);
    if (estadosApi.config && estadosApi.produtos) {
      document.body.classList.add('mio-api-ready');
    }
  };

  function atualizarTexto(id, valor) {
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = valor != null ? String(valor) : '';
  }

  function atualizarImagem(id, valor) {
    if (!id) return;
    const el = document.getElementById(id);
    if (!el || !(el.tagName.toLowerCase() === 'img')) return;
    el.removeAttribute('src');
    if (valor != null && String(valor).trim() !== '') el.src = String(valor);
  }

  function atualizarImagemResponsiva(id, desktop, mobile) {
    const imagem = document.getElementById(id);
    if (!imagem || imagem.tagName.toLowerCase() !== 'img') return;
    imagem.removeAttribute('src');
    if (desktop != null && String(desktop).trim() !== '') imagem.src = String(desktop);
    const fonteMobile = document.getElementById(id + '-mobile');
    if (fonteMobile) fonteMobile.removeAttribute('srcset');
    if (fonteMobile && mobile != null && String(mobile).trim() !== '') fonteMobile.srcset = String(mobile);
  }

  function atualizarLink(id, valor) {
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = valor != null ? String(valor) : '';
    if (el.tagName.toLowerCase() === 'a') {
      el.removeAttribute('href');
      if (valor != null && String(valor).trim() !== '') el.href = valor.startsWith('mailto:') ? valor : 'mailto:' + valor;
    }
  }

  function atualizarHref(id, valor) {
    const el = document.getElementById(id);
    if (!el) return;
    el.removeAttribute('href');
    if (valor != null && String(valor).trim() !== '') el.href = String(valor);
  }

  function carregarConteudo() {
    fetch('/api/config')
      .then(function (res) {
        if (!res.ok) throw new Error('Falha ao carregar o conteúdo do site.');
        return res.json();
      })
      .then(function (config) {
        window.mioMarkApiReady && window.mioMarkApiReady('config', true);
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
          atualizarImagemResponsiva('carrossel-img-' + i, slide.imagem, slide.imagemMobile);
          atualizarTexto('carrossel-etiqueta-' + i, slide.etiqueta);
          atualizarTexto('carrossel-titulo-' + i, slide.titulo);
          atualizarTexto('carrossel-texto-' + i, slide.texto);
          atualizarTexto('carrossel-botao-' + i, slide.botao);
          atualizarHref('carrossel-botao-' + i, slide.link);
        });

        // Atualizar banners da grelha
        bannersGrelha.forEach((banner, i) => {
          atualizarImagemResponsiva('banner-grelha-img-' + i, banner.imagem, banner.imagemMobile);
          atualizarTexto('banner-grelha-etiqueta-' + i, banner.etiqueta);
          atualizarTexto('banner-grelha-titulo-' + i, banner.titulo);
          atualizarTexto('banner-grelha-texto-' + i, banner.texto);
          atualizarTexto('banner-grelha-botao-' + i, banner.botao);
          atualizarHref('banner-grelha-link-' + i, banner.link);
        });

        // Atualizar banner intermediário
        atualizarImagemResponsiva('banner-intermediario-img', bannerIntermediario.imagem, bannerIntermediario.imagemMobile);
        if (bannerIntermediario.imagem) {
          const section = document.getElementById('banner-intermediario');
          if (section) {
            section.style.backgroundImage = 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.7)), url(' + bannerIntermediario.imagem + ')';
          }
        }
        atualizarTexto('banner-intermediario-titulo', bannerIntermediario.titulo);
        atualizarTexto('banner-intermediario-texto', bannerIntermediario.texto);
        atualizarTexto('banner-intermediario-botao', bannerIntermediario.botao);
        atualizarHref('banner-intermediario-botao', bannerIntermediario.link);

        const redes = config.redesSociais || {};
        atualizarHref('rodapeInstagram', redes.instagram);
        atualizarHref('rodapeTiktok', redes.tiktok);

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
        window.mioMarkApiReady && window.mioMarkApiReady('config', false);
        console.warn(err.message || err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', carregarConteudo);
  } else {
    carregarConteudo();
  }
})();
