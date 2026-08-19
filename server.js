import express from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

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

// --- SESSÕES ADMIN EM MEMÓRIA (tokens) ---
// Tokens aleatórios de 32 bytes com expiração (15 min de inatividade).
const ADMIN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias para manter o admin logado
const sessaoAdmin = new Map(); // token -> { email, expiraEm }
const sessaoCliente = new Map(); // token -> { email, expiraEm }

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

// --- TOKENS DE CSRF para sessões não-admin ---
// Guarda tokens por endereço de e-mail/CPF temporário. Simples o suficiente
// para bloquear POST forjados em formulários públicos.
const csrfTokens = new Map(); // clientToken -> expiraEm

function gerarTokenCSRF() {
  return crypto.randomBytes(24).toString('hex');
}

async function salvarSessaoAdmin(token, email, expiraEm) {
  if (!token || !email) return;
  sessaoAdmin.set(token, { email, expiraEm });
  if (db) {
    await db.run(
      `INSERT INTO admin_sessoes (token, email, expira_em) VALUES (?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET email = excluded.email, expira_em = excluded.expira_em`,
      [token, email, expiraEm]
    );
  }
}

async function carregarSessaoAdmin(token) {
  if (!token) return null;
  let sessao = sessaoAdmin.get(token);
  if (!sessao && db) {
    const row = await db.get('SELECT email, expira_em FROM admin_sessoes WHERE token = ?', [token]);
    if (row) {
      sessao = { email: row.email, expiraEm: row.expira_em };
      sessaoAdmin.set(token, sessao);
    }
  }
  if (!sessao) return null;
  if (sessao.expiraEm < Date.now()) {
    sessaoAdmin.delete(token);
    if (db) await db.run('DELETE FROM admin_sessoes WHERE token = ?', [token]);
    return null;
  }
  return sessao;
}

async function limparSessaoAdmin(token) {
  if (!token) return;
  sessaoAdmin.delete(token);
  if (db) await db.run('DELETE FROM admin_sessoes WHERE token = ?', [token]);
}

function exigirCliente(req, res, next) {
  const token = req.headers['x-client-token'];
  if (!token || !sessaoCliente.has(token)) {
    return res.status(401).json({ error: "Não autenticado. Faça login." });
  }
  const sessao = sessaoCliente.get(token);
  if (sessao.expiraEm < Date.now()) {
    sessaoCliente.delete(token);
    return res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
  }
  sessao.expiraEm = Date.now() + 15 * 60 * 1000;
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
let db;
(async () => {
  db = await open({
    filename: './database.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      preco REAL,
      precoOriginal REAL,
      estaEmPromocao BOOLEAN,
      textoDestaquePromo TEXT,
      cronometro TEXT,
      categoria TEXT,
      genero TEXT,
      imagem TEXT,
      fotos TEXT,
      cores TEXT,
      tamanhos TEXT,
      descricao TEXT,
      estoque INTEGER,
      relevancia INTEGER,
      data TEXT,
      data_cadastro DATE
    );

    CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT,
      data TEXT,
      cliente TEXT,
      endereco TEXT,
      itens TEXT,
      cupom TEXT,
      metodo TEXT,
      status TEXT,
      total REAL,
      frete_modalidade TEXT,
      frete_codigo TEXT,
      frete_valor REAL,
      frete_prazo TEXT,
      frete_origem TEXT,
      frete_detalhes TEXT
    );

CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      email TEXT UNIQUE,
      cpf TEXT,
      telefone TEXT,
      senha TEXT,
      endereco TEXT,
      foto TEXT,
      whatsapp_ok BOOLEAN DEFAULT 0,
      aceitou_termos BOOLEAN DEFAULT 0,
      data_cadastro DATE
    );

    CREATE TABLE IF NOT EXISTS cupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE,
      tipo TEXT,
      valor REAL,
      limiteUso INTEGER,
      usos INTEGER,
      validade TEXT,
      ativo BOOLEAN
    );

    CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      valor TEXT
    );

