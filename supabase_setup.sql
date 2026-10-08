-- =====================================================================
-- ESQUEMA DO BANCO DE DADOS - CONTROLE DE ACESSO ESCOLAR NFC
-- Autenticação, Perfis de Usuário (RBAC) e Políticas de Segurança (RLS)
-- Execute este script no "SQL Editor" do seu painel Supabase
-- =====================================================================

-- 1. Habilitar extensões necessárias para UUID e Criptografia
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================================
-- 2. TABELA DE PERFIS DE USUÁRIOS DO SISTEMA (RBAC)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.perfis_usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    nome_completo TEXT NOT NULL,
    cargo VARCHAR(30) NOT NULL CHECK (cargo IN ('portaria', 'secretaria', 'coordenacao', 'direcao', 'admin')),
    ativo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_perfis_cargo ON public.perfis_usuarios(cargo);
CREATE INDEX IF NOT EXISTS idx_perfis_ativo ON public.perfis_usuarios(ativo);

-- =====================================================================
-- 3. FUNÇÕES AUXILIARES DE PERMISSÃO (SECURITY DEFINER)
-- =====================================================================

-- Obtém o cargo e status do usuário logado
CREATE OR REPLACE FUNCTION public.obter_cargo_usuario(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT cargo FROM public.perfis_usuarios WHERE id = p_user_id AND ativo = true;
$$;

-- Verifica se o usuário atual possui um dos cargos permitidos
CREATE OR REPLACE FUNCTION public.tem_permissao(VARIADIC cargos TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis_usuarios
    WHERE id = auth.uid()
      AND ativo = true
      AND cargo = ANY(cargos)
  );
$$;

-- Retorna os dados do próprio usuário conectado
CREATE OR REPLACE FUNCTION public.obter_meu_perfil()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_res JSON;
BEGIN
    SELECT json_build_object(
        'id', id,
        'email', email,
        'nome_completo', nome_completo,
        'cargo', cargo,
        'ativo', ativo
    ) INTO v_res
    FROM public.perfis_usuarios
    WHERE id = auth.uid();

    RETURN v_res;
END;
$$;

-- Informa se o sistema precisa do cadastro do 1º administrador
CREATE OR REPLACE FUNCTION public.sistema_precisa_setup()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (COUNT(*) = 0) FROM public.perfis_usuarios;
$$;

-- =====================================================================
-- 4. TRIGGERS AUTOMÁTICOS DO SUPABASE AUTH
-- =====================================================================

-- Limpa usuário de teste inconsistente anterior se houver
DELETE FROM auth.identities WHERE email = 'dev.magary@gmail.com';
DELETE FROM auth.users WHERE email = 'dev.magary@gmail.com';
DELETE FROM public.perfis_usuarios WHERE email = 'dev.magary@gmail.com';

-- Trigger 1: Auto-confirmação imediata de e-mails (elimina dependência de SMTP externo)
CREATE OR REPLACE FUNCTION public.auto_confirmar_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, now());
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_confirmar ON auth.users;
CREATE TRIGGER trg_auto_confirmar
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.auto_confirmar_usuario();

-- Trigger 2: Criação automática do Perfil e Cargo em public.perfis_usuarios
CREATE OR REPLACE FUNCTION public.lidar_novo_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total INT;
    v_cargo TEXT;
    v_nome TEXT;
BEGIN
    SELECT COUNT(*) INTO v_total FROM public.perfis_usuarios;

    -- Se for o primeiro usuário registrado no sistema, vira 'admin' mestre
    IF v_total = 0 THEN
        v_cargo := 'admin';
    ELSE
        v_cargo := COALESCE(new.raw_user_meta_data->>'cargo', 'portaria');
    END IF;

    v_nome := COALESCE(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1));

    INSERT INTO public.perfis_usuarios (id, email, nome_completo, cargo, ativo)
    VALUES (new.id, new.email, v_nome, v_cargo, true)
    ON CONFLICT (id) DO UPDATE
    SET nome_completo = EXCLUDED.nome_completo,
        cargo = CASE WHEN v_total = 0 THEN 'admin' ELSE EXCLUDED.cargo END;

    RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_novo_usuario ON auth.users;
CREATE TRIGGER trg_novo_usuario
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.lidar_novo_usuario();


