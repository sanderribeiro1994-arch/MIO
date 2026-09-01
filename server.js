import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { supabase, supabaseAdmin } from './supabase.js';

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURAÇÕES ---
app.use(helmet({ contentSecurityPolicy: false })); // headers de segurança
app.use(express.json({ limit: '25mb' })); // limite maior p/ fotos base64
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rota explícita para favicon com cache headers
app.get('/favicon.png', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(path.join(__dirname, 'public', 'favicon.png'), (err) => {
    if (err) res.status(404).send('Favicon não encontrado');
  });
});

// --- REDIRECT HTTPS em produção ---
if (IS_PROD) {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'];
    if (proto && proto !== 'https') {
      return res.redirect(301, 'https://' + req.headers.host + req.url);
    }
    next();
  });
}

// --- SESSÕES ADMIN PERSISTENTES NO SUPABASE ---
const ADMIN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias para manter o admin logado

// --- RATE LIMITING ---
// Limita tentativas de login (admin e cliente) para evitar força bruta.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // 10 tentativas por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.' }
});

// Limite geral de requisições à API
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde um momento.' }
});

// --- CSRF Protection simples (token de sessão por header) ---
// Para rotas mutáveis protegidas por exigirAdmin, validamos o token admin.
// Para rotas públicas de cadastro/checkout, usamos reCAPTCHA-style rate limit.

async function salvarSessaoAdmin(token, email, expiraEm) {
  if (!token || !email) return;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { error } = await supabaseAdmin.from('admin_sessoes').upsert({
    token_hash: tokenHash,
    email,
    expira_em: new Date(expiraEm).toISOString()
  }, { onConflict: 'token_hash' });
  if (error) throw error;
}

async function carregarSessaoAdmin(token) {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data: row, error } = await supabaseAdmin
    .from('admin_sessoes')
    .select('email, expira_em')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw error;
  const sessao = row ? { email: row.email, expiraEm: Date.parse(row.expira_em) } : null;
  if (!sessao) return null;
  if (sessao.expiraEm < Date.now()) {
    await limparSessaoAdmin(token);
    return null;
  }
  return sessao;
}

async function limparSessaoAdmin(token) {
  if (!token) return;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { error } = await supabaseAdmin.from('admin_sessoes').delete().eq('token_hash', tokenHash);
  if (error) throw error;
}

function getClientToken(req) {
  const headerToken = req.headers['x-client-token'];
  if (headerToken && headerToken !== 'null' && headerToken !== 'undefined') return String(headerToken);
  const match = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('client_token='));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

async function salvarSessaoCliente(token, email, expiraEm) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { error } = await supabaseAdmin.from('cliente_sessoes').upsert({ token_hash: tokenHash, email, expira_em: new Date(expiraEm).toISOString() }, { onConflict: 'token_hash' });
  if (error) throw error;
}

async function carregarSessaoCliente(token) {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data, error } = await supabaseAdmin.from('cliente_sessoes').select('email, expira_em').eq('token_hash', tokenHash).maybeSingle();
  if (error) throw error;
  if (!data || Date.parse(data.expira_em) < Date.now()) return null;
  return { email: data.email, expiraEm: Date.parse(data.expira_em) };
}

async function exigirCliente(req, res, next) {
  const token = getClientToken(req);
  const sessao = await carregarSessaoCliente(token);
  if (!sessao) {
    return res.status(401).json({ error: "Não autenticado. Faça login." });
  }
  sessao.expiraEm = Date.now() + 15 * 60 * 1000;
  await salvarSessaoCliente(token, sessao.email, sessao.expiraEm);
  req.clienteEmail = sessao.email;
  next();
}

// Helper: hash de senha (bcrypt — seguro e com salt aleatório embutido)
async function hashSenha(senha) {
  return bcrypt.hash(String(senha), 10);
}

async function compararSenha(senha, hash) {
  if (!hash) return false;
  // Suporta ambos: hashes bcrypt e hashes SHA-256 legados (migração)
  if (typeof hash === 'string' && hash.length === 64 && /^[a-f0-9]{64}$/.test(hash)) {
    const legacy = crypto.createHash('sha256').update('MIO_SALT_' + senha).digest('hex');
    return legacy === hash;
  }
  return bcrypt.compare(String(senha), hash);
}

// --- CREDENCIAL ADMIN PADRÃO (mude depois do primeiro login) ---
const ADMIN_PADRAO = {
  email: 'admin@miostreetwear.com.br',
  senhaHash: null // será preenchido com bcrypt ao inicializar
};

// --- INICIALIZAÇÃO DO BANCO DE DADOS ---
const dbReady = inicializarSupabase();

async function inicializarSupabase() {
  const admin = await buscarAdmin();
  if (!admin) {
    const senhaHash = await hashSenha('admin123');
    const { error } = await supabaseAdmin.from('admin_conta').insert({
      id: 1, email: ADMIN_PADRAO.email, senha_hash: senhaHash, nome: '', foto: '', endereco: {}, cnpj: ''
    });
    if (error) throw error;
  }
  await garantirBannersNoSupabase();
}

// ---------- MIDDLEWARE DE AUTENTICAÇÃO ADMIN ----------
function getAdminTokenFromRequest(req) {
  const headerToken = req.headers['x-admin-token'];
  if (headerToken) return String(headerToken);

  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.split(';').map(v => v.trim()).find(v => v.startsWith('admin_token='));
  if (!match) return null;

  const value = decodeURIComponent(match.split('=').slice(1).join('='));
  return value || null;
}

async function exigirAdmin(req, res, next) {
  const token = getAdminTokenFromRequest(req);
  const sessao = await carregarSessaoAdmin(token);
  if (!sessao) {
    return res.status(401).json({ error: "Não autenticado. Faça login no painel." });
  }
  if (sessao.expiraEm < Date.now()) {
    await limparSessaoAdmin(token);
    return res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
  }
  sessao.expiraEm = Date.now() + ADMIN_SESSION_TTL_MS;
  await salvarSessaoAdmin(token, sessao.email, sessao.expiraEm);
  next();
}

// ---------- FUNÇÕES AUXILIARES ----------
function parseJsonArray(str, fallback) {
  if (Array.isArray(str)) return str;
  try { return str ? JSON.parse(str) : fallback; } catch (e) { return fallback; }
}

function formatarProduto(produto) {
  return {
    ...produto,
    fotos: parseJsonArray(produto.fotos, produto.imagem ? [produto.imagem] : []),
    cores: parseJsonArray(produto.cores, []),
    tamanhos: parseJsonArray(produto.tamanhos, [])
  };
}

function validarUrlImagem(valor) {
  if (valor == null || String(valor).trim() === '') return '';
  const url = String(valor).trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('As imagens precisam ser URLs http(s) hospedadas remotamente.');
  }
  return url;
}

function prepararProduto(produto) {
  const imagem = validarUrlImagem(produto.imagem);
  const fotos = parseJsonArray(produto.fotos, imagem ? [imagem] : [])
    .map(validarUrlImagem)
    .filter(Boolean);
  return { ...produto, imagem, fotos };
}

function extrairListaProdutosBling(payload) {
  if (Array.isArray(payload)) return payload;
  const chaves = ['data', 'produtos', 'result', 'itens', 'produto'];
  for (const chave of chaves) {
    const valor = payload?.[chave];
    if (Array.isArray(valor)) return valor;
  }
  if (payload && typeof payload === 'object') {
    const objeto = payload.data || payload.result || payload.produtos || payload.itens || payload.produto;
    if (objeto && typeof objeto === 'object') {
      const nested = objeto.data || objeto.produtos || objeto.result || objeto.itens || objeto.produto;
      if (Array.isArray(nested)) return nested;
    }
  }
  return [];
}

function mapearProdutoParaBling(produto = {}) {
  const preco = Number(produto.preco ?? 0);
  const precoOriginal = Number(produto.precoOriginal ?? produto.preco ?? 0);
  return {
    codigo: String(produto.codigo || produto.bling_id || produto.id || `site-${Date.now()}`),
    nome: String(produto.nome || 'Produto sem nome'),
    descricao: String(produto.descricao || ''),
    tipo: 'P',
    situacao: 'Ativo',
    preco,
    preco_custo: precoOriginal || preco,
    categoria: produto.categoria || '',
    genero: produto.genero || '',
    imagem: produto.imagem || ''
  };
}

function mapearProdutoBlingParaSite(item = {}) {
  const produto = item.produto || item;
  const nome = produto.nome || produto.descricao || 'Produto importado';
  const preco = Number(produto.preco ?? produto.precoVenda ?? produto.valor ?? 0);
  const precoOriginal = Number(produto.precoOriginal ?? produto.precoVenda ?? produto.preco ?? preco);
  return {
    nome,
    preco,
    precoOriginal: precoOriginal > 0 ? precoOriginal : null,
    estaEmPromocao: Boolean(produto.estaEmPromocao || produto.emPromocao || false),
    textoDestaquePromo: produto.textoDestaquePromo || '',
    cronometro: produto.cronometro || null,
    categoria: produto.categoria || produto.categoriaProduto || '',
    genero: produto.genero || '',
    imagem: produto.imagem || produto.foto || produto.fotos?.[0] || '',
    fotos: Array.isArray(produto.fotos) ? produto.fotos : (produto.imagem ? [produto.imagem] : []),
    cores: Array.isArray(produto.cores) ? produto.cores : [],
    tamanhos: Array.isArray(produto.tamanhos) ? produto.tamanhos : [],
    descricao: produto.descricao || produto.observacoes || '',
    estoque: Number(produto.estoque ?? produto.estoqueAtual ?? 0),
    relevancia: Number(produto.relevancia ?? 0),
    data: produto.data || new Date().toISOString().slice(0, 10),
    bling_id: String(produto.id || produto.codigo || '') || null,
    codigo: produto.codigo || null
  };
}

async function enviarProdutoParaBling(produto) {
  const oauth = await getBlingOauthConfig();
  if (!oauth.accessToken) {
    return { ok: false, motivo: 'Token do Bling ausente. Faça login via OAuth primeiro.' };
  }

  const payloadBase = mapearProdutoParaBling(produto);
  const payloads = [
    { produto: payloadBase },
    payloadBase
  ];

  const endpoints = [
    `${BLING_API_BASE}/produto`,
    `${BLING_API_BASE}/produtos`
  ];

  for (const endpoint of endpoints) {
    for (const body of payloads) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${oauth.accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        const raw = await res.text();
        let data = {};
        try { data = JSON.parse(raw); } catch { data = { raw }; }

        if (!res.ok) {
          const mensagem = data?.message || data?.error || data?.errors || raw || `Falha ao enviar produto para o Bling em ${endpoint}`;
          if (res.status === 401 || res.status === 403) {
            return { ok: false, motivo: 'Credenciais do Bling inválidas ou expiradas.' };
          }
          if (res.status === 404) continue;
          return { ok: false, motivo: mensagem };
        }

        const blingId = data?.id || data?.data?.id || data?.produto?.id || data?.produtoId || data?.result?.id || null;
        return { ok: true, data, blingId };
      } catch (err) {
        continue;
      }
    }
  }

  return { ok: false, motivo: 'Não foi possível enviar o produto ao Bling com o formato atual da API.' };
}

async function consultarProdutosBling() {
  const oauth = await getBlingOauthConfig();
  if (!oauth.accessToken) {
    return { ok: false, error: 'Token do Bling ausente. Faça login via OAuth primeiro.' };
  }

  const endpoints = [
    `${BLING_API_BASE}/produtos?pagina=1&limite=100`,
    `${BLING_API_BASE}/produtos`,
    `${BLING_API_BASE}/produto?pagina=1&limite=100`,
    `${BLING_API_BASE}/produto`
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${oauth.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      });

      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch { data = { raw }; }

      if (!res.ok) {
        const mensagem = data?.message || data?.error || raw || `Erro ao buscar produtos do Bling em ${endpoint}`;
        if (res.status === 401 || res.status === 403) {
          return { ok: false, error: 'Credenciais do Bling inválidas ou expiradas.' };
        }
        continue;
      }

      const lista = extrairListaProdutosBling(data);
      if (lista.length > 0 || Object.keys(data || {}).length > 0) {
        return { ok: true, data: lista.length > 0 ? lista : data };
      }
    } catch (err) {
      continue;
    }
  }

  return { ok: false, error: 'Nenhum produto foi retornado pelo Bling ou a API não respondeu com a estrutura esperada.' };
}

function formatarPedido(pedido) {
  return {
    ...pedido,
    cliente: parseJsonArray(pedido.cliente, {}),
    endereco: parseJsonArray(pedido.endereco, {}),
    itens: parseJsonArray(pedido.itens, []),
    cupom: parseJsonArray(pedido.cupom, null)
  };
}

function formatarCliente(cliente) {
  if (!cliente) return null;
  const { senha, ...semSenha } = cliente;
  semSenha.endereco = parseJsonArray(semSenha.endereco, {});
  return semSenha;
}

async function buscarPedidoPorNumero(numero) {
  const { data, error } = await supabaseAdmin.from('pedidos').select('*').eq('numero', numero).maybeSingle();
  if (error) throw error;
  return data;
}