CREATE TABLE IF NOT EXISTS admin_conta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT,
      senha_hash TEXT,
      nome TEXT,
      foto TEXT,
      endereco TEXT,
      cnpj TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_sessoes (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expira_em INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS avaliacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER,
      nome TEXT,
      nota INTEGER,
      comentario TEXT,
      foto TEXT,
      data TEXT,
      status TEXT DEFAULT 'pendente',
      data_cadastro DATE
    );
  `);

// Migração: adiciona colunas de produtos que podem faltar em bancos antigos
  const colsProdutos = await db.all(`PRAGMA table_info(produtos)`);
  const nomesProdutos = colsProdutos.map(c => c.name);
  if (!nomesProdutos.includes('precoOriginal')) await db.exec(`ALTER TABLE produtos ADD COLUMN precoOriginal REAL`);
  if (!nomesProdutos.includes('estaEmPromocao')) await db.exec(`ALTER TABLE produtos ADD COLUMN estaEmPromocao BOOLEAN`);
  if (!nomesProdutos.includes('textoDestaquePromo')) await db.exec(`ALTER TABLE produtos ADD COLUMN textoDestaquePromo TEXT`);
  if (!nomesProdutos.includes('cronometro')) await db.exec(`ALTER TABLE produtos ADD COLUMN cronometro TEXT`);
  if (!nomesProdutos.includes('cores')) await db.exec(`ALTER TABLE produtos ADD COLUMN cores TEXT`);
  if (!nomesProdutos.includes('tamanhos')) await db.exec(`ALTER TABLE produtos ADD COLUMN tamanhos TEXT`);
  if (!nomesProdutos.includes('data')) await db.exec(`ALTER TABLE produtos ADD COLUMN data TEXT`);

  // Migração: adiciona colunas de perfil do admin se ainda não existirem
  const colsAdmin = await db.all(`PRAGMA table_info(admin_conta)`);
  const nomesAdmin = colsAdmin.map(c => c.name);
  if (!nomesAdmin.includes('nome')) await db.exec(`ALTER TABLE admin_conta ADD COLUMN nome TEXT`);
  if (!nomesAdmin.includes('foto')) await db.exec(`ALTER TABLE admin_conta ADD COLUMN foto TEXT`);
  if (!nomesAdmin.includes('endereco')) await db.exec(`ALTER TABLE admin_conta ADD COLUMN endereco TEXT`);
  if (!nomesAdmin.includes('cnpj')) await db.exec(`ALTER TABLE admin_conta ADD COLUMN cnpj TEXT`);

// Migração: adiciona colunas de consentimento/foto se ainda não existirem
  const colsClientes = await db.all(`PRAGMA table_info(clientes)`);
  const nomesCols = colsClientes.map(c => c.name);
  if (!nomesCols.includes('whatsapp_ok')) {
    await db.exec(`ALTER TABLE clientes ADD COLUMN whatsapp_ok BOOLEAN DEFAULT 0`);
  }
  if (!nomesCols.includes('aceitou_termos')) {
    await db.exec(`ALTER TABLE clientes ADD COLUMN aceitou_termos BOOLEAN DEFAULT 0`);
  }

  const colunasPedidos = await db.all(`PRAGMA table_info(pedidos)`);
  const nomesPedidos = new Set(colunasPedidos.map(c => c.name));
  const camposPedido = [
    ['frete_modalidade', 'TEXT'],
    ['frete_codigo', 'TEXT'],
    ['frete_valor', 'REAL'],
    ['frete_prazo', 'TEXT'],
    ['frete_origem', 'TEXT'],
    ['frete_detalhes', 'TEXT'],
    ['codigo_rastreamento', 'TEXT'],
    ['url_rastreamento', 'TEXT'],
    ['data_envio', 'TEXT'],
    ['data_entrega', 'TEXT'],
    ['upseller_id', 'TEXT'],
    ['upseller_tracking', 'TEXT'],
    ['upseller_status', 'TEXT'],
    ['data_upseller_sync', 'TEXT']
  ];
  for (const [nome, tipo] of camposPedido) {
    if (!nomesPedidos.has(nome)) {
      await db.exec(`ALTER TABLE pedidos ADD COLUMN ${nome} ${tipo}`);
    }
  }

// Garantir admin padrão (com hash bcrypt seguro)
  const adminRow = await db.get('SELECT * FROM admin_conta WHERE id = 1');
  if (!adminRow) {
    const senhaHash = await hashSenha('admin123');
    await db.run('INSERT INTO admin_conta (id, email, senha_hash) VALUES (1, ?, ?)', [ADMIN_PADRAO.email, senhaHash]);
  } else if (!adminRow.senha_hash || (typeof adminRow.senha_hash === 'string' && adminRow.senha_hash.length === 64 && /^[a-f0-9]{64}$/.test(adminRow.senha_hash))) {
    // Migra o hash legado SHA-256 para bcrypt automaticamente
    const senhaHash = await hashSenha('admin123');
    await db.run('UPDATE admin_conta SET senha_hash = ? WHERE id = 1', [senhaHash]);
  }

  // Garante o cupom de boas-vindas ativo no banco (para a página cupom.html funcionar)
  const cupomBW = await db.get('SELECT id FROM cupons WHERE codigo = ?', 'MIO10OFF');
  if (!cupomBW) {
    await db.run('INSERT INTO cupons (codigo, tipo, valor, limiteUso, usos, validade, ativo) VALUES (?,?,?,?,?,?,?)',
      ['MIO10OFF', 'porcentagem', 10, 0, 0, null, 1]);
  }

  // Config padrão (banners, contato, redes, logo, textos)
  const cfgCount = await db.get('SELECT COUNT(*) as total FROM config');
  if (cfgCount.total === 0) {
    const configPadrao = {
      logo: { texto: "MIO", url: "" },
      redesSociais: { instagram: "https://instagram.com", tiktok: "https://tiktok.com" },
      contato: {
        emailAtendimento: "suporte@miostreetwear.com.br",
        emailParcerias: "parcerias@miostreetwear.com.br",
        emailCarreiras: "carreiras@miostreetwear.com.br",
        whatsapp: "5541995209813",
        telefone: "(41) 99520-9813"
      },
      carrossel: [
        { etiqueta: "NOVIDADES MIO", titulo: "CORES QUE DESTACAM", texto: "Estilo único em cada passo. Descubra a nova coleção de meias tingidas exclusivas.", botao: "VER NOVO DROP", link: "produto.html?filtro=feminino", imagem: "banner1.jpg" },
        { etiqueta: "ORGANIZAÇÃO E ESTILO", titulo: "COLEÇÃO MIO HOME", texto: "Organizadores de MDF premium cortados a laser.", botao: "VER ORGANIZADORES", link: "produto.html?filtro=masculino", imagem: "banner2.jpg" },
        { etiqueta: "ESSENCIAL URBANO", titulo: "MIO STREETWEAR", texto: "Peças limitadas para expressar sua autenticidade.", botao: "EXPLORAR COLEÇÃO", link: "produto.html?filtro=infantil", imagem: "banner3.jpg" }
      ],
      bannersGrelha: [
        { titulo: "Masculino", texto: "Ver Coleção", link: "produto.html?filtro=masculino", imagem: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=500" },
        { titulo: "10% OFF", texto: "Primeira Compra", link: "cupom.html", imagem: "https://images.unsplash.com/photo-1582966772680-860e372bb558?q=80&w=500" },
        { titulo: "Feminino", texto: "Ver Coleção", link: "produto.html?filtro=feminino", imagem: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=500" }
      ],
bannerIntermediario: {
        titulo: "COLEÇÃO EXCLUSIVA DE MEIAS CUSTOM DYED",
        texto: "Peças únicas tingidas individualmente.",
        botao: "Explorar Meias",
        link: "produto.html?filtro=meias",
        imagem: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?q=80&w=1200"
      },
      enderecoLoja: {
        cep: "83650-000",
        rua: "Rua da Loja",
        numero: "123",
        bairro: "Centro",
        cidade: "Lapa",
        uf: "PR"
      },
      freteGratisMeta: 249.00,
      pixCopiaCola: "00020126360014BR.GOV.BCB.PIX0114mio@exemplo.com520400005303986540574.705802BR5903MIO6009SAO PAULO62070503***6304E2CA",
      rodape: {
        slogan: "Design autêntico, peças exclusivas e estilo streetwear para expressar sua individualidade.",
        direitos: "© 2026 MIO Streetwear. Todos os direitos reservados.",
        politicasTexto: "Políticas da Loja",
        privacidadeTexto: "Privacidade"
      },
      paginas: {
        sobre: {
          titulo: "MIO Streetwear",
          texto1: "Nascida do asfalto e da cultura urbana, a MIO é mais do que uma marca de roupas — é um conceito de expressão pessoal. Desenvolvemos peças exclusivas, drops extremamente limitados e acessórios customizados para quem dita o seu próprio ritmo e não segue padrões.",
          texto2: "Cada costura, estampa e detalhe carrega a nossa obsessão por autenticidade, qualidade extrema e um design minimalista premium. Nós não fazemos moda para as massas; criamos peças de coleção para quem compreende o valor do estilo urbano.",
          imagens: [
            "https://images.unsplash.com/photo-1582966772680-860e372bb558?auto=format&fit=crop&q=80&w=600",
            "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&q=80&w=600",
            "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&q=80&w=600"
          ]
        },
        politicas: {
          titulo: "POLÍTICAS DA LOJA",
          sec1Titulo: "1. Envio e Entrega",
          sec1Texto: "Todos os pedidos da MIO Streetwear são processados e enviados dentro do prazo de 2 a 5 dias úteis após a confirmação do pagamento. O prazo final de entrega e o valor do frete variam de acordo com a sua região e a modalidade escolhida no checkout.",
          sec2Titulo: "2. Trocas e Devoluções",
          sec2Texto: "Garantimos o direito de troca ou devolução do produto no prazo de até 7 (sete) dias corridos após o recebimento, conforme o Código de Defesa do Consumidor. O produto não deve apresentar sinais de uso, lavagem ou alterações e deve ser mantido na embalagem original com etiqueta fixada.",
          sec3Titulo: "3. Peças Exclusivas & Garimpo",
          sec3Texto: "Trabalhamos com tiragens limitadas e processos artesanais/customizados (Custom Dyed). Por conta disso, eventuais variações sutis de tonalidade reforçam a autenticidade e exclusividade de cada peça."
        },
        faleConosco: {
          titulo: "FALE CONOSCO",
          texto: "Entre em contato diretamente com nossa equipe através dos canais oficiais abaixo.",
          emailAtendimento: "suporte@miostreetwear.com.br",
          emailParcerias: "parcerias@miostreetwear.com.br",
          emailCarreiras: "carreiras@miostreetwear.com.br"
        }
      }
    };
    await db.run('INSERT INTO config (chave, valor) VALUES (?, ?)', ['site_config', JSON.stringify(configPadrao)]);
  }

  // Seed produtos se vazio
  const count = await db.get('SELECT COUNT(*) as total FROM produtos');
  if (count.total === 0) {
    console.log("🚀 Populando banco de dados inicial...");
    const initialProducts = [
      ["Meia Custom Dyed Classic Red MIO", 29.90, 39.90, 1, "Super Drop", "2026-08-30T23:59:59", "meias", "masculino", "https://images.unsplash.com/photo-1582966772680-860e372bb558?q=80&w=400", '["https://images.unsplash.com/photo-1582966772680-860e372bb558?q=80&w=400","https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=400"]', '[{"nome":"Acid Red","codigoHex":"#ef4444"}]', '["U","34-38","39-43"]', "<p>Meia artesanal reativa.</p>", 15, 5, '2026-07-10', '2026-07-10'],
      ["Meia Custom Dyed Ocean Blue MIO", 29.90, 39.90, 1, "Saldão MIO", "2026-08-15T18:00:00", "meias", "feminino", "https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=400", '["https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=400"]', '[{"nome":"Ocean Blue","codigoHex":"#0284c7"}]', '["U"]', "<p>Tingimento azul oceânico.</p>", 8, 3, '2026-07-01', '2026-07-01'],
      ["Meia Custom Dyed Neon Acid MIO", 34.90, 44.90, 1, "Oferta Relâmpago", "2026-07-31T23:59:59", "meias", "infantil", "https://images.unsplash.com/photo-1582966772680-860e372bb558?q=80&w=400", '["https://images.unsplash.com/photo-1582966772680-860e372bb558?q=80&w=400"]', '[{"nome":"Neon Acid","codigoHex":"#84cc16"}]', '["U","34-38"]', "<p>Estilo neon vibrante.</p>", 5, 9, '2026-07-12', '2026-07-12'],
      ["Camiseta Oversized Drop 01 MIO", 99.90, 119.90, 1, "Drop MIO", "2026-08-20T20:00:00", "roupas", "masculino", "https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=400", '["https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=400"]', '[{"nome":"Off-Black","codigoHex":"#18181b"}]', '["P","M","G","GG"]', "<p>Caimento street perfeito.</p>", 20, 8, '2026-06-25', '2026-06-25'],
      ["Corta Vento MIO Black", 189.90, 229.90, 1, "Promo Inverno", "2026-08-01T23:59:59", "roupas", "feminino", "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=400", '["https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=400"]', '[{"nome":"Black Matte","codigoHex":"#09090b"}]', '["P","M","G"]', "<p>Impermeável premium.</p>", 3, 10, '2026-07-11', '2026-07-11'],
      ["Meia Custom Dyed Tie-Dye Pink", 29.90, 39.90, 1, "Edição Limitada", "2026-08-10T23:59:59", "meias", "feminino", "https://images.unsplash.com/photo-1582966772680-860e372bb558?q=80&w=400", '["https://images.unsplash.com/photo-1582966772680-860e372bb558?q=80&w=400"]', '[{"nome":"Tie-Dye Pink","codigoHex":"#f472b6"}]', '["U","34-38"]', "<p>Tingimento rosa e lavanda.</p>", 11, 4, '2026-07-05', '2026-07-05']
    ];
    for (const p of initialProducts) {
      await db.run(`INSERT INTO produtos (nome, preco, precoOriginal, estaEmPromocao, textoDestaquePromo, cronometro, categoria, genero, imagem, fotos, cores, tamanhos, descricao, estoque, relevancia, data, data_cadastro) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, p);
    }
  }
})();

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
  try { return str ? JSON.parse(str) : fallback; } catch (e) { return fallback; }
}

