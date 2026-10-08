-- =====================================================================
-- ESQUEMA DO BANCO DE DADOS - CONTROLE DE ACESSO ESCOLAR NFC
-- Execute este script no "SQL Editor" do seu painel Supabase
-- =====================================================================

-- 1. Habilitar extensão para geração de UUIDs se necessário
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabela de Alunos
CREATE TABLE IF NOT EXISTS public.alunos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uid_nfc VARCHAR(32) NOT NULL UNIQUE,       -- Ex: "2C:9D:7E:8E" (Chave única da tag)
    nome_completo VARCHAR(120) NOT NULL,
    matricula VARCHAR(30) UNIQUE,
    turma VARCHAR(50) NOT NULL,                -- Ex: "Informática 2", "3º Ano B"
    curso VARCHAR(80),                         -- Ex: "Técnico em Informática", "Ensino Médio"
    nome_responsavel VARCHAR(120),
    telefone_responsavel VARCHAR(25),          -- Ex: "84998765432" (para link direto do WhatsApp)
    foto_url TEXT,                             -- Link da foto no Supabase Storage
    ativo BOOLEAN NOT NULL DEFAULT true,       -- Permissão de entrada ativa
    observacoes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índice para buscas instantâneas por cartão NFC (resposta em menos de 10ms)
CREATE INDEX IF NOT EXISTS idx_alunos_uid_nfc ON public.alunos(uid_nfc);
CREATE INDEX IF NOT EXISTS idx_alunos_nome ON public.alunos(nome_completo);

-- 3. Tabela de Histórico de Acessos e Presenças
CREATE TABLE IF NOT EXISTS public.historico_acessos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uid_nfc VARCHAR(32) NOT NULL,
    aluno_id UUID REFERENCES public.alunos(id) ON DELETE SET NULL,
    nome_identificado VARCHAR(120),
    turma VARCHAR(50),
    tipo_evento VARCHAR(20) DEFAULT 'ENTRADA' NOT NULL, -- 'ENTRADA' ou 'SAIDA'
    status VARCHAR(20) NOT NULL,                        -- 'LIBERADO', 'BLOQUEADO', 'NAO_CADASTRADO'
    data_hora TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_historico_data ON public.historico_acessos(data_hora DESC);

-- 4. Criação do Cofre de Imagens (Storage Bucket para Fotos dos Alunos)
-- Inserção segura no sistema de storage nativo do Supabase
INSERT INTO storage.buckets (id, name, public)
VALUES ('fotos-alunos', 'fotos-alunos', true)
ON CONFLICT (id) DO NOTHING;

-- 5. Políticas de Segurança (Row Level Security - RLS)
-- Permite leitura pública das fotos do bucket para exibição rápida na portaria
CREATE POLICY "Fotos públicas para leitura"
ON storage.objects FOR SELECT
USING (bucket_id = 'fotos-alunos');

-- Permite upload de fotos no bucket fotos-alunos
CREATE POLICY "Upload permitido no fotos-alunos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'fotos-alunos');

-- Permite atualização/substituição de fotos
CREATE POLICY "Atualizacao permitida no fotos-alunos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'fotos-alunos');

-- Permite deleção de fotos
CREATE POLICY "Delecao permitida no fotos-alunos"
ON storage.objects FOR DELETE
USING (bucket_id = 'fotos-alunos');

-- Habilitar RLS nas tabelas mas permitir acesso da API com anon key
ALTER TABLE public.alunos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_acessos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso total aos alunos"
ON public.alunos FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Acesso total ao historico"
ON public.historico_acessos FOR ALL
USING (true)
WITH CHECK (true);

-- 6. Aluno de Teste Inicial (para validação imediata)
INSERT INTO public.alunos (
    uid_nfc, 
    nome_completo, 
    matricula, 
    turma, 
    curso, 
    nome_responsavel, 
    telefone_responsavel, 
    foto_url, 
    ativo
) VALUES (
    '2C:9D:7E:8E', 
    'Lucas Gabriel da Silva', 
    '20241001', 
    'Informática 2', 
    'Técnico em Informática', 
    'Maria Aparecida da Silva', 
    '84998765432', 
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80', 
    true
)
ON CONFLICT (uid_nfc) DO NOTHING;
