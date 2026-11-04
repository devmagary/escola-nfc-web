-- =====================================================================
-- seed.sql — dados de demonstração do laboratório offline
-- ---------------------------------------------------------------------------
-- Roda automaticamente no fim de `supabase db reset` (config: [db.seed]).
-- São alunos fictícios para exercitar: cadastro, totem, histórico, foto e
-- bloqueio de aluno inativo. NADA aqui vai para o banco de produção.
-- =====================================================================

INSERT INTO public.alunos
  (uid_nfc, nome_completo, matricula, turma, curso, nome_responsavel, telefone_responsavel, ativo, observacoes)
VALUES
  ('04:A1:B2:C3', 'Ana Beatriz Souza',   '2026001', '9º Ano A',  'Ensino Fundamental',        'Marcos Souza',    '(31) 99999-0001', true,  'Mãe autoriza saída sozinha após 17h.'),
  ('11:22:33:44', 'Bruno de Carvalho',   '2026002', '1º Ano B',  'Técnico em Informática',    'Juliana Carvalho','(31) 99999-0002', true,  NULL),
  ('04:5A:1B:C2', 'Carla Evangelista Martins', '2026003', '2º Ano A', 'Técnico em Administração', 'Rita Martins',  '(31) 99999-0003', true,  'Usa óculos; pré-matrícula transferida em 03/2026.'),
  ('FF:10:20:30', 'Diego Nunes Lopes',   '2026004', '3º Ano C',  'Técnico em Eletrônica',     'Anderson Lopes',  '(31) 99999-0004', true,  NULL),
  -- Este registro tem espaços e minúsculas de propósito: a trigger do banco
  -- normaliza para 04FF11AA (testar leitura do cartão na própria física).
  (' 04ff11aa ', 'Elisa Rios',           '2026005', '9º Ano B',  'Ensino Fundamental',        'Paula Rios',      '(31) 99999-0005', true,  'UID gravado sem separadores.Storage Teste de normalização.'),
  ('05:6E:2F:A0', 'Felipe Duarte',       '2026006', '1º Ano A',  'Técnico em Informática',    'Sandra Duarte',   '(31) 99999-0006', false, 'Bloqueado por inadimplência até 15/03/2026.')
ON CONFLICT (uid_nfc) DO NOTHING;

-- Histórico de exemplo com datas coerentes (rasa a fila do Realtime sem poluir).
INSERT INTO public.historico_acessos
  (uid_nfc, aluno_id, nome_identificado, turma, tipo_evento, status, data_hora)
SELECT a.uid_nfc, a.id, a.nome_completo, a.turma, 'ENTRADA', 'LIBERADO', now() - interval '1 day'
FROM public.alunos a
WHERE a.ativo = true
ON CONFLICT (id) DO NOTHING;