// --- Helpers de configuração por chave ---
async function getConfigChave(chave, fallback = {}) {
  try {
    const row = await db.get('SELECT valor FROM config WHERE chave = ?', chave);
    return row ? JSON.parse(row.valor) : fallback;
  } catch (e) { return fallback; }
}

async function setConfigChave(chave, valor) {
  const existe = await db.get('SELECT chave FROM config WHERE chave = ?', chave);
  if (existe) {
    await db.run('UPDATE config SET valor = ? WHERE chave = ?', [JSON.stringify(valor), chave]);
  } else {
    await db.run('INSERT INTO config (chave, valor) VALUES (?, ?)', [chave, JSON.stringify(valor)]);
  }
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
  return getConfigChave('pagseguro_config', {
    ativo: false,
    modo: 'sandbox',
    email: '',
    token: '',
    appId: '',
    appKey: ''
  });
}

async function findPedidoByReference(reference) {
  if (!reference) return null;
  const byNumero = await db.get('SELECT * FROM pedidos WHERE numero = ?', [reference]);
  if (byNumero) return byNumero;
  return db.get('SELECT * FROM pedidos WHERE id = ?', [Number(reference)]).catch(() => null);
}

async function enviarPedidoParaBling(pedido) {
  try {
    const cfg = await getConfigChave('bling_config', {});
    if (!cfg || !cfg.ativo || !cfg.apiKey || !cfg.apiToken) {
      return { ok: false, motivo: 'Bling não configurado' };
    }

    const clienteJson = parseJsonArray(pedido.cliente, {});
    const itensJson = parseJsonArray(pedido.itens, []);
    const enderecoJson = parseJsonArray(pedido.endereco, {});
    const base = (cfg.url || 'https://bling.com.br/Api/v3').replace(/\/$/, '');

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

    const resApi = await fetch(base + '/pedido', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(cfg.apiKey + ':' + cfg.apiToken).toString('base64')
      },
      body: JSON.stringify(payload)
    });

    const data = await resApi.json().catch(() => ({}));
    if (!resApi.ok) throw new Error(data.message || data.error || 'Falha ao enviar pedido ao Bling');

    const blingId = data.id || data.pedidoId || data.data?.id || data.numero;
    if (blingId) {
      await db.run('UPDATE pedidos SET bling_id = ?, bling_order_id = ?, data_bling_sync = ? WHERE numero = ?', [String(blingId), String(blingId), new Date().toISOString(), pedido.numero]).catch(() => {});
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
      const dir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fileName = (nome ? nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : 'img') + '-' + Date.now() + '.' + ext;
      fs.writeFileSync(path.join(dir, fileName), buffer);
      return res.json({ ok: true, url: '/uploads/' + fileName });
    }
    // URL externa - retorna a própria URL
    return res.json({ ok: true, url: imagem });
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
    const c = await db.get('SELECT * FROM clientes WHERE email = ?', emailBusca);
    const senhaOk = c ? await compararSenha(senha, c.senha) : false;
    if (!c || !senhaOk) {
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    }
    const { senha: _senha, ...clienteSemSenha } = c;
    clienteSemSenha.endereco = parseJsonArray(clienteSemSenha.endereco, {});
    const token = crypto.randomBytes(32).toString('hex');
    sessaoCliente.set(token, { email: emailBusca, expiraEm: Date.now() + 15 * 60 * 1000 });
    res.json({ ok: true, cliente: clienteSemSenha, token });
  } catch (err) {
    res.status(500).json({ error: "Erro no login." });
  }
});