async function buscarPedidoPorId(id) {
  const { data, error } = await supabaseAdmin.from('pedidos').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function atualizarPedidoPorNumero(numero, campos) {
  const { data, error } = await supabaseAdmin.from('pedidos').update(campos).eq('numero', numero).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

async function buscarClientePorEmail(email) {
  const { data, error } = await supabaseAdmin.from('clientes').select('*').eq('email', email).maybeSingle();
  if (error) throw error;
  return data;
}

async function incrementarUsoCupom(codigo) {
  if (!codigo) return;
  const { data: cupom, error: buscarError } = await supabaseAdmin.from('cupons').select('usos').eq('codigo', codigo).maybeSingle();
  if (buscarError || !cupom) return;
  const { error } = await supabaseAdmin.from('cupons').update({ usos: Number(cupom.usos || 0) + 1 }).eq('codigo', codigo);
  if (error) throw error;
}

async function buscarAdmin() {
  const { data, error } = await supabaseAdmin.from('admin_conta').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data;
}

function formatarBanner(banner) {
  const { id, tipo, ordem, ...conteudo } = banner;
  return { ...conteudo, id, tipo, ordem };
}

async function carregarBanners() {
  const { data, error } = await supabase
    .from('banners')
    .select('*')
    .order('ordem', { ascending: true });
  if (error) throw error;

  const configBanners = { carrossel: [], bannersGrelha: [], bannerIntermediario: {} };
  for (const banner of data || []) {
    const formatado = formatarBanner(banner);
    if (banner.tipo === 'carrossel') configBanners.carrossel.push(formatado);
    if (banner.tipo === 'grelha') configBanners.bannersGrelha.push(formatado);
    if (banner.tipo === 'intermediario') configBanners.bannerIntermediario = formatado;
  }
  return configBanners;
}

function converterBannersParaLinhas(config) {
  const linhas = [];
  (config.carrossel || []).forEach((banner, ordem) => {
    linhas.push({ tipo: 'carrossel', ordem, ...banner, imagem: validarUrlImagem(banner.imagem), imagemMobile: validarUrlImagem(banner.imagemMobile) });
  });
  (config.bannersGrelha || []).forEach((banner, ordem) => {
    linhas.push({ tipo: 'grelha', ordem, ...banner, imagem: validarUrlImagem(banner.imagem), imagemMobile: validarUrlImagem(banner.imagemMobile) });
  });
  if (config.bannerIntermediario) {
    linhas.push({ tipo: 'intermediario', ordem: 0, ...config.bannerIntermediario, imagem: validarUrlImagem(config.bannerIntermediario.imagem), imagemMobile: validarUrlImagem(config.bannerIntermediario.imagemMobile) });
  }
  return linhas.map(({ id, ...linha }) => linha);
}

async function salvarBanners(config) {
  const { error: deleteError } = await supabase.from('banners').delete().not('id', 'is', null);
  if (deleteError) throw deleteError;
  const linhas = converterBannersParaLinhas(config);
  if (!linhas.length) return;
  const { error } = await supabaseAdmin.from('banners').insert(linhas);
  if (error) throw error;
}

async function garantirBannersNoSupabase(configFallback = {}) {
  const { data, error } = await supabase.from('banners').select('id').limit(1);
  if (error) throw error;
  if (data && data.length > 0) return;

  const configLocal = await getConfigChave('site_config', {});
  const temBannersLocais = configLocal.carrossel || configLocal.bannersGrelha || configLocal.bannerIntermediario;
  await salvarBanners(temBannersLocais ? configLocal : configFallback);
}

// --- Helpers de configuração por chave ---
async function getConfigChave(chave, fallback = {}) {
  try {
    const { data, error } = await supabaseAdmin.from('config').select('valor').eq('chave', chave).maybeSingle();
    if (error) throw error;
    return data?.valor || fallback;
  } catch (e) { return fallback; }
}

async function setConfigChave(chave, valor) {
  const { error } = await supabaseAdmin.from('config').upsert({ chave, valor }, { onConflict: 'chave' });
  if (error) throw error;
}

function obterBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

const BLING_CLIENT_ID = process.env.BLING_CLIENT_ID || '';
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET || '';
const BLING_CALLBACK_URL = process.env.BLING_CALLBACK_URL || 'https://usemio.com.br/auth/callback';
const BLING_AUTH_URL = process.env.BLING_AUTH_URL || 'https://www.bling.com.br/Api/v3/oauth/authorize';
const BLING_TOKEN_URL = process.env.BLING_TOKEN_URL || 'https://www.bling.com.br/Api/v3/oauth/token';
const BLING_API_BASE = process.env.BLING_API_BASE || 'https://www.bling.com.br/Api/v3';

function getBlingClientCredentials(cfg = {}) {
  const clientId = (cfg.clientId || process.env.BLING_CLIENT_ID || BLING_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.BLING_CLIENT_SECRET || BLING_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

function getBlingTokenHeaders(cfg = {}) {
  const { clientId, clientSecret } = getBlingClientCredentials(cfg);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

  if (clientId && clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  return headers;
}

async function getBlingOauthConfig() {
  const cfg = await getConfigChave('bling_oauth', {
    clientId: BLING_CLIENT_ID,
    clientSecret: BLING_CLIENT_SECRET,
    redirectUri: BLING_CALLBACK_URL,
    accessToken: '',
    refreshToken: '',
    tokenType: 'Bearer',
    expiresAt: 0,
    connected: false,
    scope: 'pedido:read pedido:write produto:read produto:write estoque:read estoque:write'
  });

  return {
    ...cfg,
    clientId: cfg.clientId || BLING_CLIENT_ID,
    clientSecret: cfg.clientSecret || BLING_CLIENT_SECRET,
    redirectUri: cfg.redirectUri || BLING_CALLBACK_URL,
    scope: cfg.scope || 'pedido:read pedido:write produto:read produto:write estoque:read estoque:write'
  };
}

async function salvarBlingOauthConfig(data = {}) {
  const cfg = await getBlingOauthConfig();
  const payload = {
    ...cfg,
    ...data,
    clientId: data.clientId || cfg.clientId || BLING_CLIENT_ID,
    clientSecret: data.clientSecret || cfg.clientSecret || BLING_CLIENT_SECRET,
    redirectUri: data.redirectUri || cfg.redirectUri || BLING_CALLBACK_URL,
    connected: true,
    updatedAt: new Date().toISOString()
  };
  await setConfigChave('bling_oauth', payload);
  return payload;
}

async function getBlingAccessToken() {
  const oauth = await getBlingOauthConfig();
  const now = Date.now();
  if (oauth.accessToken && Number(oauth.expiresAt || 0) > now + 60000) {
    return oauth.accessToken;
  }

  if (oauth.refreshToken) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
      client_id: oauth.clientId || BLING_CLIENT_ID,
      client_secret: oauth.clientSecret || BLING_CLIENT_SECRET
    });

    const res = await fetch(BLING_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || 'Falha ao renovar token do Bling.');
    }

    await salvarBlingOauthConfig({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || oauth.refreshToken,
      tokenType: data.token_type || 'Bearer',
      expiresAt: Date.now() + ((Number(data.expires_in) || 3600) * 1000),
      connected: true
    });

    return data.access_token;
  }

  throw new Error('Token do Bling não encontrado. Faça a autenticação do OAuth primeiro.');
}

async function consultarBlingApi(tipo, extraUrl = '') {
  const oauth = await getBlingOauthConfig();
  if (!oauth.accessToken) {
    return { ok: false, error: 'Token do Bling ausente. Faça login via OAuth.' };
  }

  const endpoints = {
    pedidos: [
      `${BLING_API_BASE}/pedidos`,
      `${BLING_API_BASE}/pedido`,
      `${BLING_API_BASE}/pedidos?pagina=1&limite=100`,
      `${BLING_API_BASE}/pedido?pagina=1&limite=100`
    ],
    estoque: [
      `${BLING_API_BASE}/produtos`,
      `${BLING_API_BASE}/produto`,
      `${BLING_API_BASE}/produtos?pagina=1&limite=100`,
      `${BLING_API_BASE}/produto?pagina=1&limite=100`,
      `${BLING_API_BASE}/estoque`
    ]
  };

  const candidates = extraUrl ? [extraUrl] : endpoints[tipo] || [];
  let lastError = null;

  for (const endpoint of candidates) {
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${oauth.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = data.error || data.message || `Erro em ${endpoint}`;
        continue;
      }

      if (data && (Array.isArray(data) || data.data || data.result || data.pedidos || data.produtos || data.itens || data.estoque)) {
        return { ok: true, data };
      }

      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        return { ok: true, data };
      }
    } catch (err) {
      lastError = err.message;
    }
  }

  return { ok: false, error: lastError || `Nenhum fluxo de ${tipo} retornou dados válidos.` };
}

function normalizarCpf(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function getPagSeguroBase(cfg = {}) {
  return (cfg.modo === 'produção' ? 'https://api.pagseguro.com' : 'https://sandbox.api.pagseguro.com');
}

function getPagSeguroHeaders(cfg = {}, extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extra
  };
  const token = cfg.token || '';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cfg.appKey) headers['x-api-key'] = cfg.appKey;
  if (cfg.appId) headers['x-idempotency-key'] = String(cfg.appId);
  return headers;
}

function getParcelamentoMaximo(valorTotal) {
  const total = Number(valorTotal || 0);
  if (total < 30) return 1;
  if (total < 60) return 2;
  if (total < 90) return 3;
  return 4;
}

async function buscarConfigPagSeguro() {
  const cfg = await getConfigChave('pagseguro_config', {
    ativo: false,
    modo: 'sandbox',
    email: '',
    token: '',
    publicKey: '',
    appId: '',
    appKey: ''
  });
  return {
    ...cfg,
    ativo: process.env.PAGBANK_ATIVO !== undefined ? process.env.PAGBANK_ATIVO === 'true' : !!cfg.ativo,
    modo: process.env.PAGBANK_MODO || cfg.modo || 'sandbox',
    email: process.env.PAGBANK_EMAIL || cfg.email || '',
    token: process.env.PAGBANK_TOKEN || cfg.token || '',
    publicKey: process.env.PAGBANK_PUBLIC_KEY || cfg.publicKey || '',
    appId: process.env.PAGBANK_APP_ID || cfg.appId || '',
    appKey: process.env.PAGBANK_APP_KEY || cfg.appKey || ''
  };
}

async function findPedidoByReference(reference) {
  if (!reference) return null;
  const byNumero = await buscarPedidoPorNumero(reference);
  if (byNumero) return byNumero;
  return buscarPedidoPorId(Number(reference));
}

async function upsertProdutoBling(dadosProduto, blingId) {
  if (!blingId) throw new Error('blingId é obrigatório');
  const agora = new Date().toISOString();
  const dataUpsert = {
    ...dadosProduto,
    bling_id: String(blingId).trim(),
    data_last_sync: agora,
    sync_status: 'sucesso',
    data_cadastro: dadosProduto.data_cadastro || agora
  };
  const { data: existente, error: erroQuery } = await supabaseAdmin
    .from('produtos')
    .select('id')
    .eq('bling_id', String(blingId).trim())
    .maybeSingle();
  if (erroQuery) throw erroQuery;

  if (existente) {
    const { data: updated, error: erroUpdate } = await supabaseAdmin
      .from('produtos')
      .update(dataUpsert)
      .eq('id', existente.id)
      .select('id, bling_id, nome')
      .single();
    if (erroUpdate) throw erroUpdate;
    return { operacao: 'update', id: updated.id, bling_id: updated.bling_id };
  }

  const { data: criado, error: erroInsert } = await supabaseAdmin
    .from('produtos')
    .insert(dataUpsert)
    .select('id, bling_id, nome')
    .single();
  if (erroInsert) throw erroInsert;
  return { operacao: 'insert', id: criado.id, bling_id: criado.bling_id };
}

async function sincronizarProdutoBlingParaSite(dadosBling) {
  const blingId = String(dadosBling.id || dadosBling.codigo || '').trim();
  if (!blingId) throw new Error('Bling product ID não encontrado');
  const dadosMapeados = mapearProdutoBlingParaSite(dadosBling);
  const dadosSupabase = prepararProduto({
    nome: dadosMapeados.nome,
    preco: dadosMapeados.preco,
    precoOriginal: dadosMapeados.precoOriginal,
    estaEmPromocao: dadosMapeados.estaEmPromocao,
    textoDestaquePromo: dadosMapeados.textoDestaquePromo,
    cronometro: dadosMapeados.cronometro,
    categoria: dadosMapeados.categoria,
    genero: dadosMapeados.genero,
    imagem: dadosMapeados.imagem,
    fotos: dadosMapeados.fotos,
    cores: dadosMapeados.cores,
    tamanhos: dadosMapeados.tamanhos,
    descricao: dadosMapeados.descricao,
    estoque: dadosMapeados.estoque,
    relevancia: dadosMapeados.relevancia,
    data: dadosMapeados.data
  });
  const resultado = await upsertProdutoBling(dadosSupabase, blingId);
  return { ok: true, operacao: resultado.operacao, id: resultado.id, bling_id: resultado.bling_id, nome: dadosMapeados.nome };
}

async function registrarTentativaSyncProduto(produtoId, status, mensagem = '') {
  try {
    const { data: produto } = await supabaseAdmin
      .from('produtos')
      .select('sync_tentativas')
      .eq('id', produtoId)
      .maybeSingle();
    const tentativas = (produto?.sync_tentativas || 0) + 1;
    await supabaseAdmin.from('produtos').update({
      sync_status: status,
      sync_tentativas: tentativas,
      sync_erro: mensagem || null,
      data_last_sync: new Date().toISOString()
    }).eq('id', produtoId);
  } catch (err) {
    console.error('Erro ao registrar sync:', err);
  }
}

