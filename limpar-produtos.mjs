import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Script para deletar TODOS os produtos de teste do banco de dados
// Depois você pode cadastrar apenas os 3 produtos reais pelo painel admin
// Uso: node limpar-produtos.mjs

try {
  const db = await open({ filename: './database.db', driver: sqlite3.Database });

  const produtosAntes = await db.get('SELECT COUNT(*) as c FROM produtos');
  const countAntes = produtosAntes.c;

  await db.run('DELETE FROM produtos');
  await db.run('DELETE FROM sqlite_sequence WHERE name = "produtos"');

  const produtosDepois = await db.get('SELECT COUNT(*) as c FROM produtos');
  const countDepois = produtosDepois.c;

  console.log('=== LIMPEZA DE PRODUTOS CONCLUÍDA ===');
  console.log(`Produtos removidos: ${countAntes}`);
  console.log(`Produtos restantes: ${countDepois}`);
  console.log('✅ Banco limpo! Agora cadastre apenas seus 3 produtos reais pelo painel admin.');

  await db.close();
} catch (e) {
  console.error('❌ ERRO:', e.message);
  process.exit(1);
}