-- Alterar dados, cargo ou status de um usuário
CREATE OR REPLACE FUNCTION public.admin_alterar_usuario(
    p_user_id UUID,
    p_nome TEXT,
    p_cargo TEXT,
    p_ativo BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.perfis_usuarios 
        WHERE id = auth.uid() AND cargo = 'admin' AND ativo = true
    ) THEN
        RAISE EXCEPTION 'Acesso negado: apenas administradores podem alterar permissões.';
    END IF;

    -- Não permite desativar ou rebaixar a si mesmo se for a conta logada
    IF p_user_id = auth.uid() AND (p_ativo = false OR p_cargo != 'admin') THEN
        RAISE EXCEPTION 'Você não pode desativar ou remover o cargo de administrador da sua própria conta.';
    END IF;

    IF p_cargo NOT IN ('portaria', 'secretaria', 'coordenacao', 'direcao', 'admin') THEN
        RAISE EXCEPTION 'Cargo informado inválido: %', p_cargo;
    END IF;

    UPDATE public.perfis_usuarios
    SET 
        nome_completo = COALESCE(trim(p_nome), nome_completo),
        cargo = COALESCE(p_cargo, cargo),
        ativo = COALESCE(p_ativo, ativo),
        updated_at = now()
    WHERE id = p_user_id;

    RETURN json_build_object('ok', true);
END;
$$;

-- Redefinir senha de um usuário
CREATE OR REPLACE FUNCTION public.admin_redefinir_senha(
    p_user_id UUID,
    p_nova_senha TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.perfis_usuarios 
        WHERE id = auth.uid() AND cargo = 'admin' AND ativo = true
    ) THEN
        RAISE EXCEPTION 'Acesso negado: apenas administradores podem redefinir senhas.';
    END IF;

    IF length(p_nova_senha) < 6 THEN
        RAISE EXCEPTION 'A nova senha deve ter no mínimo 6 caracteres.';
    END IF;

    UPDATE auth.users
    SET encrypted_password = crypt(p_nova_senha, gen_salt('bf')),
        updated_at = now()
    WHERE id = p_user_id;

    RETURN json_build_object('ok', true);
END;
$$;

-- Excluir usuário do sistema
CREATE OR REPLACE FUNCTION public.admin_excluir_usuario(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Você não pode excluir sua própria conta enquanto estiver conectado nela.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.perfis_usuarios 
        WHERE id = auth.uid() AND cargo = 'admin' AND ativo = true
    ) THEN
        RAISE EXCEPTION 'Acesso negado: apenas administradores podem excluir contas.';
    END IF;

    DELETE FROM auth.users WHERE id = p_user_id;

    RETURN json_build_object('ok', true);
END;
$$;

-- =====================================================================
-- 5. TABELA DE ALUNOS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.alunos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uid_nfc VARCHAR(32) NOT NULL UNIQUE,
    nome_completo VARCHAR(120) NOT NULL,
    matricula VARCHAR(30) UNIQUE,
    turma VARCHAR(50) NOT NULL,
    curso VARCHAR(80),
    nome_responsavel VARCHAR(120),
    telefone_responsavel VARCHAR(25),
    foto_url TEXT,
    ativo BOOLEAN NOT NULL DEFAULT true,
    observacoes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alunos_uid_nfc ON public.alunos(uid_nfc);
CREATE INDEX IF NOT EXISTS idx_alunos_nome ON public.alunos(nome_completo);

-- =====================================================================
-- 6. TABELA DE HISTÓRICO DE ACESSOS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.historico_acessos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uid_nfc VARCHAR(32) NOT NULL,
    aluno_id UUID REFERENCES public.alunos(id) ON DELETE SET NULL,
    nome_identificado VARCHAR(120),
    turma VARCHAR(50),
    tipo_evento VARCHAR(20) DEFAULT 'ENTRADA' NOT NULL,
    status VARCHAR(20) NOT NULL,
    data_hora TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_historico_data ON public.historico_acessos(data_hora DESC);