app.get('/api/clientes/me', exigirCliente, async (req, res) => {
  try {
    const cliente = await db.get('SELECT id, nome, email, cpf, telefone, endereco, foto, whatsapp_ok, aceitou_termos, data_cadastro FROM clientes WHERE email = ?', req.clienteEmail);
    if (!cliente) return res.status(404).json({ error: "Cliente não encontrado." });
    cliente.endereco = parseJsonArray(cliente.endereco, {});
    res.json({ ok: true, cliente });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar cliente." });
  }
});

// ---------- API: ATUALIZAR PERFIL DO CLIENTE (dados, foto, consentimentos) ----------
// Permite que o cliente autenticado atualize seu próprio cadastro no banco.
app.put('/api/clientes/perfil', async (req, res) => {
  const { email, senha, dados } = req.body || {};
  let emailBusca = null;
  const token = req.headers['x-client-token'];
  if (token && sessaoCliente.has(token)) {
    const sessao = sessaoCliente.get(token);
    if (sessao.expiraEm < Date.now()) {
      sessaoCliente.delete(token);
      return res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
    }
    sessao.expiraEm = Date.now() + 15 * 60 * 1000;
    emailBusca = sessao.email;
  } else if (email && senha) {
    emailBusca = email.toLowerCase().trim();
  } else {
    return res.status(400).json({ error: "E-mail e senha obrigatórios ou token inválido." });
  }
  try {
    const c = await db.get('SELECT * FROM clientes WHERE email = ?', emailBusca);
    if (!c) return res.status(401).json({ error: "Cliente não encontrado." });
    if (!token) {
      const senhaOk = await compararSenha(senha, c.senha);
      if (!senhaOk) {
        return res.status(401).json({ error: "Senha incorreta. Não foi possível atualizar o perfil." });
      }
    }
    const d = dados || {};
    await db.run(`UPDATE clientes SET nome=?, cpf=?, telefone=?, endereco=?, foto=?, whatsapp_ok=?, aceitou_termos=? WHERE email=?`,
      [d.nome || c.nome, d.cpf || c.cpf || '', d.telefone || c.telefone || '', JSON.stringify(d.endereco || parseJsonArray(c.endereco, {})), d.foto || c.foto || '', d.whatsapp_ok !== undefined ? (d.whatsapp_ok ? 1 : 0) : c.whatsapp_ok, d.aceitou_termos !== undefined ? (d.aceitou_termos ? 1 : 0) : c.aceitou_termos, emailBusca]);
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
    const existe = await db.get('SELECT id FROM clientes WHERE email = ?', emailBusca);
    if (!existe) return res.status(404).json({ error: "Cliente não encontrado." });
    const nova = novaSenha.length < 6 ? 'mio123' : novaSenha;
    await db.run('UPDATE clientes SET senha = ? WHERE email = ?', [await hashSenha(nova), emailBusca]);
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
    const cliente = await db.get('SELECT * FROM clientes WHERE email = ?', req.clienteEmail);
    if (!cliente) return res.status(404).json({ error: "Cliente não encontrado." });
    const senhaOk = await compararSenha(senhaAtual, cliente.senha);
    if (!senhaOk) {
      return res.status(401).json({ error: "Senha atual incorreta." });
    }
    await db.run('UPDATE clientes SET senha = ? WHERE email = ?', [await hashSenha(novaSenha), req.clienteEmail]);
    res.json({ ok: true, message: "Senha atualizada com sucesso." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao alterar senha." });
  }
});

// Gera uma senha temporária aleatória para um cliente (usado no painel admin,
// quando o cliente esquece a senha). Retorna a senha para o admin repassar ao cliente.
app.post('/api/admin/clientes/:id/reset-senha', exigirAdmin, async (req, res) => {
  try {
    const cliente = await db.get('SELECT id, email, nome FROM clientes WHERE id = ?', req.params.id);
    if (!cliente) return res.status(404).json({ error: "Cliente não encontrado." });
    // Cria uma senha temporária legível (ex: "mioA7k2P")
    const senhaTemporaria = 'mio' + crypto.randomBytes(4).toString('hex');
    await db.run('UPDATE clientes SET senha = ? WHERE id = ?', [await hashSenha(senhaTemporaria), cliente.id]);
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
    await setConfigChave('bling_sync_pedidos_last', { data: data.data, sincronizadoEm: new Date().toISOString() });
    res.json({ ok: true, pedidos: data.data });
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
      const cfg = await getConfigChave('pagseguro_config', {});
      if (!cfg.token && !(cfg.appKey && cfg.appId)) {
        return res.json({ ok: false, mensagem: "Credenciais do PagSeguro não preenchidas." });
      }
      return res.json({ ok: true, mensagem: "Credenciais PagSeguro configuradas. Conecte ao PagSeguro para validar o token." });
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
      appId: cfg.appId || '',
      appKey: cfg.appKey || '',
      email: cfg.email || '',
      token: cfg.token || ''
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
    if (!cfg.ativo || (!cfg.appId || !cfg.appKey)) {
      return res.status(403).json({ ok: false, error: 'PagSeguro desativado ou credenciais incompletas no painel administrativo.' });
    }
    const base = getPagSeguroBase(cfg);
    const fetchRes = await fetch(base + '/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.token || ''}`,
        'x-api-key': cfg.appKey,
        'x-api-version': '2024-01-01'
      }
    });
    const data = await fetchRes.json().catch(() => ({}));
    if (!fetchRes.ok) {
      return res.status(502).json({ ok: false, error: data.message || 'Erro ao obter sessão do PagSeguro.' });
    }
    return res.json({ ok: true, sessionId: data.id || data.session_id || data.sessionId });
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

    await db.run(`INSERT INTO pedidos (numero, data, cliente, endereco, itens, cupom, metodo, status, total, frete_modalidade, frete_codigo, frete_valor, frete_prazo, frete_origem, frete_detalhes, codigo_rastreamento, url_rastreamento, data_envio, data_entrega) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      pedidoMio.numero,
      pedidoMio.data,
      JSON.stringify(pedidoMio.cliente),
      JSON.stringify(pedidoMio.endereco),
      JSON.stringify(pedidoMio.itens),
      JSON.stringify(pedidoMio.cupom || null),
      pedidoMio.metodo,
      pedidoMio.status,
      pedidoMio.total,
      freteSelecionado.modalidade || freteSelecionado.nome || 'Entrega Padrão',
      freteSelecionado.codigo || freteSelecionado.nome || 'padrao',
      Number(freteSelecionado.valor || pedidoMio.frete || 0),
      freteSelecionado.prazo || '5 dias úteis',
      freteSelecionado.origem || 'checkout',
      JSON.stringify(freteSelecionado),
      null,
      null,
      null,
      null
    ]);

    if (pedidoMio.cupom && pedidoMio.cupom.codigo) {
      await db.run('UPDATE cupons SET usos = usos + 1 WHERE codigo = ?', [pedidoMio.cupom.codigo]);
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
        await db.run('UPDATE pedidos SET status = ? WHERE numero = ?', ['Falhou', numeroPedido]);
        return res.status(result.statusCode || 502).json({ ok: false, error: result.error });
      }

      const data = result.data || {};
      const qrCodes = data.qr_codes || data.payment_response?.qr_codes || [];
      const qr = qrCodes[0] || {};
      const copiaCola = qr.text || qr.arrangement_information || data.copy_and_paste || '';
      const qrCodeImage = qr.image || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(copiaCola || `MIO_PIX_${numeroPedido}`)}`;

      await db.run('UPDATE pedidos SET status = ? WHERE numero = ?', ['Aguardando Pagamento', numeroPedido]);
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
        await db.run('UPDATE pedidos SET status = ? WHERE numero = ?', ['Falhou', numeroPedido]);
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
        await db.run('UPDATE pedidos SET status = ? WHERE numero = ?', ['Falhou', numeroPedido]);
        return res.status(result.statusCode || 502).json({ ok: false, error: result.error });
      }

      const data = result.data || {};
      const statusFinal = String(data.status || '').toUpperCase();
      const aprovado = statusFinal === 'PAID' || statusFinal === '3' || data.status === 3;
      const pedidoStatus = aprovado ? 'PAGO' : 'Aguardando Pagamento';

      await db.run('UPDATE pedidos SET status = ? WHERE numero = ?', [pedidoStatus, numeroPedido]);
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
      await db.run("UPDATE pedidos SET status = 'PAGO' WHERE numero = ?", [pedido.numero]);
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
          await db.run("UPDATE pedidos SET status = 'PAGO' WHERE numero = ?", [reference]);
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
      await db.run("UPDATE pedidos SET status = 'PAGO' WHERE numero = ?", [reference]);
      const pedidoPago = await findPedidoByReference(reference);
      if (pedidoPago) await enviarPedidoParaUpseller(pedidoPago);
      return res.json({ ok: true, pago: true, reference, status: 'PAGO' });
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
    
    const adminPerfil = await db.get('SELECT endereco FROM admin_conta WHERE id = 1').catch(() => null);
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
    const adminPerfil = await db.get('SELECT endereco FROM admin_conta WHERE id = 1').catch(() => null);
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
    const pedido = await db.get('SELECT * FROM pedidos WHERE numero = ?', [numeroPedido]);
    if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const resultado = await enviarPedidoParaBling(pedido);
    if (!resultado.ok) return res.status(502).json({ error: resultado.motivo || 'Erro ao enviar ao Bling.' });
    return res.json({ ok: true, message: 'Pedido reenviado ao Bling com sucesso!', bling: resultado.data });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao reenviar: ' + err.message });
  }
});