async function enviarPedidoParaBling(pedido) {
  try {
    const cfg = await getConfigChave('bling_config', {});
    const oauth = await getBlingOauthConfig();
    const urlBase = (cfg.url || 'https://www.bling.com.br/Api/v3').replace(/\/$/, '');
    const authMethod = oauth.accessToken ? 'oauth' : (cfg.apiKey && cfg.apiToken ? 'basic' : 'none');

    if (authMethod === 'none') {
      return { ok: false, motivo: 'Bling não configurado. Conecte o OAuth ou preencha API Key e API Token.' };
    }

    const clienteJson = parseJsonArray(pedido.cliente, {});
    const itensJson = parseJsonArray(pedido.itens, []);
    const enderecoJson = parseJsonArray(pedido.endereco, {});

    const payload = {
      data: new Date().toISOString().slice(0, 10),
      numero: pedido.numero,
      cliente: {
        nome: clienteJson.nome || 'Cliente',
        email: clienteJson.email || '',
        telefone: clienteJson.telefone || clienteJson.whatsapp || ''
      },
      endereco: enderecoJson,
      itens: itensJson.map(i => ({
        codigo: i.sku || i.nome,
        descricao: i.nome,
        quantidade: Number(i.quantidade || 1),
        valor: Number(i.preco || 0)
      })),
      total: Number(pedido.total || 0),
      observacoes: 'Pedido gerado pelo site MIO'
    };

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (authMethod === 'oauth') {
      headers.Authorization = `Bearer ${oauth.accessToken}`;
    } else {
      headers.Authorization = 'Basic ' + Buffer.from(cfg.apiKey + ':' + cfg.apiToken).toString('base64');
    }

    const resApi = await fetch(urlBase + '/pedido', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await resApi.json().catch(() => ({}));
    if (!resApi.ok) throw new Error(data.message || data.error || 'Falha ao enviar pedido ao Bling');

    const blingId = data.id || data.pedidoId || data.data?.id || data.numero;
    if (blingId) {
      await atualizarPedidoPorNumero(pedido.numero, { bling_id: String(blingId), bling_order_id: String(blingId), data_bling_sync: new Date().toISOString() }).catch(() => {});
    }

    return { ok: true, data };
  } catch (error) {
    console.warn('Aviso: não foi possível enviar ao Bling', error);
    return { ok: false, motivo: error.message };
  }
}

async function enviarPedidoParaUpseller(pedido) {
  return enviarPedidoParaBling(pedido);
}

// ---------- API: UPLOAD DE IMAGENS ----------
app.post('/api/upload', exigirAdmin, async (req, res) => {
  try {
    const { imagem, nome } = req.body || {};
    if (!imagem) return res.status(400).json({ error: "Nenhuma imagem recebida." });
    // Suporta base64 (data:image/...) ou URL direta
    if (imagem.startsWith('data:image')) {
      const matches = imagem.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!matches) return res.status(400).json({ error: "Formato de imagem inválido." });
      const ext = (matches[1].split('/')[1] || 'png').replace('jpeg', 'jpg');
      const buffer = Buffer.from(matches[2], 'base64');
      const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'images';
      const prefixo = nome ? nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : 'img';
      const filePath = `admin/${prefixo}-${crypto.randomUUID()}.${ext}`;
      const { error } = await supabaseAdmin.storage.from(bucket).upload(filePath, buffer, {
        contentType: matches[1],
        upsert: false
      });
      if (error) throw error;
      const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
      return res.json({ ok: true, url: data.publicUrl });
    }
    // URL externa - retorna a própria URL
    return res.json({ ok: true, url: validarUrlImagem(imagem) });
  } catch (err) {
    res.status(500).json({ error: "Erro ao enviar imagem: " + err.message });
  }
});

// ---------- API: LOGIN DE CLIENTE (banco) ----------
app.post('/api/clientes/login', loginLimiter, async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ error: "Email e senha obrigatórios." });
  const emailBusca = email.toLowerCase().trim();
  try {
    const c = await buscarClientePorEmail(emailBusca);
    const senhaOk = c ? await compararSenha(senha, c.senha) : false;
    if (!c || !senhaOk) {
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    }
    const clienteSemSenha = formatarCliente(c);
    const token = crypto.randomBytes(32).toString('hex');
    await salvarSessaoCliente(token, emailBusca, Date.now() + 15 * 60 * 1000);
    res.cookie('client_token', token, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 15 * 60 * 1000, path: '/' });
    res.json({ ok: true, cliente: clienteSemSenha, token });
  } catch (err) {
    res.status(500).json({ error: "Erro no login." });
  }
});

app.get('/api/clientes/me', exigirCliente, async (req, res) => {
  try {
    const cliente = await buscarClientePorEmail(req.clienteEmail);
    if (!cliente) return res.status(404).json({ error: "Cliente não encontrado." });
    res.json({ ok: true, cliente: formatarCliente(cliente) });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar cliente." });
  }
});

// ---------- API: ATUALIZAR PERFIL DO CLIENTE (dados, foto, consentimentos) ----------
// Permite que o cliente autenticado atualize seu próprio cadastro no banco.
app.put('/api/clientes/perfil', async (req, res) => {
  const { email, senha, dados } = req.body || {};
  let emailBusca = null;
  const token = getClientToken(req);
  const sessao = token ? await carregarSessaoCliente(token) : null;
  if (sessao) {
    sessao.expiraEm = Date.now() + 15 * 60 * 1000;
    await salvarSessaoCliente(token, sessao.email, sessao.expiraEm);
    emailBusca = sessao.email;
  } else if (email && senha) {
    emailBusca = email.toLowerCase().trim();
  } else {
    return res.status(400).json({ error: "E-mail e senha obrigatórios ou token inválido." });
  }
  try {
    const c = await buscarClientePorEmail(emailBusca);
    if (!c) return res.status(401).json({ error: "Cliente não encontrado." });
    if (!token) {
      const senhaOk = await compararSenha(senha, c.senha);
      if (!senhaOk) {
        return res.status(401).json({ error: "Senha incorreta. Não foi possível atualizar o perfil." });
      }
    }
    const d = dados || {};
    const { error } = await supabaseAdmin.from('clientes').update({
      nome: d.nome || c.nome, cpf: d.cpf || c.cpf || '', telefone: d.telefone || c.telefone || '',
      endereco: d.endereco || parseJsonArray(c.endereco, {}), foto: d.foto || c.foto || '',
      whatsapp_ok: d.whatsapp_ok !== undefined ? !!d.whatsapp_ok : c.whatsapp_ok,
      aceitou_termos: d.aceitou_termos !== undefined ? !!d.aceitou_termos : c.aceitou_termos
    }).eq('email', emailBusca);
    if (error) throw error;
    res.json({ ok: true, message: "Perfil atualizado no banco de dados." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar perfil." });
  }
});

// ---------- API: REDEFINIR SENHA DE CLIENTE (admin) ----------
// Permite ao admin definir uma nova senha para um cliente (ex: quando o cliente esquece).
app.put('/api/clientes/reenviar-senha', exigirAdmin, async (req, res) => {
  const { email, novaSenha } = req.body || {};
  if (!email || !novaSenha) return res.status(400).json({ error: "E-mail e nova senha obrigatórios." });
  try {
    const emailBusca = email.toLowerCase().trim();
    const existe = await buscarClientePorEmail(emailBusca);
    if (!existe) return res.status(404).json({ error: "Cliente não encontrado." });
    const nova = novaSenha.length < 6 ? 'mio123' : novaSenha;
    const { error } = await supabaseAdmin.from('clientes').update({ senha: await hashSenha(nova) }).eq('email', emailBusca);
    if (error) throw error;
    res.json({ ok: true, novaSenha: nova });
  } catch (err) {
    res.status(500).json({ error: "Erro ao redefinir senha." });
  }
});

app.put('/api/clientes/senha', exigirCliente, async (req, res) => {
  const { senhaAtual, novaSenha } = req.body || {};
  if (!senhaAtual || !novaSenha || novaSenha.length < 6) {
    return res.status(400).json({ error: "Senha atual e nova senha (mínimo 6 caracteres) são obrigatórias." });
  }
  try {
    const cliente = await buscarClientePorEmail(req.clienteEmail);
    if (!cliente) return res.status(404).json({ error: "Cliente não encontrado." });
    const senhaOk = await compararSenha(senhaAtual, cliente.senha);
    if (!senhaOk) {
      return res.status(401).json({ error: "Senha atual incorreta." });
    }
    const { error } = await supabaseAdmin.from('clientes').update({ senha: await hashSenha(novaSenha) }).eq('email', req.clienteEmail);
    if (error) throw error;
    res.json({ ok: true, message: "Senha atualizada com sucesso." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao alterar senha." });
  }
});

// Gera uma senha temporária aleatória para um cliente (usado no painel admin,
// quando o cliente esquece a senha). Retorna a senha para o admin repassar ao cliente.
app.post('/api/admin/clientes/:id/reset-senha', exigirAdmin, async (req, res) => {
  try {
    const { data: cliente, error: clienteError } = await supabaseAdmin.from('clientes').select('id, email, nome').eq('id', req.params.id).maybeSingle();
    if (clienteError) throw clienteError;
    if (!cliente) return res.status(404).json({ error: "Cliente não encontrado." });
    // Cria uma senha temporária legível (ex: "mioA7k2P")
    const senhaTemporaria = 'mio' + crypto.randomBytes(4).toString('hex');
    const { error } = await supabaseAdmin.from('clientes').update({ senha: await hashSenha(senhaTemporaria) }).eq('id', cliente.id);
    if (error) throw error;
    res.json({ ok: true, senhaTemporaria, email: cliente.email, nome: cliente.nome });
  } catch (err) {
    res.status(500).json({ error: "Erro ao redefinir senha." });
  }
});

// ---------- API: CONFIGURAÇÕES DE INTEGRAÇÕES ----------
app.get('/api/integracoes', exigirAdmin, async (req, res) => {
  try {
    const [pagamento, envio, bling, oauth] = await Promise.all([
      getConfigChave('pagseguro_config', {
        modo: 'sandbox', email: '', token: '', appId: '', appKey: '', ativo: false
      }),
      getConfigChave('melhorenvio_config', {
        token: '', cepOrigem: '', modo: 'sandbox', ativo: false
      }),
      getConfigChave('bling_config', {
        apiKey: '', apiToken: '', url: 'https://www.bling.com.br/Api/v3', empresaId: '', ativo: false
      }),
      getBlingOauthConfig()
    ]);

    if (!envio.token && process.env.MELHOR_ENVIO_TOKEN) {
      envio.token = process.env.MELHOR_ENVIO_TOKEN;
    }
    if (!envio.cepOrigem && process.env.MELHOR_ENVIO_CEP) {
      envio.cepOrigem = process.env.MELHOR_ENVIO_CEP;
    }

    const blingOauth = {
      ...oauth,
      clientId: oauth.clientId || BLING_CLIENT_ID,
      clientSecret: oauth.clientSecret || BLING_CLIENT_SECRET,
      redirectUri: oauth.redirectUri || BLING_CALLBACK_URL,
      connected: Boolean(oauth.connected || oauth.accessToken)
    };

    res.json({ pagamento, envio, bling, upseller: bling, blingOauth });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar integrações." });
  }
});

app.put('/api/integracoes', exigirAdmin, async (req, res) => {
  const { pagamento, envio, bling, upseller, blingOauth } = req.body || {};
  try {
    if (pagamento) await setConfigChave('pagseguro_config', pagamento);
    if (envio) await setConfigChave('melhorenvio_config', envio);
    if (bling) await setConfigChave('bling_config', bling);
    if (upseller) await setConfigChave('bling_config', upseller);
    if (blingOauth) await setConfigChave('bling_oauth', blingOauth);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar integrações." });
  }
});

app.get('/api/bling/auth', async (req, res) => {
  try {
    const cfg = await getBlingOauthConfig();
    const clientId = (cfg.clientId || BLING_CLIENT_ID || '').trim();
    const clientSecret = (cfg.clientSecret || BLING_CLIENT_SECRET || '').trim();

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        ok: false,
        error: 'Bling não configurado. Preencha BLING_CLIENT_ID e BLING_CLIENT_SECRET antes de iniciar a autorização.'
      });
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: cfg.redirectUri || BLING_CALLBACK_URL,
      scope: cfg.scope || 'pedido:read pedido:write produto:read produto:write estoque:read estoque:write',
      state: crypto.randomBytes(16).toString('hex')
    });

    const authUrl = `${BLING_AUTH_URL}?${params.toString()}`;
    res.redirect(authUrl);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Erro ao montar URL de autenticação do Bling.' });
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query || {};
    if (error) {
      const msg = encodeURIComponent(error_description || error || 'Autorização cancelada pelo Bling.');
      return res.redirect('/admin.html?bling_error=1&message=' + msg);
    }
    if (!code) {
      return res.redirect('/admin.html?bling_error=missing_code&message=' + encodeURIComponent('Acesso ao callback do Bling sem code. Use a rota /api/bling/auth para iniciar o login.'));
    }

    const cfg = await getBlingOauthConfig();
    const clientId = cfg.clientId || BLING_CLIENT_ID;
    const clientSecret = cfg.clientSecret || BLING_CLIENT_SECRET;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri || BLING_CALLBACK_URL,
      client_id: clientId,
      client_secret: clientSecret
    });

    const tokenRes = await fetch(BLING_TOKEN_URL, {
      method: 'POST',
      headers: {
        ...getBlingTokenHeaders({ clientId, clientSecret }),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      const msg = encodeURIComponent(tokenData.error_description || tokenData.error || 'Erro ao trocar código do Bling por token.');
      return res.redirect('/admin.html?bling_error=1&message=' + msg);
    }

    await salvarBlingOauthConfig({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || '',
      tokenType: tokenData.token_type || 'Bearer',
      expiresAt: Date.now() + ((Number(tokenData.expires_in) || 3600) * 1000),
      connected: true,
      state: state || '',
      authCode: code
    });

    return res.redirect('/admin.html?bling_status=connected&message=' + encodeURIComponent('Bling conectado com sucesso!'));
  } catch (err) {
    const msg = encodeURIComponent('Erro ao processar callback do Bling: ' + err.message);
    return res.redirect('/admin.html?bling_error=1&message=' + msg);
  }
});

