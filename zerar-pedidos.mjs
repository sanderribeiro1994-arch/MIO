import { supabaseAdmin } from './supabase.js';

const { count: antes, error: antesError } = await supabaseAdmin.from('pedidos').select('id', { count: 'exact', head: true });
if (antesError) throw antesError;
const { error } = await supabaseAdmin.from('pedidos').delete().not('id', 'is', null);
if (error) throw error;
const { count: depois, error: depoisError } = await supabaseAdmin.from('pedidos').select('id', { count: 'exact', head: true });
if (depoisError) throw depoisError;
console.log('Pedidos antes:', antes || 0);
console.log('Pedidos após limpeza:', depois || 0);
