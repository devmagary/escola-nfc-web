// =====================================================================
// Camada de acesso ao Supabase: autenticação, alunos, usuários,
// histórico, fotos e diagnóstico do esquema.
// =====================================================================

import { obterConfiguracao, normalizarUrlSupabase } from '../lib/config.js';

let cliente = null;
let canalHistorico = null;

export function inicializarSupabase() {
  if (cliente) return cliente;
  const config = obterConfiguracao();
  if (!config.valido) throw new Error('Configuração do Supabase ausente ou inválida.');
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Biblioteca do Supabase não carregou. Verifique a conexão e recarregue a página.');
  }
  cliente = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  return cliente;
}

export function obterCliente() {
  if (!cliente) return inicializarSupabase();
  return cliente;
}

export function observarAuth(callback) {
  return obterCliente().auth.onAuthStateChange((event, session) => callback(event, session));
}

export async function obterSessao() {
  const { data, error } = await obterCliente().auth.getSession();
  if (error) throw error;
  return data?.session || null;
}

export async function entrar(email, senha) {
  const { data, error } = await obterCliente().auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  return data;
}

export async function sair() {
  const { error } = await obterCliente().auth.signOut();
  if (error) throw error;
}

export async function obterMeuPerfil() {
  const { data, error } = await obterCliente().rpc('obter_meu_perfil');
  if (error) throw error;
  return data || null;
}