-- =====================================================================
-- 7. STORAGE BUCKET PARA FOTOS DOS ALUNOS
-- =====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('fotos-alunos', 'fotos-alunos', true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- 8. POLÍTICAS DE SEGURANÇA (ROW LEVEL SECURITY - RLS)
-- =====================================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE public.perfis_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alunos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_acessos ENABLE ROW LEVEL SECURITY;

-- Limpar políticas antigas se existirem para evitar erro de duplicidade
DROP POLICY IF EXISTS "Acesso total aos alunos" ON public.alunos;
DROP POLICY IF EXISTS "Alunos leitura autorizada" ON public.alunos;
DROP POLICY IF EXISTS "Alunos escrita secretaria e admin" ON public.alunos;
DROP POLICY IF EXISTS "Alunos update secretaria e admin" ON public.alunos;
DROP POLICY IF EXISTS "Alunos exclusao" ON public.alunos;

DROP POLICY IF EXISTS "Acesso total ao historico" ON public.historico_acessos;
DROP POLICY IF EXISTS "Historico leitura" ON public.historico_acessos;
DROP POLICY IF EXISTS "Historico insercao" ON public.historico_acessos;
DROP POLICY IF EXISTS "Historico exclusao" ON public.historico_acessos;

DROP POLICY IF EXISTS "Leitura de perfis" ON public.perfis_usuarios;
DROP POLICY IF EXISTS "Admin gerencia perfis" ON public.perfis_usuarios;

-- Políticas para PERFIS DE USUÁRIOS:
-- Usuários autenticados podem ver os perfis (para saber quem é quem no painel)
CREATE POLICY "Leitura de perfis"
ON public.perfis_usuarios FOR SELECT
TO authenticated
USING (true);

-- Apenas Admin pode atualizar diretamente
CREATE POLICY "Admin gerencia perfis"
ON public.perfis_usuarios FOR ALL
TO authenticated
USING (public.tem_permissao('admin'))
WITH CHECK (public.tem_permissao('admin'));

-- Políticas para ALUNOS:
-- Portaria, Secretaria, Coordenação, Direção e Admin podem ler
CREATE POLICY "Alunos leitura autorizada"
ON public.alunos FOR SELECT
TO authenticated
USING (public.tem_permissao('portaria', 'secretaria', 'coordenacao', 'direcao', 'admin'));

-- Apenas Secretaria, Coordenação, Direção e Admin podem cadastrar e atualizar
CREATE POLICY "Alunos escrita secretaria e admin"
ON public.alunos FOR INSERT
TO authenticated
WITH CHECK (public.tem_permissao('secretaria', 'coordenacao', 'direcao', 'admin'));

CREATE POLICY "Alunos update secretaria e admin"
ON public.alunos FOR UPDATE
TO authenticated
USING (public.tem_permissao('secretaria', 'coordenacao', 'direcao', 'admin'))
WITH CHECK (public.tem_permissao('secretaria', 'coordenacao', 'direcao', 'admin'));

-- Apenas Secretaria, Direção e Admin podem excluir aluno
CREATE POLICY "Alunos exclusao"
ON public.alunos FOR DELETE
TO authenticated
USING (public.tem_permissao('secretaria', 'direcao', 'admin'));

-- Políticas para HISTÓRICO DE ACESSOS:
CREATE POLICY "Historico leitura"
ON public.historico_acessos FOR SELECT
TO authenticated
USING (public.tem_permissao('portaria', 'secretaria', 'coordenacao', 'direcao', 'admin'));

CREATE POLICY "Historico insercao"
ON public.historico_acessos FOR INSERT
TO authenticated
WITH CHECK (public.tem_permissao('portaria', 'secretaria', 'coordenacao', 'direcao', 'admin'));

CREATE POLICY "Historico exclusao"
ON public.historico_acessos FOR DELETE
TO authenticated
USING (public.tem_permissao('direcao', 'admin'));

-- Políticas de Storage para fotos:
DROP POLICY IF EXISTS "Fotos públicas para leitura" ON storage.objects;
DROP POLICY IF EXISTS "Upload permitido no fotos-alunos" ON storage.objects;
DROP POLICY IF EXISTS "Atualizacao permitida no fotos-alunos" ON storage.objects;
DROP POLICY IF EXISTS "Delecao permitida no fotos-alunos" ON storage.objects;

-- Leitura das fotos no bucket
CREATE POLICY "Fotos públicas para leitura"
ON storage.objects FOR SELECT
USING (bucket_id = 'fotos-alunos');

-- Apenas Secretaria, Coordenação, Direção e Admin podem subir ou alterar fotos
CREATE POLICY "Upload permitido no fotos-alunos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'fotos-alunos' AND
    public.tem_permissao('secretaria', 'coordenacao', 'direcao', 'admin')
);

CREATE POLICY "Atualizacao permitida no fotos-alunos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'fotos-alunos' AND
    public.tem_permissao('secretaria', 'coordenacao', 'direcao', 'admin')
);

CREATE POLICY "Delecao permitida no fotos-alunos"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'fotos-alunos' AND
    public.tem_permissao('secretaria', 'direcao', 'admin')
);

-- =====================================================================
-- 9. PERMISSÕES DE EXECUÇÃO DAS FUNÇÕES (GRANT EXECUTE)
-- =====================================================================
GRANT EXECUTE ON FUNCTION public.sistema_precisa_setup() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obter_meu_perfil() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alterar_usuario(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_redefinir_senha(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_excluir_usuario(UUID) TO authenticated;