app.get('/api/bling/callback', async (req, res) => {
  return res.redirect(302, '/auth/callback?' + new URLSearchParams(req.query).toString());
});

app.post('/api/webhooks/bling', async (req, res) => {
  try {
    const evento = req.body || {};

    if (evento.type === 'INSERT' && evento.table === 'produtos') {
      const produto = evento.record;
      if (produto) {
        await enviarProdutoParaBling(produto);
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro no webhook do Bling:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/bling/debug', exigirAdmin, async (req, res) => {
  try {
    const oauth = await getBlingOauthConfig();
    res.json({
      ok: true,
      env: {
        BLING_CLIENT_ID: BLING_CLIENT_ID ? `${BLING_CLIENT_ID.substring(0, 8)}...` : 'NÃO CONFIGURADO',
        BLING_CLIENT_SECRET: BLING_CLIENT_SECRET ? `${BLING_CLIENT_SECRET.substring(0, 8)}...` : 'NÃO CONFIGURADO',
        BLING_CALLBACK_URL: BLING_CALLBACK_URL,
        BLING_AUTH_URL: BLING_AUTH_URL,
        BLING_TOKEN_URL: BLING_TOKEN_URL,
        BLING_API_BASE: BLING_API_BASE
      },
      database: {
        accessToken: oauth.accessToken ? `${oauth.accessToken.substring(0, 10)}...` : 'vazio',
        refreshToken: oauth.refreshToken ? `${oauth.refreshToken.substring(0, 10)}...` : 'vazio',
        connected: oauth.connected,
        expiresAt: oauth.expiresAt ? new Date(oauth.expiresAt).toISOString() : 'N/A',
        clientId: oauth.clientId ? `${oauth.clientId.substring(0, 8)}...` : 'vazio'
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/bling/auth/refresh', exigirAdmin, async (req, res) => {
  try {
    const oauth = await getBlingOauthConfig();
    if (!oauth.refreshToken) {
      return res.status(400).json({ ok: false, error: 'Refresh token do Bling não encontrado.' });
    }

    const clientId = oauth.clientId || BLING_CLIENT_ID;
    const clientSecret = oauth.clientSecret || BLING_CLIENT_SECRET;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    });

    const tokenRes = await fetch(BLING_TOKEN_URL, {
      method: 'POST',
      headers: {
        ...getBlingTokenHeaders({ clientId, clientSecret }),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(502).json({ ok: false, error: tokenData.error_description || tokenData.error || 'Erro ao atualizar token do Bling.' });
    }

    const saved = await salvarBlingOauthConfig({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || oauth.refreshToken,
      tokenType: tokenData.token_type || 'Bearer',
      expiresAt: Date.now() + ((Number(tokenData.expires_in) || 3600) * 1000),
      connected: true
    });

    res.json({ ok: true, token: saved });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Erro ao renovar token do Bling: ' + err.message });
  }
});

app.get('/api/bling/status', exigirAdmin, async (req, res) => {
  try {
    const oauth = await getBlingOauthConfig();
    res.json({ ok: true, connected: !!oauth.connected && !!oauth.accessToken, oauth });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/bling/sync', exigirAdmin, async (req, res) => {
  try {
    const cfg = await getConfigChave('bling_config', {});
    const oauth = await getBlingOauthConfig();
    if (!oauth.accessToken) {
      return res.status(400).json({ ok: false, error: 'Bling não autenticado. Faça login OAuth primeiro.' });
    }

    const [pedidos, estoque] = await Promise.all([
      consultarBlingApi('pedidos'),
      consultarBlingApi('estoque')
    ]);

    const payload = {
      conectado: true,
      pedidos: pedidos.ok ? pedidos.data : null,
      estoque: estoque.ok ? estoque.data : null,
      sincronizadoEm: new Date().toISOString()
    };

    await setConfigChave('bling_sync_last', payload);
    res.json({ ok: true, data: payload, mensagem: 'Sincronização Bling processada com sucesso.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Erro ao preparar sincronização do Bling: ' + err.message });
  }
});

app.get('/api/bling/sync/pedidos', exigirAdmin, async (req, res) => {
  try {
    const data = await consultarBlingApi('pedidos');
    if (!data.ok) return res.status(502).json({ ok: false, error: data.error || 'Erro ao buscar pedidos do Bling.' });
    
    // Sincroniza pedidos do Bling PARA O SITE, atualizando status e rastreamento
    const lista = extrairListaProdutosBling(data.data);
    let atualizados = 0;
    
    for (const item of lista) {
      const numeroBlng = String(item.numero || item.order_number || item.numero_pedido || '').trim();
      const status = String(item.status || item.situacao || 'Enviado').trim();
      const rastreio = String(item.tracking_number || item.codigo_rastreio || item.rastreio || '').trim();
      
      if (!numeroBlng) continue;
      
      const statusMap = { 
        pending: 'Em Preparação', 
        processing: 'Em Preparação', 
        shipped: 'Enviado', 
        delivered: 'Entregue', 
        cancelled: 'Cancelado', 
        sent: 'Enviado',
        'em preparação': 'Em Preparação',
        'enviado': 'Enviado',
        'entregue': 'Entregue',
        'cancelado': 'Cancelado'
      };
      const statusMio = statusMap[status.toLowerCase()] || status || 'Enviado';
      
      const updateData = { 
        bling_status: status, 
        status: statusMio,
        data_bling_sync: new Date().toISOString()
      };
      if (rastreio) updateData.codigo_rastreamento = rastreio;
      
      const { error } = await supabaseAdmin.from('pedidos')
        .update(updateData)
        .eq('numero', numeroBlng);
      
      if (!error) atualizados += 1;
    }
    
    await setConfigChave('bling_sync_pedidos_last', { data: data.data, sincronizadoEm: new Date().toISOString(), atualizados });
    res.json({ ok: true, pedidos: lista, atualizados, total: lista.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Erro ao sincronizar pedidos com Bling: ' + err.message });
  }
});

app.get('/api/bling/sync/estoque', exigirAdmin, async (req, res) => {
  try {
    const data = await consultarBlingApi('estoque');
    if (!data.ok) return res.status(502).json({ ok: false, error: data.error || 'Erro ao buscar estoque do Bling.' });
    await setConfigChave('bling_sync_estoque_last', { data: data.data, sincronizadoEm: new Date().toISOString() });
    res.json({ ok: true, estoque: data.data });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Erro ao sincronizar estoque com Bling: ' + err.message });
  }
});

app.post('/api/integracoes/testar', exigirAdmin, async (req, res) => {
  const { tipo } = req.body || {};
  try {
    if (tipo === 'pagamento') {
      const cfg = await buscarConfigPagSeguro();
      if (!cfg.token) {
        return res.json({ ok: false, mensagem: "Credenciais do PagSeguro não preenchidas." });
      }
      return res.json({ ok: true, mensagem: "Token PagBank configurado. Para cartão, informe também a chave pública." });
    }
    if (tipo === 'envio') {
      let cfg = await getConfigChave('melhorenvio_config', {});
      let token = cfg.token || process.env.MELHOR_ENVIO_TOKEN || '';
      let cepOrigem = cfg.cepOrigem || process.env.MELHOR_ENVIO_CEP || '';
      if (!token || !cepOrigem) {
        return res.json({ ok: false, mensagem: "Token e CEP de origem do Melhor Envio não preenchidos." });
      }
      return res.json({ ok: true, mensagem: "✅ Credenciais Melhor Envio configuradas!" + (process.env.MELHOR_ENVIO_TOKEN ? " (Via variável de ambiente)" : "") });
    }
    if (tipo === 'upseller' || tipo === 'bling') {
      const cfg = await getConfigChave('bling_config', {});
      if (!cfg.apiKey || !cfg.apiToken) {
        return res.json({ ok: false, mensagem: "API Key e API Token do Bling não preenchidos." });
      }
      return res.json({ ok: true, mensagem: "Credenciais Bling configuradas." });
    }
    res.json({ ok: false, mensagem: "Tipo desconhecido." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao testar conexão." });
  }
});

app.get('/api/pagseguro/public-config', async (req, res) => {
  try {
    const cfg = await buscarConfigPagSeguro();
    res.json({
      ok: true,
      ativo: !!cfg.ativo,
      modo: cfg.modo || 'sandbox',
      configurado: Boolean(cfg.token),
      publicKey: cfg.publicKey || ''
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Erro ao carregar configurações públicas do PagSeguro.' });
  }
});

// ---------- API: PAGAMENTO (PagSeguro) ----------
async function criarCargaPagSeguro(req, payload) {
  const cfg = await buscarConfigPagSeguro();
  const ativo = !!cfg.ativo;
  if (!ativo) {
    return { error: 'Pagamento via PagSeguro está desativado no painel administrativo. Ative a integração para concluir o checkout.' };
  }

  const valor = Number(payload.valor || 0);
  const numeroPedido = payload.numeroPedido || `MIO-${Date.now()}`;
  const cliente = payload.cliente || {};
  const itens = payload.itens || [];
  const configUrl = obterBaseUrl(req);
  const notificationUrls = [
    `${configUrl}/api/webhooks/pagseguro`,
    `${configUrl}/api/pagamento/webhook`
  ];

  const base = getPagSeguroBase(cfg);
  const authHeaders = getPagSeguroHeaders(cfg, {
    ...(cfg.appId ? { 'x-api-id': cfg.appId } : {})
  });

  const body = {
    reference_id: numeroPedido,
    customer: {
      name: cliente.nome || 'Cliente MIO',
      email: cliente.email || 'cliente@miostreetwear.com.br',
      tax_id: normalizarCpf(cliente.cpf || '')
    },
    items: itens.map(i => ({
      name: i.nome,
      quantity: Number(i.quantidade || 1),
      unit_amount: Math.round(Number(i.preco || 0) * 100)
    })),
    amount: { value: Math.round(valor * 100), currency: 'BRL' },
    notification_urls: notificationUrls,
    charges: payload.charges || []
  };

  if (payload.metodo === 'pix') {
    body.charges = [{
      reference_id: numeroPedido,
      description: 'Pagamento PIX MIO',
      amount: { value: Math.round(valor * 100), currency: 'BRL' },
      payment_method: {
        type: 'PIX',
        capture: true
      }
    }];
  }

  if (payload.metodo === 'cartao') {
    const parcelas = Math.max(1, Math.min(getParcelamentoMaximo(valor), Number(payload.parcelas || 1)))
    body.charges = [{
      reference_id: numeroPedido,
      description: 'Pagamento com cartão MIO',
      amount: { value: Math.round(valor * 100), currency: 'BRL' },
      payment_method: {
        type: 'CREDIT_CARD',
        installments: parcelas,
        capture: true,
        card: {
          encrypted: payload.encryptedCard,
          holder: {
            name: payload.cartaoNome || cliente.nome || 'Cliente MIO'
          }
        }
      }
    }];
  }

  const resApi = await fetch(base + '/charges', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(body)
  });

  const data = await resApi.json().catch(() => ({}));
  if (!resApi.ok) {
    const mensagem = data.message || data.error_messages?.map(m => m.description).join(', ') || 'Erro ao processar o pagamento no PagSeguro.';
    return { error: mensagem, statusCode: resApi.status };
  }

  return { ok: true, data };
}

app.get('/api/pagseguro/session', async (req, res) => {
  try {
    const cfg = await buscarConfigPagSeguro();
    if (!cfg.ativo || !cfg.token) {
      return res.status(403).json({ ok: false, error: 'PagBank desativado ou token não configurado.' });
    }
    return res.json({ ok: true, sessionId: null });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Erro interno ao gerar sessão do PagSeguro: ' + error.message });
  }
});

app.post('/api/checkout', async (req, res) => {
  try {
    const payload = req.body || {};
    const metodo = (payload.metodoPagamento || payload.metodo || 'pix').toLowerCase();
    const valorTotal = Number(payload.total || payload.valor || 0);
    if (!payload.cliente || !payload.endereco || !Array.isArray(payload.itens) || payload.itens.length === 0) {
      return res.status(400).json({ ok: false, error: 'Dados do cliente, endereço e itens são obrigatórios.' });
    }
    if (!valorTotal || valorTotal <= 0) {
      return res.status(400).json({ ok: false, error: 'Valor do pedido inválido.' });
    }

    const cfg = await buscarConfigPagSeguro();
    if (!cfg.ativo) {
      return res.status(403).json({ ok: false, error: 'Pagamento via PagSeguro está desativado no painel administrativo.' });
    }

    const numeroPedido = payload.numeroPedido || `MIO-${Date.now()}`;
    const freteSelecionado = payload.freteSelecionado || {
      modalidade: 'Entrega Padrão',
      codigo: 'padrao',
      nome: 'Entrega Padrão',
      valor: Number(payload.frete || 0),
      prazo: '5 dias úteis',
      origem: 'checkout'
    };
    const pedidoMio = {
      numero: numeroPedido,
      data: payload.data || new Date().toISOString(),
      cliente: payload.cliente,
      endereco: payload.endereco,
      itens: payload.itens,
      cupom: payload.cupom || null,
      metodo: metodo,
      status: 'Aguardando Pagamento',
      frete: Number(payload.frete || 0),
      desconto: Number(payload.desconto || 0),
      total: Number(valorTotal),
      freteSelecionado
    };

    const { error: pedidoError } = await supabaseAdmin.from('pedidos').insert({
      numero: pedidoMio.numero,
      data: pedidoMio.data,
      cliente: pedidoMio.cliente,
      endereco: pedidoMio.endereco,
      itens: pedidoMio.itens,
      cupom: pedidoMio.cupom,
      metodo: pedidoMio.metodo,
      status: pedidoMio.status,
      total: pedidoMio.total,
      frete_modalidade: freteSelecionado.modalidade || freteSelecionado.nome || 'Entrega Padrão',
      frete_codigo: freteSelecionado.codigo || freteSelecionado.nome || 'padrao',
      frete_valor: Number(freteSelecionado.valor || pedidoMio.frete || 0),
      frete_prazo: freteSelecionado.prazo || '5 dias úteis',
      frete_origem: freteSelecionado.origem || 'checkout',
      frete_detalhes: freteSelecionado
    });
    if (pedidoError) throw pedidoError;

    if (pedidoMio.cupom && pedidoMio.cupom.codigo) {
      await incrementarUsoCupom(String(pedidoMio.cupom.codigo).toUpperCase().trim());
    }

    if (metodo === 'pix') {
      const result = await criarCargaPagSeguro(req, {
        valor: valorTotal,
        numeroPedido,
        cliente: payload.cliente,
        itens: payload.itens,
        metodo: 'pix'
      });

      if (result.error) {
        await atualizarPedidoPorNumero(numeroPedido, { status: 'Falhou' });
        return res.status(result.statusCode || 502).json({ ok: false, error: result.error });
      }

      const data = result.data || {};
      const qrCodes = data.qr_codes || data.payment_response?.qr_codes || [];
      const qr = qrCodes[0] || {};
      const copiaCola = qr.text || qr.arrangement_information || data.copy_and_paste || '';
      const qrCodeImage = qr.image || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(copiaCola || `MIO_PIX_${numeroPedido}`)}`;

      await atualizarPedidoPorNumero(numeroPedido, { status: 'Aguardando Pagamento' });
      return res.json({
        ok: true,
        numeroPedido,
        status: 'Aguardando Pagamento',
        metodo: 'pix',
        qrCodeImage,
        qrCodeText: qr.text || copiaCola,
        copiaECola: copiaCola,
        mensagem: 'Pagamento PIX gerado com sucesso.'
      });
    }

    if (metodo === 'cartao') {
      const { encryptedCard, parcelas, cartaoNome } = payload.pagamento || {};
      const parcelasPermitidas = getParcelamentoMaximo(valorTotal);
      const parcelasFinal = Math.max(1, Math.min(parcelasPermitidas, Number(parcelas || 1)));
      if (!encryptedCard) {
        await atualizarPedidoPorNumero(numeroPedido, { status: 'Falhou' });
        return res.status(400).json({ ok: false, error: 'Cartão criptografado não informado. Use a SDK do PagSeguro no frontend.' });
      }

      const result = await criarCargaPagSeguro(req, {
        valor: valorTotal,
        numeroPedido,
        cliente: payload.cliente,
        itens: payload.itens,
        metodo: 'cartao',
        parcelas: parcelasFinal,
        encryptedCard,
        cartaoNome
      });

      if (result.error) {
        await atualizarPedidoPorNumero(numeroPedido, { status: 'Falhou' });
        return res.status(result.statusCode || 502).json({ ok: false, error: result.error });
      }

      const data = result.data || {};
      const statusFinal = String(data.status || '').toUpperCase();
      const aprovado = statusFinal === 'PAID' || statusFinal === '3' || data.status === 3;
      const pedidoStatus = aprovado ? 'PAGO' : 'Aguardando Pagamento';

      await atualizarPedidoPorNumero(numeroPedido, { status: pedidoStatus });
      return res.json({
        ok: true,
        numeroPedido,
        status: pedidoStatus,
        metodo: 'cartao',
        aprovado,
        mensagem: aprovado ? 'Pagamento aprovado com cartão!' : 'Pagamento em análise.'
      });
    }

    return res.status(400).json({ ok: false, error: 'Método de pagamento inválido.' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Erro ao processar checkout: ' + error.message });
  }
});

app.post('/api/pagamento/pix', async (req, res) => {
  const { valor, cliente, numeroPedido } = req.body || {};
  if (!valor || !cliente) return res.status(400).json({ error: 'Valor e cliente obrigatórios.' });
  try {
    const cfg = await buscarConfigPagSeguro();
    if (!cfg.ativo) {
      return res.status(403).json({ ok: false, error: 'Pagamento via PagSeguro está desativado no painel administrativo.' });
    }
    const result = await criarCargaPagSeguro({ get: () => 'http://localhost' }, {
      valor,
      numeroPedido: numeroPedido || `MIO-${Date.now()}`,
      cliente,
      itens: [],
      metodo: 'pix'
    });

    if (result.error) return res.status(502).json({ ok: false, error: result.error });

    const data = result.data || {};
    const qrCodes = data.qr_codes || data.payment_response?.qr_codes || [];
    const qr = qrCodes[0] || {};
    const copiaECola = qr.text || qr.arrangement_information || data.copy_and_paste || '';
    return res.json({
      ok: true,
      qrCodeText: qr.text || copiaECola,
      copiaECola,
      qrCodeImage: qr.image || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(copiaECola || 'MIO_PIX')}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao gerar PIX: ' + error.message });
  }
});

app.post('/api/pagamento/cartao', async (req, res) => {
  const { valor, cliente, numeroPedido, cartao, itens, parcelas, encryptedCard } = req.body || {};
  if (!valor || !cliente || !cartao) return res.status(400).json({ error: 'Valor, cliente e dados do cartão obrigatórios.' });

  try {
    const cfg = await buscarConfigPagSeguro();
    if (!cfg.ativo) {
      return res.status(403).json({ ok: false, error: 'Pagamento via PagSeguro está desativado no painel administrativo.' });
    }
    const validado = encryptedCard || cartao.encryptedCard || cartao.encrypted_card || cartao.encrypted;
    if (!validado) {
      return res.status(400).json({ ok: false, error: 'Cartão criptografado não informado. Use a SDK do PagSeguro no frontend.' });
    }
    const result = await criarCargaPagSeguro({ get: () => 'http://localhost' }, {
      valor,
      numeroPedido: numeroPedido || `MIO-${Date.now()}`,
      cliente,
      itens: itens || [],
      metodo: 'cartao',
      parcelas: parcelas || 1,
      encryptedCard: validado,
      cartaoNome: cartao.nome || cliente.nome
    });

    if (result.error) return res.status(502).json({ ok: false, error: result.error });

    const data = result.data || {};
    const statusFinal = String(data.status || '').toUpperCase();
    const aprovado = statusFinal === 'PAID' || statusFinal === '3' || data.status === 3;
    return res.json({ ok: true, aprovado, status: data.status, message: aprovado ? 'Pagamento aprovado!' : 'Pagamento pendente.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Erro interno ao processar cartão: ' + error.message });
  }
});

app.post('/api/pagamento/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    const referencia = body.reference_id || body.numero || body.referenceId || body.order?.reference_id || '';
    const status = (body.status || body.data?.status || '').toUpperCase();
    const orderId = body.order_id || body.orderId || body.data?.id || '';
    const pedido = referencia ? await findPedidoByReference(referencia) : null;

    if (pedido && (status === 'PAID' || status === '3')) {
      await atualizarPedidoPorNumero(pedido.numero, { status: 'PAGO' });
      const envio = await enviarPedidoParaUpseller(pedido);
      return res.json({ ok: true, pago: true, upseller: envio });
    }

    if (orderId) {
      const cfg = await buscarConfigPagSeguro();
      const base = getPagSeguroBase(cfg);
      const orderRes = await fetch(base + '/orders/' + orderId, {
        method: 'GET',
        headers: getPagSeguroHeaders(cfg)
      });
      const data = await orderRes.json().catch(() => ({}));
      if (orderRes.ok) {
        const orderStatus = String(data.status || '').toUpperCase();
        const reference = data.reference_id || data.referenceId || '';
        const isPaid = orderStatus === 'PAID' || orderStatus === '3';
        if (isPaid && reference) {
          await atualizarPedidoPorNumero(reference, { status: 'PAGO' });
          const pedidoPago = await findPedidoByReference(reference);
          if (pedidoPago) {
            await enviarPedidoParaUpseller(pedidoPago);
          }
          return res.json({ ok: true, pago: true, reference });
        }
      }
    }

    res.json({ ok: true, pago: false });
  } catch (err) {
    res.status(500).json({ error: 'Erro no webhook.' });
  }
});

app.post('/api/webhooks/pagseguro', async (req, res) => {
  try {
    const body = req.body || {};
    const orderId = body.order_id || body.orderId || body.data?.id || body.id || '';
    if (!orderId) {
      return res.status(400).json({ ok: false, error: 'order_id obrigatório para validação do webhook.' });
    }

    const cfg = await buscarConfigPagSeguro();
    if (!cfg.ativo) {
      return res.status(403).json({ ok: false, error: 'PagSeguro desativado no painel administrativo.' });
    }

    const base = getPagSeguroBase(cfg);
    const orderRes = await fetch(base + '/orders/' + orderId, {
      method: 'GET',
      headers: getPagSeguroHeaders(cfg)
    });
    const data = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok) {
      return res.status(502).json({ ok: false, error: data.message || 'Erro ao consultar PagSeguro.' });
    }

    const orderStatus = String(data.status || '').toUpperCase();
    const reference = data.reference_id || data.referenceId || '';
    const chargeStatus = String(data.charges?.[0]?.status || '').toUpperCase();
    const pago = orderStatus === 'PAID' || chargeStatus === 'PAID' || orderStatus === '3';

    if (pago && reference) {
      await atualizarPedidoPorNumero(reference, { status: 'PAGO', data_bling_sync: new Date().toISOString() });
      const pedidoPago = await findPedidoByReference(reference);
      if (pedidoPago) {
        const envio = await enviarPedidoParaUpseller(pedidoPago);
        if (envio.ok && envio.blingId) {
          await atualizarPedidoPorNumero(reference, { bling_id: envio.blingId });
        }
      }
      return res.json({ ok: true, pago: true, reference, status: 'PAGO', bling_sync: true });
    }

    return res.json({ ok: true, pago: false, reference, status: orderStatus || chargeStatus || 'PENDING' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Erro no webhook PagSeguro: ' + error.message });
  }
});

// Helper: Formata e filtra opções de frete
function extrairTextoSeguro(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (Array.isArray(valor)) {
    return valor.map(v => extrairTextoSeguro(v)).filter(Boolean).join(' ');
  }
  if (typeof valor === 'object') {
    const candidatos = [
      valor.name, valor.nome, valor.title, valor.label, valor.code, valor.codigo,
      valor.company, valor.courier, valor.transportadora, valor.service,
      valor.value, valor.description, valor.text
    ];
    for (const item of candidatos) {
      const texto = extrairTextoSeguro(item);
      if (texto && !texto.toLowerCase().includes('[object object]')) return texto;
    }
    return '';
  }
  return '';
}

function extrairListaDeOpcoesFrete(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  const chavesPossiveis = ['data', 'result', 'options', 'shipments', 'quotes', 'services', 'items', 'fretes'];
  for (const chave of chavesPossiveis) {
    if (Array.isArray(data[chave])) return data[chave];
  }

  if (data && typeof data === 'object') {
    const valores = Object.values(data);
    const arrayEncontrado = valores.find(v => Array.isArray(v));
    if (arrayEncontrado) return arrayEncontrado;
  }

  return [];
}

function formatarOpcoesFrete(data) {
  const lista = extrairListaDeOpcoesFrete(data);

  return lista
    .filter(o => {
      if (!o || o.error) return false;
      const nome = extrairTextoSeguro(o.name || o.nome || o.service || o.title || o.company || o.courier || o.transportadora || '').toLowerCase();
      if (nome.includes('mini envio')) return false;

      const preco = Number(o.price ?? o.preco ?? o.amount ?? o.value ?? o.total ?? 0);
      if (!Number.isFinite(preco) || preco <= 0) return false;
      return true;
    })
    .map(o => {
      const nomeEmpresa = extrairTextoSeguro(o.company || o.transportadora || o.courier || o.provider || o.company_name || o.companyName);
      const nomeServico = extrairTextoSeguro(o.name || o.nome || o.service || o.title || o.label || o.code || o.codigo || o.delivery_type || o.type);
      let nomeFinal = nomeServico || nomeEmpresa || 'Entrega Padrão';
      if (nomeEmpresa && nomeServico && nomeServico.toLowerCase() !== nomeEmpresa.toLowerCase()) {
        nomeFinal = `${nomeEmpresa} ${nomeServico}`.trim();
      }
      if (nomeFinal.toLowerCase().includes('[object object]')) {
        nomeFinal = 'Entrega Padrão';
      }

      const tempoEntrega = Number(o.delivery_time ?? o.prazo ?? o.deliveryTime ?? o.days ?? 0);
      let prazoFinal = '5 dias úteis';
      if (Number.isFinite(tempoEntrega) && tempoEntrega > 0) {
        prazoFinal = tempoEntrega === 1 ? '1 dia útil' : `${tempoEntrega} dias úteis`;
      } else if (typeof o.prazo === 'string' && o.prazo.trim()) {
        prazoFinal = o.prazo.trim();
      }

      const precoFinal = Number(o.price ?? o.preco ?? o.amount ?? o.value ?? o.total ?? 0);

      return {
        nome: nomeFinal || 'Entrega Padrão',
        preco: Number(precoFinal || 0),
        prazo: prazoFinal
      };
    });
}

// ---------- API: ENVIO (Melhor Envio) ----------
app.post('/api/frete/calcular', async (req, res) => {
  const { cepDestino, itens } = req.body || {};
  if (!cepDestino) return res.status(400).json({ error: 'CEP de destino obrigatório.' });

  try {
    let cfg = await getConfigChave('melhorenvio_config', {});
    
    // Usa variáveis de ambiente se não houver configuração no banco
    let token = cfg.token || process.env.MELHOR_ENVIO_TOKEN || '';
    let modo = cfg.modo || process.env.MELHOR_ENVIO_MODO || 'sandbox';
    
    const adminPerfil = await buscarAdmin().catch(() => null);
    let cepOrigem = (cfg.cepOrigem || process.env.MELHOR_ENVIO_CEP || '').replace(/\D/g, '');
    if (adminPerfil && adminPerfil.endereco) {
      const end = parseJsonArray(adminPerfil.endereco, {});
      const cepLoja = (end.cep || '').replace(/\D/g, '');
      if (cepLoja.length === 8) cepOrigem = cepLoja;
    }

    if (!token || !cepOrigem) {
      const faltantes = [];
      if (!token) faltantes.push('MELHOR_ENVIO_TOKEN');
      if (!cepOrigem) faltantes.push('MELHOR_ENVIO_CEP');
      if (!modo) faltantes.push('MELHOR_ENVIO_MODO');

      console.warn(`[Melhor Envio] Demo mode ativado. Variáveis ausentes: ${faltantes.join(', ')}`);
      return res.json({
        ok: true,
        demo: true,
        opcoes: [{ nome: 'PAC', preco: 14.90, prazo: '5 dias úteis' }, { nome: 'SEDEX', preco: 24.90, prazo: '2 dias úteis' }],
        message: `Melhor Envio não configurado. Faltam: ${faltantes.join(', ')}. Usando valores de demonstração.`
      });
    }

    const base = modo === 'produção' ? 'https://api.melhorenvio.com.br' : 'https://sandbox.melhorenvio.com.br';
    const resApi = await fetch(base + '/api/v2/me/shipment/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        from: { postal_code: cepOrigem },
        to: { postal_code: String(cepDestino).replace(/\D/g, '') },
        products: (itens || []).map(i => ({
          id: i.id || '',
          width: Number(i.width || 16),
          height: Number(i.height || 4),
          length: Number(i.length || 25),
          weight: Number(i.weight || 0.3),
          insurance_value: Number(i.preco || 0),
          quantity: Number(i.quantidade || 1)
        })),
        options: { receipt: false, own_hand: false }
      })
    });
    const data = await resApi.json().catch(() => ({}));
    if (!resApi.ok) return res.status(502).json({ error: data.message || 'Erro ao calcular frete.' });
    
    // Formata e filtra as opções
    const opcoes = formatarOpcoesFrete(data);
    return res.json({ ok: true, opcoes: opcoes.length > 0 ? opcoes : [], demo: false });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao calcular frete: ' + error.message });
  }
});

app.post('/api/envio/calcular', async (req, res) => {
  const { cepDestino, itens } = req.body || {};
  if (!cepDestino) return res.status(400).json({ error: "CEP de destino obrigatório." });
  try {
    let cfg = await getConfigChave('melhorenvio_config', {});

    // Usa variáveis de ambiente se não houver configuração no banco
    let token = cfg.token || process.env.MELHOR_ENVIO_TOKEN || '';
    let modo = cfg.modo || process.env.MELHOR_ENVIO_MODO || 'sandbox';

    // Fonte de origem do frete: prioriza o endereço da loja (perfil do admin).
    // Se o admin preencheu o endereço da loja, o CEP dele é usado como origem.
    const adminPerfil = await buscarAdmin().catch(() => null);
    let cepOrigem = cfg.cepOrigem || process.env.MELHOR_ENVIO_CEP || '';
    if (adminPerfil && adminPerfil.endereco) {
      const end = parseJsonArray(adminPerfil.endereco, {});
      const cepLoja = (end.cep || '').replace(/\D/g, '');
      if (cepLoja.length === 8) cepOrigem = cepLoja;
    }

    if (!token || !cepOrigem) {
      const faltantes = [];
      if (!token) faltantes.push('MELHOR_ENVIO_TOKEN');
      if (!cepOrigem) faltantes.push('MELHOR_ENVIO_CEP');
      if (!modo) faltantes.push('MELHOR_ENVIO_MODO');

      console.warn(`[Melhor Envio] Demo mode ativado. Variáveis ausentes: ${faltantes.join(', ')}`);
      return res.json({
        ok: true, demo: true,
        opcoes: [{ nome: 'PAC', preco: 14.90, prazo: '5 dias úteis' }, { nome: 'SEDEX', preco: 24.90, prazo: '2 dias úteis' }],
        message: `Melhor Envio não configurado. Faltam: ${faltantes.join(', ')}. Usando valores de demonstração.`
      });
    }
    const base = modo === 'produção' ? 'https://api.melhorenvio.com.br' : 'https://sandbox.melhorenvio.com.br';
    const resApi = await fetch(base + '/api/v2/me/shipment/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        from: { postal_code: cepOrigem },
        to: { postal_code: cepDestino },
        products: (itens || []).map(i => ({ id: i.id || '', width: i.width || 16, height: i.height || 4, length: i.length || 25, weight: i.weight || 0.3, insurance_value: i.preco || 0, quantity: i.quantidade || 1 })),
        options: { receipt: false, own_hand: false }
      })
    });
    const data = await resApi.json().catch(() => ({}));
    if (!resApi.ok) return res.status(502).json({ error: data.message || "Erro ao calcular frete." });
    
    // Formata e filtra as opções
    const opcoes = formatarOpcoesFrete(data);
    return res.json({ ok: true, opcoes: opcoes.length > 0 ? opcoes : [] });
  } catch (err) {
    res.status(500).json({ error: "Erro ao calcular frete: " + err.message });
  }
});

// ---------- API: EXPEDIÇÃO (Bling) ----------
app.post('/api/bling/pedido', async (req, res) => {
  const pedido = req.body;
  if (!pedido || !pedido.numero || !pedido.cliente) return res.status(400).json({ error: "Dados do pedido incompletos." });
  try {
    const cfg = await getConfigChave('bling_config', {});
    if (!cfg.apiKey || !cfg.apiToken) {
      return res.json({ ok: false, demo: true, message: "Bling não configurado. Pedido não enviado para ERP/expedição." });
    }

    const resultado = await enviarPedidoParaBling(pedido);
    if (!resultado.ok) return res.status(502).json({ ok: false, error: resultado.motivo || 'Erro ao criar pedido no Bling.' });
    res.json({ ok: true, bling: resultado.data });
  } catch (err) {
    res.status(500).json({ error: "Erro ao enviar ao Bling: " + err.message });
  }
});

app.post('/api/upseller/pedido', async (req, res) => {
  return app._router.handle ? res.json({ ok: true, notice: 'Compatibilidade: o sistema agora usa Bling.', bling: await enviarPedidoParaBling(req.body || {}) }) : res.json({ ok: true, notice: 'Compatibilidade: o sistema agora usa Bling.' });
});

app.post('/api/bling/reenviar/:numeroPedido', exigirAdmin, async (req, res) => {
  const numeroPedido = req.params.numeroPedido;
  try {
    const pedido = await buscarPedidoPorNumero(numeroPedido);
    if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const resultado = await enviarPedidoParaBling(pedido);
    if (!resultado.ok) return res.status(502).json({ error: resultado.motivo || 'Erro ao enviar ao Bling.' });
    
    const blingId = String(resultado.blingId || pedido.bling_id || '').trim();
    if (blingId) {
      await atualizarPedidoPorNumero(numeroPedido, { bling_id: blingId, data_bling_sync: new Date().toISOString() });
    }
    
    return res.json({ ok: true, message: 'Pedido reenviado ao Bling com sucesso!', bling: resultado.data, blingId });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao reenviar: ' + err.message });
  }
});

app.get('/api/bling/test', exigirAdmin, async (req, res) => {
  try {
    const oauth = await getBlingOauthConfig();
    const testResults = {
      oauth_conectado: !!oauth.connected && !!oauth.accessToken,
      token_valido: !!oauth.accessToken,
      token_expira_em: oauth.expiresAt ? new Date(oauth.expiresAt).toISOString() : null
    };
    
    if (!oauth.accessToken) {
      return res.json({ ok: false, erro: 'Token do Bling não encontrado. Faça login OAuth primeiro.', diagnosticos: testResults });
    }
    
    // Testa consulta de produtos
    const produtosTest = await consultarProdutosBling();
    testResults.produtos_api = produtosTest.ok ? 'OK' : produtosTest.error;
    
    // Testa consulta de pedidos
    const pedidosTest = await consultarBlingApi('pedidos');
    testResults.pedidos_api = pedidosTest.ok ? 'OK' : pedidosTest.error;
    
    // Testa consulta de estoque
    const estoqueTest = await consultarBlingApi('estoque');
    testResults.estoque_api = estoqueTest.ok ? 'OK' : estoqueTest.error;
    
    res.json({ 
      ok: produtosTest.ok && pedidosTest.ok && estoqueTest.ok,
      mensagem: produtosTest.ok && pedidosTest.ok && estoqueTest.ok ? 'Bling conectado e respondendo corretamente' : 'Alguns endpoints do Bling falharam',
      diagnosticos: testResults,
      detalhes: {
        produtos_encontrados: produtosTest.ok ? extrairListaProdutosBling(produtosTest.data).length : 0,
        pedidos_encontrados: pedidosTest.ok ? extrairListaProdutosBling(pedidosTest.data).length : 0
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, erro: 'Erro ao testar Bling: ' + err.message });
  }
});

app.post('/api/webhooks/bling', async (req, res) => {
  try {
    const body = req.body || {};
    const order_number = body.order_number || body.numero || body.numeroPedido || body.orderNumber;
    const tracking_number = body.tracking_number || body.codigoRastreio || body.trackingNumber || body.rastreio;
    const status = body.status || body.estado || 'Enviado';
    if (!order_number) return res.status(400).json({ ok: false, error: 'order_number obrigatório' });

    const pedido = await buscarPedidoPorNumero(order_number);
    if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });

    const statusMap = { pending: 'Em Preparação', processing: 'Em Preparação', shipped: 'Enviado', delivered: 'Entregue', cancelled: 'Cancelado', sent: 'Enviado' };
    const statusMio = statusMap[String(status).toLowerCase()] || String(status || 'Enviado');
    await atualizarPedidoPorNumero(order_number, {
      bling_status: String(status), bling_tracking: tracking_number || null,
      data_bling_sync: new Date().toISOString(), status: statusMio, data_envio: body.data_envio || null
    });

    if (tracking_number && !pedido.codigo_rastreamento) {
      await atualizarPedidoPorNumero(order_number, { codigo_rastreamento: tracking_number });
    }

    res.json({ ok: true, message: 'Webhook Bling recebido e processado' });
  } catch (err) {
    console.error('Erro ao processar webhook Bling:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/bling/expeditions', exigirAdmin, async (req, res) => {
  try {
    const { data: pedidos, error } = await supabaseAdmin.from('pedidos')
      .select('numero, cliente, itens, status, total, codigo_rastreamento, bling_tracking, bling_status, data_envio')
      .in('status', ['Em Preparação', 'Enviado']).order('data', { ascending: false });
    if (error) throw error;

    const expeditions = pedidos.map(p => {
      const cli = parseJsonArray(p.cliente, {});
      return {
        numero: p.numero,
        cliente_nome: cli.nome || 'N/A',
        cliente_email: cli.email || 'N/A',
        status_mio: p.status,
        status_upseller: p.bling_status,
        tracking_mio: p.codigo_rastreamento,
        tracking_upseller: p.bling_tracking,
        data_envio: p.data_envio,
        total: p.total
      };
    });

    res.json({ ok: true, expeditions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- API: AUTENTICAÇÃO ADMIN ----------
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { email, senha } = req.body || {};
  const emailBusca = String(email || '').trim().toLowerCase();
  try {
    const admin = await buscarAdmin();
    const senhaOk = admin ? await compararSenha(senha || '', admin.senha_hash) : false;
    if (!admin || String(admin.email || '').trim().toLowerCase() !== emailBusca || !senhaOk) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiraEm = Date.now() + ADMIN_SESSION_TTL_MS;
    await salvarSessaoAdmin(token, admin.email, expiraEm);

    res.cookie('admin_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: ADMIN_SESSION_TTL_MS,
      path: '/'
    });

    res.json({ email: admin.email });
  } catch (err) {
    res.status(500).json({ error: "Erro no login." });
  }
});

app.post('/api/admin/logout', async (req, res) => {
  const token = getAdminTokenFromRequest(req);
  await limparSessaoAdmin(token);
  res.clearCookie('admin_token', { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/' });
  res.json({ ok: true });
});

// Verifica se um token de admin é válido (usado ao restaurar sessão no painel)
app.get('/api/admin/verificar', async (req, res) => {
  const token = getAdminTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ valid: false });
  }

  const sessao = await carregarSessaoAdmin(token);
  if (!sessao) {
    return res.status(401).json({ valid: false });
  }

  sessao.expiraEm = Date.now() + ADMIN_SESSION_TTL_MS;
  await salvarSessaoAdmin(token, sessao.email, sessao.expiraEm);
  res.json({ valid: true, email: sessao.email });
});

app.put('/api/admin/conta', exigirAdmin, async (req, res) => {
  const { email, senhaAtual, novaSenha } = req.body || {};
  try {
    const admin = await buscarAdmin();
    if (!admin) {
      return res.status(404).json({ error: 'Administrador não encontrado.' });
    }

    const novoEmail = typeof email === 'string' ? email.trim().toLowerCase() : admin.email;
    if (novoEmail && !/^\S+@\S+\.\S+$/.test(novoEmail)) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }

    if (senhaAtual || novaSenha) {
      const senhaOk = await compararSenha(String(senhaAtual || ''), admin.senha_hash);
      if (!senhaOk) {
        return res.status(401).json({ error: 'Senha atual incorreta.' });
      }
      if (!novaSenha || String(novaSenha).length < 6) {
        return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
      }
    }

    const updates = [];
    const values = [];
    if (novoEmail && novoEmail !== admin.email) {
      updates.push('email = ?');
      values.push(novoEmail);
    }
    if (senhaAtual && novaSenha) {
      updates.push('senha_hash = ?');
      values.push(await hashSenha(novaSenha));
    }

    if (updates.length === 0) {
      return res.json({ ok: true, message: 'Nenhuma alteração foi necessária.', email: admin.email });
    }

    const camposConta = {};
    if (novoEmail && novoEmail !== admin.email) camposConta.email = novoEmail;
    if (senhaAtual && novaSenha) camposConta.senha_hash = await hashSenha(novaSenha);
    const { error: contaError } = await supabaseAdmin.from('admin_conta').update(camposConta).eq('id', 1);
    if (contaError) throw contaError;

    const adminAtualizado = await buscarAdmin();
    const token = getAdminTokenFromRequest(req);
    if (token && adminAtualizado.email) {
      await salvarSessaoAdmin(token, adminAtualizado.email, Date.now() + ADMIN_SESSION_TTL_MS);
    }

    return res.json({ ok: true, message: 'Dados do administrador atualizados.', email: adminAtualizado.email });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao alterar dados do administrador.' });
  }
});

app.post('/api/webhooks/bling-produto', async (req, res) => {
  try {
    const body = req.body || {};
    const evento = body.evento || body.tipo || 'produto.atualizado';
    const dadosProduto = body.dados || body.produto || body.data || body;
    const produtoId = String(dadosProduto.id || dadosProduto.codigo || '').trim();

    if (!produtoId) {
      return res.status(400).json({ ok: false, error: 'Produto ID ou código obrigatório no webhook' });
    }

    console.log(`[Bling Webhook] Evento: ${evento}, Produto: ${produtoId}, Nome: ${dadosProduto.nome || 'N/A'}`);

    if (evento.includes('deletad') || evento.includes('remov')) {
      const { error } = await supabaseAdmin.from('produtos').delete().eq('bling_id', produtoId);
      if (error) throw error;
      return res.json({ ok: true, evento, operacao: 'delete', bling_id: produtoId });
    }

    const resultado = await sincronizarProdutoBlingParaSite(dadosProduto);
    return res.json({
      ok: true,
      evento,
      operacao: resultado.operacao,
      produto_id: resultado.id,
      bling_id: resultado.bling_id,
      nome: resultado.nome
    });
  } catch (err) {
    console.error('Erro ao processar webhook Bling produto:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/admin/senha', exigirAdmin, async (req, res) => {
  const { senhaAtual, novaSenha } = req.body || {};
  try {
    const admin = await buscarAdmin();
    const senhaOk = admin ? await compararSenha(senhaAtual, admin.senha_hash) : false;
    if (!senhaOk) {
      return res.status(401).json({ error: "Senha atual incorreta." });
    }
    if (!novaSenha || novaSenha.length < 6) {
      return res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres." });
    }
    const { error } = await supabaseAdmin.from('admin_conta').update({ senha_hash: await hashSenha(novaSenha) }).eq('id', 1);
    if (error) throw error;
    res.json({ ok: true, message: "Senha do administrador atualizada." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao alterar senha." });
  }
});

// ---------- API: PERFIL DO ADMIN (foto, nome, endereço da loja, CNPJ) ----------
app.get('/api/admin/perfil', exigirAdmin, async (req, res) => {
  try {
    const admin = await buscarAdmin();
    if (!admin) return res.status(404).json({ error: "Admin não encontrado." });
    admin.endereco = parseJsonArray(admin.endereco, {});
    res.json(admin);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar perfil do admin." });
  }
});

app.put('/api/admin/perfil', exigirAdmin, async (req, res) => {
  const { nome, foto, endereco, cnpj } = req.body || {};
  try {
    const admin = await buscarAdmin();
    const novoNome = nome !== undefined ? nome : admin.nome;
    const novoFoto = foto !== undefined ? foto : (admin.foto || '');
    const novoEnd = endereco !== undefined ? JSON.stringify(endereco) : admin.endereco;
    const novoCnpj = cnpj !== undefined ? cnpj : (admin.cnpj || '');
    const { error } = await supabaseAdmin.from('admin_conta').update({ nome: novoNome, foto: novoFoto, endereco: endereco !== undefined ? endereco : parseJsonArray(admin.endereco, {}), cnpj: novoCnpj }).eq('id', 1);
    if (error) throw error;
    res.json({ ok: true, message: "Perfil do administrador atualizado." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar perfil do admin." });
  }
});

// ---------- API: PRODUTOS (CRUD) ----------
app.get('/api/produtos', async (req, res) => {
  try {
    const { data: produtos, error } = await supabase
      .from('produtos')
      .select('*')
      .order('relevancia', { ascending: false });
    if (error) throw error;
    const formatados = (produtos || []).map(formatarProduto);
    res.json(formatados);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar produtos." });
  }
});

app.get('/api/produto/:id', async (req, res) => {
  try {
    const { data: produto, error } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!produto) return res.status(404).json({ error: "Produto não encontrado." });
    res.json(formatarProduto(produto));
  } catch (err) {
    res.status(500).json({ error: "Erro interno." });
  }
});

app.post('/api/produtos', exigirAdmin, async (req, res) => {
  const p = req.body;
  try {
    const produto = prepararProduto({
      nome: p.nome,
      preco: p.preco,
      precoOriginal: p.precoOriginal || null,
      estaEmPromocao: !!p.estaEmPromocao,
      textoDestaquePromo: p.textoDestaquePromo || '',
      cronometro: p.cronometro || null,
      categoria: p.categoria,
      genero: p.genero,
      imagem: p.imagem || '',
      fotos: p.fotos || (p.imagem ? [p.imagem] : []),
      cores: p.cores || [],
      tamanhos: p.tamanhos || [],
      descricao: p.descricao || '',
      estoque: p.estoque || 0,
      relevancia: p.relevancia || 0,
      data: p.data || new Date().toISOString().slice(0, 10),
      data_cadastro: new Date().toISOString()
    });
    const { data, error } = await supabaseAdmin.from('produtos').insert(produto).select('id').single();
    if (error) throw error;

    const sync = await enviarProdutoParaBling({ ...produto, id: data.id, codigo: `site-${data.id}` });
    if (sync.ok && sync.blingId) {
      await supabaseAdmin.from('produtos').update({ bling_id: String(sync.blingId) }).eq('id', data.id).select('id');
    }

    res.json({ ok: true, id: data.id, sync: sync.ok ? 'enviado-para-bling' : 'sem-sync-bling' });
  } catch (err) {
    res.status(500).json({ error: "Erro ao criar produto." });
  }
});

app.put('/api/produtos/:id', exigirAdmin, async (req, res) => {
  const p = req.body;
  try {
    const produto = prepararProduto({
      nome: p.nome,
      preco: p.preco,
      precoOriginal: p.precoOriginal || null,
      estaEmPromocao: !!p.estaEmPromocao,
      textoDestaquePromo: p.textoDestaquePromo || '',
      cronometro: p.cronometro || null,
      categoria: p.categoria,
      genero: p.genero,
      imagem: p.imagem || '',
      fotos: p.fotos || (p.imagem ? [p.imagem] : []),
      cores: p.cores || [],
      tamanhos: p.tamanhos || [],
      descricao: p.descricao || '',
      estoque: p.estoque || 0,
      relevancia: p.relevancia || 0,
      data: p.data || new Date().toISOString().slice(0, 10)
    });
    const { data, error } = await supabaseAdmin.from('produtos').update(produto).eq('id', req.params.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Produto não encontrado." });

    const sync = await enviarProdutoParaBling({ ...produto, id: data.id, codigo: `site-${data.id}` });
    if (sync.ok && sync.blingId) {
      await supabaseAdmin.from('produtos').update({ bling_id: String(sync.blingId) }).eq('id', data.id).select('id');
    }

    res.json({ ok: true, sync: sync.ok ? 'sincronizado-bling' : 'sem-sync-bling' });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar produto." });
  }
});

app.get('/api/produtos/sync/bling', exigirAdmin, async (req, res) => {
  try {
    const resposta = await consultarProdutosBling();
    if (!resposta.ok) {
      return res.status(502).json({ ok: false, error: resposta.error || 'Erro ao consultar produtos do Bling.' });
    }

    const itens = extrairListaProdutosBling(resposta.data);
    let importados = 0;
    for (const item of itens) {
      const mapped = mapearProdutoBlingParaSite(item);
      const codigoBling = String(item.id || item.codigo || '').trim();
      if (!codigoBling) continue;

      const { data: existente, error: erroBusca } = await supabaseAdmin
        .from('produtos')
        .select('id')
        .eq('bling_id', codigoBling)
        .maybeSingle();

      if (erroBusca) throw erroBusca;

      const registro = prepararProduto({
        nome: mapped.nome,
        preco: mapped.preco,
        precoOriginal: mapped.precoOriginal || null,
        estaEmPromocao: mapped.estaEmPromocao,
        textoDestaquePromo: mapped.textoDestaquePromo || '',
        cronometro: mapped.cronometro || null,
        categoria: mapped.categoria,
        genero: mapped.genero || '',
        imagem: mapped.imagem || '',
        fotos: mapped.fotos || (mapped.imagem ? [mapped.imagem] : []),
        cores: mapped.cores || [],
        tamanhos: mapped.tamanhos || [],
        descricao: mapped.descricao || '',
        estoque: mapped.estoque || 0,
        relevancia: mapped.relevancia || 0,
        data: mapped.data || new Date().toISOString().slice(0, 10),
        bling_id: codigoBling,
        data_cadastro: new Date().toISOString()
      });

      if (existente) {
        const { error: erroUpdate } = await supabaseAdmin.from('produtos').update(registro).eq('id', existente.id);
        if (erroUpdate) throw erroUpdate;
      } else {
        const { error: erroInsert } = await supabaseAdmin.from('produtos').insert(registro);
        if (erroInsert) throw erroInsert;
      }

      importados += 1;
    }

    res.json({ ok: true, importados, total: itens.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Erro ao sincronizar produtos do Bling para o site: ' + err.message });
  }
});

app.post('/api/produtos/:id/sync/bling', exigirAdmin, async (req, res) => {
  try {
    const { data: produto, error } = await supabaseAdmin.from('produtos').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!produto) return res.status(404).json({ ok: false, error: 'Produto não encontrado.' });

    const sync = await enviarProdutoParaBling({ ...produto, codigo: produto.bling_id || `site-${produto.id}` });
    if (!sync.ok) {
      return res.status(502).json({ ok: false, error: sync.motivo || 'Erro ao sincronizar produto com o Bling.' });
    }

    const blingId = String(sync.blingId || produto.bling_id || '').trim();
    if (blingId) {
      await supabaseAdmin.from('produtos').update({ bling_id: blingId }).eq('id', produto.id);
    }

    res.json({ ok: true, blingId: blingId || null, mensagem: 'Produto sincronizado com o Bling.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Erro ao sincronizar produto com o Bling: ' + err.message });
  }
});

app.delete('/api/produtos/:id', exigirAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('produtos').delete().eq('id', req.params.id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: "Produto não encontrado." });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir produto." });
  }
});

// ---------- API: PEDIDOS ----------
app.get('/api/pedidos', exigirAdmin, async (req, res) => {
  try {
    const { data: pedidos, error } = await supabaseAdmin.from('pedidos').select('*').order('id', { ascending: false });
    if (error) throw error;
    const formatados = (pedidos || []).map(formatarPedido);
    res.json(formatados);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar pedidos." });
  }
});

app.post('/api/pedidos', async (req, res) => {
  const pd = req.body;
  if (!pd || !pd.cliente || !pd.itens) return res.status(400).json({ error: "Dados do pedido inválidos." });
  try {
    const total = (pd.itens || []).reduce((acc, i) => acc + (i.preco * i.quantidade), 0) - (pd.desconto || 0) + (pd.frete || 0);
    const { error } = await supabaseAdmin.from('pedidos').insert({
      numero: pd.numero, data: pd.data || new Date().toISOString(), cliente: pd.cliente,
      endereco: pd.endereco || {}, itens: pd.itens, cupom: pd.cupom || null,
      metodo: pd.metodo || 'pix', status: pd.status || 'Aguardando Pagamento', total
    });
    if (error) throw error;
    if (pd.cupom && pd.cupom.codigo) {
      await incrementarUsoCupom(String(pd.cupom.codigo).toUpperCase().trim());
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar pedido." });
  }
});

app.get('/api/pedidos/:id/status', async (req, res) => {
  try {
    const pedido = await buscarPedidoPorNumero(req.params.id) || await buscarPedidoPorId(Number(req.params.id));
    if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    res.json({ ok: true, status: pedido.status || 'Aguardando Pagamento', numero: pedido.numero, total: pedido.total });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Erro ao consultar status do pedido.' });
  }
});

// Atualiza status de um pedido pelo número (usado no checkout ao confirmar cartão)
app.post('/api/pedidos/atualizar-status', async (req, res) => {
  const { numero, status } = req.body || {};
  if (!numero || !status) return res.status(400).json({ error: "Número e status obrigatórios." });
  try {
    await atualizarPedidoPorNumero(numero, { status });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar status." });
  }
});

app.put('/api/pedidos/:id', exigirAdmin, async (req, res) => {
  const { status, codigo_rastreamento, url_rastreamento, data_envio, data_entrega } = req.body;
  try {
    const pedido = await buscarPedidoPorId(req.params.id);
    if (!pedido) return res.status(404).json({ error: "Pedido não encontrado." });

    const atualizacoes = {};
    if (status !== undefined) atualizacoes.status = status;
    if (codigo_rastreamento !== undefined) atualizacoes.codigo_rastreamento = codigo_rastreamento;
    if (url_rastreamento !== undefined) atualizacoes.url_rastreamento = url_rastreamento;
    if (data_envio !== undefined) atualizacoes.data_envio = data_envio;
    if (data_entrega !== undefined) atualizacoes.data_entrega = data_entrega;
    if (Object.keys(atualizacoes).length === 0) {
      return res.status(400).json({ error: "Nenhum campo para atualizar." });
    }
    const pedidoAtualizado = await supabaseAdmin.from('pedidos').update(atualizacoes).eq('id', req.params.id).select('*').maybeSingle();
    if (pedidoAtualizado.error) throw pedidoAtualizado.error;
    
    // Se mudou para "Em Preparação" e ainda não foi enviado ao Bling, enviar
    if (status === 'Em Preparação' && !pedido.bling_id && !pedido.upseller_id) {
      const result = await enviarPedidoParaBling(pedidoAtualizado.data);
      if (result.ok) {
        res.json({ ok: true, bling: "Pedido enviado para ERP/expedição" });
      } else {
        res.json({ ok: true, aviso: "Pedido atualizado, mas não foi enviado ao Bling: " + result.motivo });
      }
    } else {
      res.json({ ok: true });
    }
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar pedido." });
  }
});

// ---------- API: MEUS PEDIDOS (cliente, por e-mail) ----------
// Usado pela página acompanhar-pedido.html para listar pedidos reais do cliente.
app.post('/api/pedidos/meus', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Informe o e-mail usado no pedido." });
  const token = getClientToken(req);
  const sessao = await carregarSessaoCliente(token);
  if (!sessao) {
    return res.status(401).json({ error: "Faça login para consultar seus pedidos." });
  }
  try {
    const { data: pedidos, error } = await supabaseAdmin.from('pedidos').select('*').order('id', { ascending: false });
    if (error) throw error;
    const emailBusca = String(email).toLowerCase().trim();
    if (sessao.email !== emailBusca) return res.status(403).json({ error: "Acesso não autorizado." });
    const meus = pedidos.filter(pd => {
      const cli = parseJsonArray(pd.cliente, {});
      return String(cli.email || '').toLowerCase().trim() === emailBusca;
    });
    const formatados = meus.map(pd => ({
      numero: pd.numero,
      data: pd.data,
      status: pd.status,
      metodo: pd.metodo,
      total: pd.total,
      itens: parseJsonArray(pd.itens, []),
      cupom: parseJsonArray(pd.cupom, null)
    }));
    res.json({ ok: true, pedidos: formatados, email: emailBusca });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar pedidos." });
  }
});

// ---------- API: CLIENTES ----------
app.get('/api/clientes', exigirAdmin, async (req, res) => {
  try {
    const { data: clientes, error } = await supabaseAdmin.from('clientes').select('id, nome, email, cpf, telefone, endereco, foto, whatsapp_ok, aceitou_termos, data_cadastro').order('id', { ascending: false });
    if (error) throw error;
    const formatados = (clientes || []).map(formatarCliente);
    res.json(formatados);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar clientes." });
  }
});

app.post('/api/clientes', async (req, res) => {
  const c = req.body;
  if (!c || !c.email || !c.nome || !c.senha || c.senha.length < 6) {
    return res.status(400).json({ error: "Dados de cliente inválidos. Senha deve ter ao menos 6 caracteres." });
  }
  try {
    const emailBusca = c.email.toLowerCase().trim();
    const existe = await buscarClientePorEmail(emailBusca);
    if (existe) {
      const { error } = await supabaseAdmin.from('clientes').update({ nome: c.nome, cpf: c.cpf || '', telefone: c.telefone || '', endereco: c.endereco || {}, foto: c.foto || '', whatsapp_ok: !!c.whatsapp_ok, aceitou_termos: !!c.aceitou_termos }).eq('email', emailBusca);
      if (error) throw error;
      return res.json({ ok: true, novo: false });
    }
    const { error } = await supabaseAdmin.from('clientes').insert({
      nome: c.nome, email: emailBusca, cpf: c.cpf || '', telefone: c.telefone || '', senha: await hashSenha(c.senha),
      endereco: c.endereco || {}, foto: c.foto || '', whatsapp_ok: !!c.whatsapp_ok, aceitou_termos: !!c.aceitou_termos
    });
    if (error) throw error;
    res.json({ ok: true, novo: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar cliente." });
  }
});

// ---------- API: EXCLUSÃO DE CONTA DE CLIENTE ----------
// Exclui a conta definitivamente do banco de dados. Requer token ou senha para confirmar.
app.delete('/api/clientes', async (req, res) => {
  const { email, senha } = req.body || {};
  let emailBusca = email ? email.toLowerCase().trim() : null;
  const token = getClientToken(req);
  const sessao = token ? await carregarSessaoCliente(token) : null;
  if (sessao) {
    sessao.expiraEm = Date.now() + 15 * 60 * 1000;
    await salvarSessaoCliente(token, sessao.email, sessao.expiraEm);
    emailBusca = sessao.email;
  }
  if (!emailBusca) return res.status(400).json({ error: "E-mail e senha são obrigatórios para excluir a conta." });
  try {
    const cliente = await buscarClientePorEmail(emailBusca);
    if (!cliente) return res.status(404).json({ error: "Conta não encontrada." });
    if (!token) {
      const senhaOk = await compararSenha(senha, cliente.senha);
      if (!senhaOk) {
        return res.status(401).json({ error: "Senha incorreta. Não foi possível excluir a conta." });
      }
    }
    const { error } = await supabaseAdmin.from('clientes').delete().eq('email', emailBusca);
    if (error) throw error;
    if (token) await supabaseAdmin.from('cliente_sessoes').delete().eq('token_hash', crypto.createHash('sha256').update(token).digest('hex'));
    res.json({ ok: true, message: "Conta excluída com sucesso." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir a conta." });
  }
});

// ---------- API: CUPONS ----------
app.get('/api/cupons', exigirAdmin, async (req, res) => {
  try {
    const { data: cupons, error } = await supabaseAdmin.from('cupons').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(cupons);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar cupons." });
  }
});

// ---------- API: AVALIAÇÕES (votação/aprovação de produtos) ----------
// As avaliações são salvas no banco e só aparecem publicamente quando aprovadas.
app.get('/api/avaliacoes', async (req, res) => {
  try {
    const produtoId = req.query.produto_id;
    let query = supabaseAdmin.from('avaliacoes').select('id, produto_id, nome, nota, comentario, foto, data, status').eq('status', 'aprovado').order('id', { ascending: false });
    if (produtoId) query = query.eq('produto_id', produtoId);
    const { data: rows, error } = await query;
    if (error) throw error;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar avaliações." });
  }
});

app.post('/api/avaliacoes', async (req, res) => {
  const a = req.body || {};
  if (!a.produto_id || !a.nome || !a.nota) {
    return res.status(400).json({ error: "Produto, nome e nota são obrigatórios." });
  }
  try {
    const nota = Math.max(1, Math.min(5, parseInt(a.nota) || 5));
    const { error } = await supabaseAdmin.from('avaliacoes').insert({ produto_id: a.produto_id, nome: String(a.nome).slice(0, 60), nota, comentario: String(a.comentario || '').slice(0, 500), foto: a.foto || '', data: new Date().toISOString(), status: 'pendente', data_cadastro: new Date().toISOString() });
    if (error) throw error;
    res.json({ ok: true, message: "Avaliação enviada. Aguardando aprovação." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar avaliação." });
  }
});

// Endpoints de moderação de avaliações (admin)
app.get('/api/avaliacoes/todas', exigirAdmin, async (req, res) => {
  try {
    const { data: rows, error } = await supabaseAdmin.from('avaliacoes').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar avaliações." });
  }
});

app.put('/api/avaliacoes/:id/status', exigirAdmin, async (req, res) => {
  const { status } = req.body || {};
  const valido = ['aprovado', 'pendente', 'rejeitado'];
  if (!valido.includes(status)) return res.status(400).json({ error: "Status inválido." });
  try {
    const { error } = await supabaseAdmin.from('avaliacoes').update({ status }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar avaliação." });
  }
});

app.delete('/api/avaliacoes/:id', exigirAdmin, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('avaliacoes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir avaliação." });
  }
});

// ---------- API: CONFIGURAÇÃO DO SITE ----------
app.get('/api/config', async (req, res) => {
  try {
    const config = await getConfigChave('site_config', {});
    const banners = await carregarBanners();
    res.json({ ...config, ...banners });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar configurações." });
  }
});

app.put('/api/config', exigirAdmin, async (req, res) => {
  try {
    await dbReady;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Configuração inválida.' });
    }
    const { carrossel, bannersGrelha, bannerIntermediario, ...configSemBanners } = req.body;
    await salvarBanners({ carrossel, bannersGrelha, bannerIntermediario });
    await setConfigChave('site_config', configSemBanners);
    const salva = { ...(await getConfigChave('site_config', {})), ...(await carregarBanners()) };
    res.json({ ok: true, config: salva });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar configurações." });
  }
});

// ---------- API: ESTATÍSTICAS ----------
app.get('/api/estatisticas', exigirAdmin, async (req, res) => {
  try {
    const { data: pedidos, error: pedidosError } = await supabaseAdmin.from('pedidos').select('*');
    if (pedidosError) throw pedidosError;
    const vendas = pedidos.filter(p => p.status !== 'Cancelado' && p.status !== 'Aguardando Pagamento');
    const faturamento = vendas.reduce((acc, p) => acc + (p.total || 0), 0);
    // Vendas por produto
    const porProduto = {};
    vendas.forEach(p => {
      const itens = parseJsonArray(p.itens, []);
      itens.forEach(i => {
        if (!porProduto[i.nome]) porProduto[i.nome] = { qtd: 0, total: 0 };
        porProduto[i.nome].qtd += i.quantidade;
        porProduto[i.nome].total += i.preco * i.quantidade;
      });
    });
    // Vendas por categoria
    const { data: produtos, error: produtosError } = await supabase.from('produtos').select('nome, categoria');
    if (produtosError) throw produtosError;
    const catMap = {};
    (produtos || []).forEach(pr => { catMap[pr.nome] = pr.categoria; });
    const porCategoria = {};
    vendas.forEach(p => {
      const itens = parseJsonArray(p.itens, []);
      itens.forEach(i => {
        const cat = catMap[i.nome] || 'outros';
        if (!porCategoria[cat]) porCategoria[cat] = { qtd: 0, total: 0 };
        porCategoria[cat].qtd += i.quantidade;
        porCategoria[cat].total += i.preco * i.quantidade;
      });
    });
    // Série temporal
    const porDia = {};
    vendas.forEach(p => {
      const dia = (p.data || '').slice(0, 10);
      if (!porDia[dia]) porDia[dia] = 0;
      porDia[dia] += p.total || 0;
    });
    res.json({
      totalPedidos: pedidos.length,
      totalClientes: (await supabaseAdmin.from('clientes').select('id', { count: 'exact', head: true })).count || 0,
      faturamento,
      porProduto,
      porCategoria,
      porDia
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao calcular estatísticas." });
  }
});

// ---------- ROTAS DE PÁGINAS ----------
const pages = [
  { route: '/', file: 'index.html' },
  { route: '/admin', file: 'admin.html' },
  { route: '/checkout', file: 'checkout.html' },
  { route: '/sobre', file: 'sobre.html' },
  { route: '/login', file: 'login.html' },
  { route: '/login-membro', file: 'login-membro.html' },
  { route: '/perfil', file: 'perfil.html' },
  { route: '/cupom', file: 'cupom.html' },
  { route: '/produto', file: 'produto.html' },
  { route: '/politicas', file: 'politicas.html' },
  { route: '/privacidade', file: 'privacidade.html' },
  { route: '/fale-conosco', file: 'fale-conosco.html' },
  { route: '/acompanhar-pedido', file: 'acompanhar-pedido.html' }
];
pages.forEach(p => {
  app.get(p.route, (req, res) => res.sendFile(path.join(__dirname, 'public', p.file)));
});

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>404 | MIO</title>
    <script src="https://cdn.tailwindcss.com"></script></head>
    <body class="bg-zinc-950 text-white flex flex-col items-center justify-center h-screen font-sans">
      <h1 class="text-6xl font-black text-amber-400">404</h1>
      <p class="text-zinc-400 mt-4">A página que você procura sumiu no asfalto.</p>
      <a href="/" class="mt-8 border border-white px-6 py-2 uppercase text-xs font-bold hover:bg-white hover:text-black transition">Voltar para a Loja</a>
    </body></html>
  `);
});

dbReady.then(() => app.listen(PORT, () => {
  console.log(`
  ███╗   ███╗██╗ ██████╗ 
  ████╗ ████║██║██╔═══██╗
  ██╔████╔██║██║██║   ██║
  ██║╚██╔╝██║██║██║   ██║
  ██║ ╚═╝ ██║██║╚██████╔╝
  ╚═╝     ╚═╝╚═╝ ╚═════╝ 
  Servidor MIO Online: http://localhost:${PORT}
  `);
})).catch((err) => {
  console.error('Falha ao inicializar o banco de dados:', err);
  process.exitCode = 1;
});