app.post('/api/webhooks/bling', async (req, res) => {
  try {
    const body = req.body || {};
    const order_number = body.order_number || body.numero || body.numeroPedido || body.orderNumber;
    const tracking_number = body.tracking_number || body.codigoRastreio || body.trackingNumber || body.rastreio;
    const status = body.status || body.estado || 'Enviado';
    if (!order_number) return res.status(400).json({ ok: false, error: 'order_number obrigatório' });

    const pedido = await db.get('SELECT * FROM pedidos WHERE numero = ?', [order_number]);
    if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });

    const statusMap = { pending: 'Em Preparação', processing: 'Em Preparação', shipped: 'Enviado', delivered: 'Entregue', cancelled: 'Cancelado', sent: 'Enviado' };
    const statusMio = statusMap[String(status).toLowerCase()] || String(status || 'Enviado');
    await db.run(
      `UPDATE pedidos SET bling_status = ?, bling_tracking = ?, data_bling_sync = ?, status = ?, data_envio = ? WHERE numero = ?`,
      [String(status), tracking_number || null, new Date().toISOString(), statusMio, body.data_envio || null, order_number]
    );

    if (tracking_number && !pedido.codigo_rastreamento) {
      await db.run('UPDATE pedidos SET codigo_rastreamento = ? WHERE numero = ?', [tracking_number, order_number]);
    }

    res.json({ ok: true, message: 'Webhook Bling recebido e processado' });
  } catch (err) {
    console.error('Erro ao processar webhook Bling:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/bling/expeditions', exigirAdmin, async (req, res) => {
  try {
    const pedidos = await db.all(
      'SELECT numero, cliente, itens, status, total, codigo_rastreamento, bling_tracking, bling_status, data_envio FROM pedidos WHERE status IN (?, ?) ORDER BY data DESC',
      ['Em Preparação', 'Enviado']
    );

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
  try {
    const admin = await db.get('SELECT * FROM admin_conta WHERE id = 1');
    const senhaOk = admin ? await compararSenha(senha || '', admin.senha_hash) : false;
    if (!admin || admin.email !== email || !senhaOk) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiraEm = Date.now() + ADMIN_SESSION_TTL_MS;
    await salvarSessaoAdmin(token, admin.email, expiraEm);

    res.cookie('admin_token', token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: ADMIN_SESSION_TTL_MS,
      path: '/'
    });

    res.json({ token, email: admin.email });
  } catch (err) {
    res.status(500).json({ error: "Erro no login." });
  }
});

app.post('/api/admin/logout', async (req, res) => {
  const token = getAdminTokenFromRequest(req);
  await limparSessaoAdmin(token);
  res.clearCookie('admin_token', { path: '/' });
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
    const admin = await db.get('SELECT * FROM admin_conta WHERE id = 1');
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

    await db.run(`UPDATE admin_conta SET ${updates.join(', ')} WHERE id = 1`, values);

    const adminAtualizado = await db.get('SELECT * FROM admin_conta WHERE id = 1');
    const token = getAdminTokenFromRequest(req);
    if (token && adminAtualizado.email) {
      await salvarSessaoAdmin(token, adminAtualizado.email, Date.now() + ADMIN_SESSION_TTL_MS);
    }

    return res.json({ ok: true, message: 'Dados do administrador atualizados.', email: adminAtualizado.email });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao alterar dados do administrador.' });
  }
});

