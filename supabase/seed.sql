-- =====================================================================
-- seed.sql — dados de demonstração do laboratório offline
-- ---------------------------------------------------------------------------
-- Roda automaticamente no fim de `supabase db reset` (config: [db.seed]).
-- São alunos fictícios para exercitar: cadastro, totem, histórico, foto e
-- bloqueio de aluno inativo. NADA aqui vai para o banco de produção.
-- =====================================================================

INSERT INTO public.alunos
  (uid_nfc, biometria_id, nome_completo, matricula, turma, curso, nome_responsavel, telefone_responsavel, ativo, observacoes)
VALUES
  ('04:A1:B2:C3', 1,    'Ana Beatriz Souza',   '2026001', '9º Ano A',  'Ensino Fundamental',        'Marcos Souza',    '(31) 99999-0001', true,  'Mãe autoriza saída sozinha após 17h.'),
  ('11:22:33:44', 2,    'Bruno de Carvalho',   '2026002', '1º Ano B',  'Técnico em Informática',    'Juliana Carvalho','(31) 99999-0002', true,  NULL),
  ('04:5A:1B:C2', NULL, 'Carla Evangelista Martins', '2026003', '2º Ano A', 'Técnico em Administração', 'Rita Martins',  '(31) 99999-0003', true,  'Usa óculos; pré-matrícula transferida em 03/2026.'),
  ('FF:10:20:30', NULL, 'Diego Nunes Lopes',   '2026004', '3º Ano C',  'Técnico em Eletrônica',     'Anderson Lopes',  '(31) 99999-0004', true,  NULL),
  -- Este registro tem espaços e minúsculas de propósito: a trigger do banco
  -- normaliza para 04FF11AA (testar leitura do cartão na própria física).
  (' 04ff11aa ',  NULL, 'Elisa Rios',          '2026005', '9º Ano B',  'Ensino Fundamental',        'Paula Rios',      '(31) 99999-0005', true,  'UID gravado sem separadores.Storage Teste de normalização.'),
  ('05:6E:2F:A0', 6,    'Felipe Duarte',       '2026006', '1º Ano A',  'Técnico em Informática',    'Sandra Duarte',   '(31) 99999-0006', false, 'Bloqueado por inadimplência até 15/03/2026.'),
  ('FB:10:00:07', 7,    'Gabriela Almeida',    '2026007', '2º Ano B',  'Técnico em Informática',    'Ricardo Almeida', '(31) 99999-0007', true,  'Aluna cadastrada exclusivamente por Biometria (Digital #7).')
ON CONFLICT (uid_nfc) DO NOTHING;

-- Histórico de exemplo com data coerente (alimenta a fila do Realtime sem
-- poluir). O NOT EXISTS é o guard real: evita duplicar se alguém rodar o
-- seed duas vezes à mão (o `db reset` sempre zera o banco antes).
INSERT INTO public.historico_acessos
  (uid_nfc, aluno_id, nome_identificado, turma, tipo_evento, status, data_hora)
SELECT a.uid_nfc, a.id, a.nome_completo, a.turma, 'ENTRADA', 'LIBERADO', now() - interval '1 day'
FROM public.alunos a
WHERE a.ativo = true
  AND NOT EXISTS (
    SELECT 1 FROM public.historico_acessos h
    WHERE h.aluno_id = a.id
      AND h.data_hora >= now() - interval '1 day 1 hour'
      AND h.data_hora <= now()
  );
