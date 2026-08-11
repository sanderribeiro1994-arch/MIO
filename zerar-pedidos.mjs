import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function main() {
  const db = await open({
    filename: './database.db',
    driver: sqlite3.Database
  });
  const antes = await db.get('SELECT COUNT(*) as total FROM pedidos');
  await db.run('DELETE FROM pedidos');
  const depois = await db.get('SELECT COUNT(*) as total FROM pedidos');
  console.log('Pedidos antes: ' + antes.total);
  console.log('Pedidos após limpeza: ' + depois.total);
  await db.close();
}

main().catch(e => { console.error('Erro:', e.message); });