app.put('/api/admin/senha', exigirAdmin, async (req, res) => {
  const { senhaAtual, novaSenha } = req.body || {};
  try {
    const admin = await db.get('SELECT * FROM admin_conta WHERE id = 1');
    const senhaOk = admin ? await compararSenha(senhaAtual, admin.senha_hash) : false;
    if (!senhaOk) {
      return res.status(401).json({ error: "Senha atual incorreta." });
    }
    if (!novaSenha || novaSenha.length < 6) {
      return res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres." });
    }
    await db.run('UPDATE admin_conta SET senha_hash = ? WHERE id = 1', [await hashSenha(novaSenha)]);
    res.json({ ok: true, message: "Senha do administrador atualizada." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao alterar senha." });
  }
});

// ---------- API: PERFIL DO ADMIN (foto, nome, endereço da loja, CNPJ) ----------
app.get('/api/admin/perfil', exigirAdmin, async (req, res) => {
  try {
    const admin = await db.get('SELECT nome, foto, endereco, cnpj, email FROM admin_conta WHERE id = 1');
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
    const admin = await db.get('SELECT * FROM admin_conta WHERE id = 1');
    const novoNome = nome !== undefined ? nome : admin.nome;
    const novoFoto = foto !== undefined ? foto : (admin.foto || '');
    const novoEnd = endereco !== undefined ? JSON.stringify(endereco) : admin.endereco;
    const novoCnpj = cnpj !== undefined ? cnpj : (admin.cnpj || '');
    await db.run('UPDATE admin_conta SET nome=?, foto=?, endereco=?, cnpj=? WHERE id = 1', [novoNome, novoFoto, novoEnd, novoCnpj]);
    res.json({ ok: true, message: "Perfil do administrador atualizado." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar perfil do admin." });
  }
});

// ---------- API: PRODUTOS (CRUD) ----------
app.get('/api/produtos', async (req, res) => {
  try {
    const produtos = await db.all('SELECT * FROM produtos ORDER BY relevancia DESC');
    const formatados = produtos.map(p => ({
      ...p,
      fotos: parseJsonArray(p.fotos, [p.imagem]),
      cores: parseJsonArray(p.cores, []),
      tamanhos: parseJsonArray(p.tamanhos, [])
    }));
    res.json(formatados);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar produtos." });
  }
});

app.get('/api/produto/:id', async (req, res) => {
  try {
    const produto = await db.get('SELECT * FROM produtos WHERE id = ?', req.params.id);
    if (!produto) return res.status(404).json({ error: "Produto não encontrado." });
    produto.fotos = parseJsonArray(produto.fotos, [produto.imagem]);
    produto.cores = parseJsonArray(produto.cores, []);
    produto.tamanhos = parseJsonArray(produto.tamanhos, []);
    res.json(produto);
  } catch (err) {
    res.status(500).json({ error: "Erro interno." });
  }
});

app.post('/api/produtos', exigirAdmin, async (req, res) => {
  const p = req.body;
  try {
    const r = await db.run(`INSERT INTO produtos (nome, preco, precoOriginal, estaEmPromocao, textoDestaquePromo, cronometro, categoria, genero, imagem, fotos, cores, tamanhos, descricao, estoque, relevancia, data, data_cadastro)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.nome, p.preco, p.precoOriginal||null, p.estaEmPromocao?1:0, p.textoDestaquePromo||'', p.cronometro||null, p.categoria, p.genero, p.imagem||'', JSON.stringify(p.fotos||[p.imagem]), JSON.stringify(p.cores||[]), JSON.stringify(p.tamanhos||[]), p.descricao||'', p.estoque||0, p.relevancia||0, p.data||new Date().toISOString().slice(0,10), new Date().toISOString().slice(0,10)]);
    res.json({ ok: true, id: r.lastID });
  } catch (err) {
    res.status(500).json({ error: "Erro ao criar produto." });
  }
});

app.put('/api/produtos/:id', exigirAdmin, async (req, res) => {
  const p = req.body;
  try {
    await db.run(`UPDATE produtos SET nome=?, preco=?, precoOriginal=?, estaEmPromocao=?, textoDestaquePromo=?, cronometro=?, categoria=?, genero=?, imagem=?, fotos=?, cores=?, tamanhos=?, descricao=?, estoque=?, relevancia=?, data=? WHERE id=?`,
      [p.nome, p.preco, p.precoOriginal||null, p.estaEmPromocao?1:0, p.textoDestaquePromo||'', p.cronometro||null, p.categoria, p.genero, p.imagem||'', JSON.stringify(p.fotos||[p.imagem]), JSON.stringify(p.cores||[]), JSON.stringify(p.tamanhos||[]), p.descricao||'', p.estoque||0, p.relevancia||0, p.data||new Date().toISOString().slice(0,10), req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar produto." });
  }
});

app.delete('/api/produtos/:id', exigirAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM produtos WHERE id = ?', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir produto." });
  }
});

// ---------- API: PEDIDOS ----------
app.get('/api/pedidos', exigirAdmin, async (req, res) => {
  try {
    const pedidos = await db.all('SELECT * FROM pedidos ORDER BY id DESC');
    const formatados = pedidos.map(pd => ({
      ...pd,
      cliente: parseJsonArray(pd.cliente, {}),
      endereco: parseJsonArray(pd.endereco, {}),
      itens: parseJsonArray(pd.itens, []),
      cupom: parseJsonArray(pd.cupom, null)
    }));
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
    await db.run(`INSERT INTO pedidos (numero, data, cliente, endereco, itens, cupom, metodo, status, total) VALUES (?,?,?,?,?,?,?,?,?)`,
      [pd.numero, pd.data || new Date().toISOString(), JSON.stringify(pd.cliente), JSON.stringify(pd.endereco||{}), JSON.stringify(pd.itens), JSON.stringify(pd.cupom||null), pd.metodo||'pix', pd.status||'Aguardando Pagamento', total]);
    if (pd.cupom && pd.cupom.codigo) {
      await db.run('UPDATE cupons SET usos = usos + 1 WHERE codigo = ?', [pd.cupom.codigo]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar pedido." });
  }
});

app.get('/api/pedidos/:id/status', async (req, res) => {
  try {
    const pedido = await db.get('SELECT * FROM pedidos WHERE numero = ? OR id = ?', [req.params.id, Number(req.params.id)]);
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
    await db.run('UPDATE pedidos SET status = ? WHERE numero = ?', [status, numero]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar status." });
  }
});

app.put('/api/pedidos/:id', exigirAdmin, async (req, res) => {
  const { status, codigo_rastreamento, url_rastreamento, data_envio, data_entrega } = req.body;
  try {
    const pedido = await db.get('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
    if (!pedido) return res.status(404).json({ error: "Pedido não encontrado." });

    let campos = [];
    let valores = [];
    if (status !== undefined) { campos.push('status = ?'); valores.push(status); }
    if (codigo_rastreamento !== undefined) { campos.push('codigo_rastreamento = ?'); valores.push(codigo_rastreamento); }
    if (url_rastreamento !== undefined) { campos.push('url_rastreamento = ?'); valores.push(url_rastreamento); }
    if (data_envio !== undefined) { campos.push('data_envio = ?'); valores.push(data_envio); }
    if (data_entrega !== undefined) { campos.push('data_entrega = ?'); valores.push(data_entrega); }
    
    if (campos.length === 0) {
      return res.status(400).json({ error: "Nenhum campo para atualizar." });
    }
    
    valores.push(req.params.id);
    await db.run(`UPDATE pedidos SET ${campos.join(', ')} WHERE id = ?`, valores);
    
    // Se mudou para "Em Preparação" e ainda não foi enviado ao Bling, enviar
    if (status === 'Em Preparação' && !pedido.bling_id && !pedido.upseller_id) {
      const pedidoAtualizado = await db.get('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
      const result = await enviarPedidoParaBling(pedidoAtualizado);
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
  try {
    const pedidos = await db.all('SELECT * FROM pedidos ORDER BY id DESC');
    const emailBusca = String(email).toLowerCase().trim();
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
    const clientes = await db.all('SELECT id, nome, email, cpf, telefone, endereco, foto, whatsapp_ok, aceitou_termos, data_cadastro FROM clientes ORDER BY id DESC');
    const formatados = clientes.map(c => ({ ...c, endereco: parseJsonArray(c.endereco, {}) }));
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
    const existe = await db.get('SELECT id FROM clientes WHERE email = ?', emailBusca);
    if (existe) {
      await db.run('UPDATE clientes SET nome=?, cpf=?, telefone=?, endereco=?, foto=?, whatsapp_ok=?, aceitou_termos=? WHERE email=?',
        [c.nome, c.cpf||'', c.telefone||'', JSON.stringify(c.endereco||{}), c.foto||'', c.whatsapp_ok?1:0, c.aceitou_termos?1:0, emailBusca]);
      return res.json({ ok: true, novo: false });
    }
    await db.run('INSERT INTO clientes (nome, email, cpf, telefone, senha, endereco, foto, whatsapp_ok, aceitou_termos, data_cadastro) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [c.nome, emailBusca, c.cpf||'', c.telefone||'', await hashSenha(c.senha), JSON.stringify(c.endereco||{}), c.foto||'', c.whatsapp_ok?1:0, c.aceitou_termos?1:0, new Date().toISOString().slice(0,10)]);
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
  const token = req.headers['x-client-token'];
  if (token && sessaoCliente.has(token)) {
    const sessao = sessaoCliente.get(token);
    if (sessao.expiraEm < Date.now()) {
      sessaoCliente.delete(token);
      return res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
    }
    sessao.expiraEm = Date.now() + 15 * 60 * 1000;
    emailBusca = sessao.email;
  }
  if (!emailBusca) return res.status(400).json({ error: "E-mail e senha são obrigatórios para excluir a conta." });
  try {
    const cliente = await db.get('SELECT * FROM clientes WHERE email = ?', emailBusca);
    if (!cliente) return res.status(404).json({ error: "Conta não encontrada." });
    if (!token) {
      const senhaOk = await compararSenha(senha, cliente.senha);
      if (!senhaOk) {
        return res.status(401).json({ error: "Senha incorreta. Não foi possível excluir a conta." });
      }
    }
    await db.run('DELETE FROM clientes WHERE email = ?', [emailBusca]);
    if (token) sessaoCliente.delete(token);
    res.json({ ok: true, message: "Conta excluída com sucesso." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir a conta." });
  }
});

// ---------- API: CUPONS ----------
app.get('/api/cupons', exigirAdmin, async (req, res) => {
  try {
    const cupons = await db.all('SELECT * FROM cupons ORDER BY id DESC');
    res.json(cupons);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar cupons." });
  }
});

app.post('/api/cupons', exigirAdmin, async (req, res) => {
  const c = req.body;
  try {
    await db.run('INSERT INTO cupons (codigo, tipo, valor, limiteUso, usos, validade, ativo) VALUES (?,?,?,?,?,?,?)',
      [c.codigo.toUpperCase(), c.tipo||'porcentagem', c.valor, c.limiteUso||0, 0, c.validade||null, c.ativo?1:0]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao criar cupom." });
  }
});

app.put('/api/cupons/:id', exigirAdmin, async (req, res) => {
  const c = req.body;
  try {
    await db.run('UPDATE cupons SET codigo=?, tipo=?, valor=?, limiteUso=?, validade=?, ativo=? WHERE id=?',
      [c.codigo.toUpperCase(), c.tipo, c.valor, c.limiteUso||0, c.validade||null, c.ativo?1:0, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar cupom." });
  }
});

app.delete('/api/cupons/:id', exigirAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM cupons WHERE id = ?', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir cupom." });
  }
});

// ---------- API: VALIDAR CUPOM (público, usado no checkout) ----------
// Valida o cupom no servidor e retorna o desconto a aplicar. Não confia no cliente.
app.post('/api/cupons/validar', async (req, res) => {
  const { codigo, subtotal } = req.body || {};
  if (!codigo) return res.status(400).json({ ok: false, error: "Informe um cupom." });
  try {
    const cupom = await db.get('SELECT * FROM cupons WHERE codigo = ?', String(codigo).toUpperCase().trim());
    if (!cupom) return res.json({ ok: false, error: "Cupom inválido." });
    if (!cupom.ativo) return res.json({ ok: false, error: "Este cupom está inativo." });
    if (cupom.limiteUso > 0 && cupom.usos >= cupom.limiteUso) {
      return res.json({ ok: false, error: "Este cupom atingiu o limite de usos." });
    }
    if (cupom.validade && new Date(cupom.validade) < new Date()) {
      return res.json({ ok: false, error: "Este cupom expirou." });
    }
    const base = Number(subtotal) || 0;
    let desconto = 0;
    if (cupom.tipo === 'porcentagem') {
      desconto = base * (Number(cupom.valor) / 100);
    } else {
      desconto = Math.min(Number(cupom.valor) || 0, base);
    }
    res.json({ ok: true, cupom: cupom, desconto: Math.round(desconto * 100) / 100 });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Erro ao validar cupom." });
  }
});

// ---------- API: AVALIAÇÕES (votação/aprovação de produtos) ----------
// As avaliações são salvas no banco e só aparecem publicamente quando aprovadas.
app.get('/api/avaliacoes', async (req, res) => {
  try {
    const produtoId = req.query.produto_id;
    let rows;
    if (produtoId) {
      rows = await db.all("SELECT id, produto_id, nome, nota, comentario, foto, data, status FROM avaliacoes WHERE produto_id = ? AND status = 'aprovado' ORDER BY id DESC", produtoId);
    } else {
      rows = await db.all("SELECT id, produto_id, nome, nota, comentario, foto, data, status FROM avaliacoes WHERE status = 'aprovado' ORDER BY id DESC");
    }
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
    await db.run(`INSERT INTO avaliacoes (produto_id, nome, nota, comentario, foto, data, status, data_cadastro) VALUES (?,?,?,?,?,?,?,?)`,
      [a.produto_id, String(a.nome).slice(0, 60), nota, String(a.comentario || '').slice(0, 500), a.foto || '', new Date().toISOString(), 'pendente', new Date().toISOString().slice(0, 10)]);
    res.json({ ok: true, message: "Avaliação enviada. Aguardando aprovação." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar avaliação." });
  }
});

// Endpoints de moderação de avaliações (admin)
app.get('/api/avaliacoes/todas', exigirAdmin, async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM avaliacoes ORDER BY id DESC');
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
    await db.run('UPDATE avaliacoes SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar avaliação." });
  }
});

app.delete('/api/avaliacoes/:id', exigirAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM avaliacoes WHERE id = ?', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir avaliação." });
  }
});

// ---------- API: CONFIGURAÇÃO DO SITE ----------
app.get('/api/config', async (req, res) => {
  try {
    const row = await db.get('SELECT valor FROM config WHERE chave = ?', 'site_config');
    res.json(row ? JSON.parse(row.valor) : {});
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar configurações." });
  }
});

app.put('/api/config', exigirAdmin, async (req, res) => {
  try {
    await db.run('UPDATE config SET valor = ? WHERE chave = ?', [JSON.stringify(req.body), 'site_config']);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar configurações." });
  }
});

// ---------- API: ESTATÍSTICAS ----------
app.get('/api/estatisticas', exigirAdmin, async (req, res) => {
  try {
    const pedidos = await db.all('SELECT * FROM pedidos');
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
    const produtos = await db.all('SELECT * FROM produtos');
    const catMap = {};
    produtos.forEach(pr => { catMap[pr.nome] = pr.categoria; });
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
      totalClientes: (await db.get('SELECT COUNT(*) as t FROM clientes')).t,
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

app.listen(PORT, () => {
  console.log(`
  ███╗   ███╗██╗ ██████╗ 
  ████╗ ████║██║██╔═══██╗
  ██╔████╔██║██║██║   ██║
  ██║╚██╔╝██║██║██║   ██║
  ██║ ╚═╝ ██║██║╚██████╔╝
  ╚═╝     ╚═╝╚═╝ ╚═════╝ 
  Servidor MIO Online: http://localhost:${PORT}
  `);
});