export async function alterarMinhaSenha(novaSenha) {
  const { data, error } = await obterCliente().auth.updateUser({ password: novaSenha });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
// Alunos
// ---------------------------------------------------------------------

export async function listarAlunos() {
  const todos = [];
  const tamanhoPagina = 1000;
  let inicio = 0;

  while (inicio < 20000) {
    const { data, error } = await obterCliente()
      .from('alunos')
      .select('*')
      .order('nome_completo', { ascending: true })
      .range(inicio, inicio + tamanhoPagina - 1);
    if (error) throw error;
    const pagina = data || [];
    todos.push(...pagina);
    if (pagina.length < tamanhoPagina) break;
    inicio += tamanhoPagina;
  }
  return todos;
}

export async function buscarAlunoPorUid(uid) {
  // Aceita registros legados gravados sem separador (ex.: 04A2B3C4) além do
  // formato canônico do firmware (04:A2:B3:C4).
  const hex = String(uid || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  const variantes = Array.from(new Set([
    String(uid || '').toUpperCase(),
    hex,
    uid
  ].filter(Boolean)));

  const { data, error } = await obterCliente()
    .from('alunos')
    .select('*')
    .in('uid_nfc', variantes)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export async function salvarAluno(payload, id = null) {
  const clienteAtual = obterCliente();
  if (id) {
    const { data, error } = await clienteAtual
      .from('alunos')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await clienteAtual
    .from('alunos')
    .insert([payload])
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function inserirAlunos(linhas) {
  const { data, error } = await obterCliente()
    .from('alunos')
    .insert(linhas)
    .select('*');
  if (error) throw error;
  return data || [];
}

export async function excluirAluno(id) {
  const { error } = await obterCliente().from('alunos').delete().eq('id', id);
  if (error) throw error;
}

export async function alterarAtivoAluno(id, ativo) {
  const { error } = await obterCliente().from('alunos').update({ ativo }).eq('id', id);
  if (error) throw error;
}

export async function uploadFotoAluno(uid, blob) {
  const caminho = `alunos/${String(uid).replace(/[^0-9A-F]/g, '')}.jpg`;
  const { error } = await obterCliente().storage
    .from('fotos-alunos')
    .upload(caminho, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data } = obterCliente().storage.from('fotos-alunos').getPublicUrl(caminho);
  return { path: caminho, url: data.publicUrl };
}

export async function removerFotoAluno(caminho) {
  if (!caminho) return;
  try {
    await obterCliente().storage.from('fotos-alunos').remove([caminho]);
  } catch (_) {
    // A foto pode ter sido removida manualmente; não bloqueia o cadastro.
  }
}

// ---------------------------------------------------------------------
// Usuários e permissões (RBAC)
// ---------------------------------------------------------------------

export async function listarUsuarios() {
  const { data, error } = await obterCliente()
    .from('perfis_usuarios')
    .select('*')
    .order('nome_completo', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function criarUsuarioAuth(email, senha, nome) {
  const config = obterConfiguracao();
  const secundario = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  try {
    const { data, error } = await secundario.auth.signUp({
      email,
      password: senha,
      options: { data: { nome } }
    });
    if (error) throw error;
    if (!data?.user) throw new Error('O Supabase não retornou o usuário criado.');
    // O Supabase pode responder com um usuário "fantasma" para e-mails já existentes.
    if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('Este e-mail já possui conta. Use outro e-mail.');
    }
    return data.user;
  } finally {
    try { await secundario.auth.signOut(); } catch (_) { /* ignora */ }
  }
}

export async function atualizarUsuario(id, nome, cargo, ativo) {
  const { data, error } = await obterCliente().rpc('admin_alterar_usuario', {
    p_user_id: id,
    p_nome: nome,
    p_cargo: cargo,
    p_ativo: ativo
  });
  if (error) throw error;
  return data;
}

export async function redefinirSenhaUsuario(id, novaSenha) {
  const { data, error } = await obterCliente().rpc('admin_redefinir_senha', {
    p_user_id: id,
    p_nova_senha: novaSenha
  });
  if (error) throw error;
  return data;
}

export async function excluirUsuario(id) {
  const { data, error } = await obterCliente().rpc('admin_excluir_usuario', { p_user_id: id });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
// Histórico de acessos
// ---------------------------------------------------------------------

function sanitizarBusca(valor) {
  return String(valor || '').replace(/[%(),]/g, ' ').trim();
}

export async function listarHistorico({ inicio, fim, busca, status, page = 0, pageSize = 50 } = {}) {
  let query = obterCliente()
    .from('historico_acessos')
    .select('*', { count: 'exact' });

  if (inicio) query = query.gte('data_hora', inicio);
  if (fim) query = query.lte('data_hora', fim);
  if (status) query = query.eq('status', status);

  const termo = sanitizarBusca(busca);
  if (termo) {
    query = query.or(`nome_identificado.ilike.%${termo}%,turma.ilike.%${termo}%,uid_nfc.ilike.%${termo}%`);
  }

  const de = Math.max(0, Number(page) || 0) * pageSize;
  query = query.order('data_hora', { ascending: false }).range(de, de + pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data || [], total: count || 0 };
}

export async function inserirHistorico(evento) {
  const { error } = await obterCliente()
    .from('historico_acessos')
    .upsert([evento], { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function historicoDoAluno(alunoId, limite = 50) {
  const { data, error } = await obterCliente()
    .from('historico_acessos')
    .select('*')
    .eq('aluno_id', alunoId)
    .order('data_hora', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

export function assinarHistorico(callback) {
  if (canalHistorico) return canalHistorico;
  canalHistorico = obterCliente()
    .channel('historico-acessos-web')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'historico_acessos' }, (payload) => {
      if (payload?.new) callback(payload.new);
    })
    .subscribe();
  return canalHistorico;
}

export function cancelarAssinaturaHistorico() {
  if (!canalHistorico) return;
  try { obterCliente().removeChannel(canalHistorico); } catch (_) { /* ignora */ }
  canalHistorico = null;
}

// ---------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------

async function verificar(descricao, fn) {
  try {
    const detalhe = await fn();
    return { ok: true, descricao, detalhe: detalhe || 'OK' };
  } catch (erro) {
    return { ok: false, descricao, detalhe: erro?.message || String(erro) };
  }
}

export async function diagnosticarNuvem() {
  const clienteAtual = obterCliente();
  const checks = [];

  checks.push(await verificar('Conexão com a API', async () => {
    const { error } = await clienteAtual.from('alunos').select('id').limit(1);
    if (error) throw error;
    return 'Tabela alunos acessível';
  }));

  checks.push(await verificar('Coluna foto_path (migração)', async () => {
    const { error } = await clienteAtual.from('alunos').select('foto_path').limit(1);
    if (error) throw error;
    return 'Migração aplicada';
  }));

  checks.push(await verificar('Histórico de acessos', async () => {
    const { error } = await clienteAtual.from('historico_acessos').select('id').limit(1);
    if (error) throw error;
    return 'Tabela acessível';
  }));

  checks.push(await verificar('Função de setup', async () => {
    const { data, error } = await clienteAtual.rpc('sistema_precisa_setup');
    if (error) throw error;
    return data === true ? 'Banco sem administrador' : 'Banco configurado';
  }));

  checks.push(await verificar('Bucket de fotos', async () => {
    const { error } = await clienteAtual.storage.from('fotos-alunos').list('', { limit: 1 });
    if (error) throw error;
    return 'Bucket fotos-alunos acessível';
  }));

  return checks;
}

export async function testarConexaoNuvem() {
  const { error } = await obterCliente().from('alunos').select('id').limit(1);
  if (error) throw error;
  return true;
}

export function urlDoProjeto() {
  return normalizarUrlSupabase(obterConfiguracao().supabaseUrl);
}
