import { supabaseAdmin } from './supabase.js';

const { count: antes, error: antesError } = await supabaseAdmin.from('produtos').select('id', { count: 'exact', head: true });
if (antesError) throw antesError;
const { error } = await supabaseAdmin.from('produtos').delete().not('id', 'is', null);
if (error) throw error;
const { count: depois, error: depoisError } = await supabaseAdmin.from('produtos').select('id', { count: 'exact', head: true });
if (depoisError) throw depoisError;
console.log('Produtos removidos:', antes || 0);
console.log('Produtos restantes:', depois || 0);
