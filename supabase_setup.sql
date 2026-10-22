-- =====================================================================
-- ESQUEMA DO BANCO DE DADOS - CONTROLE DE ACESSO ESCOLAR NFC
-- Autenticação, Perfis de Usuário (RBAC), Alunos, Histórico e RLS
-- =====================================================================
-- COMO USAR
--   * Banco NOVO: execute este arquivo inteiro no "SQL Editor" do Supabase.
--   * Banco JÁ EXISTENTE: prefira a migração incremental
--     supabase/migrations/20261022_hardening.sql (também idempotente).
--   * Este script é idempotente: CREATE IF NOT EXISTS / CREATE OR REPLACE
--     e nenhum DROP TABLE ou DELETE em massa é executado.
--
-- ENDURECIMENTO DE SEGURANÇA APLICADO NESTA VERSÃO
--   1) public.lidar_novo_usuario IGNORA o cargo enviado em
--      raw_user_meta_data. O primeiro perfil criado vira 'admin' ativo;
--      os demais entram SEMPRE como 'portaria' e INATIVOS, precisando de
--      ativação por um administrador. Isso fecha a escalada de privilégio
--      via signup público (anon key) -> cargo 'admin'.
--   2) admin_alterar_usuario / admin_excluir_usuario impedem rebaixar,
--      bloquear ou excluir o ÚLTIMO administrador ativo do sistema.
--   3) public.alunos.foto_path (caminho no bucket) + backfill a partir de
--      foto_url e limpeza de foto_url 'data:' (avatar SVG gravado por bug).
--   4) updated_at automático (trigger) e uid_nfc normalizado (upper/trim).
--   5) Índices para o histórico de acessos e publicação idempotente em
--      supabase_realtime.
-- Nenhum dado de alunos/perfis/histórico é apagado por este script.
-- =====================================================================

-- =====================================================================
-- 1. EXTENSÕES NECESSÁRIAS (UUID e criptografia de senha)
-- =====================================================================
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

-- Obtém o cargo do usuário informado (somente se estiver ativo).
CREATE OR REPLACE FUNCTION public.obter_cargo_usuario(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT cargo FROM public.perfis_usuarios WHERE id = p_user_id AND ativo = true;
$$;

-- Verifica se o usuário logado possui um dos cargos permitidos.
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

-- Retorna os dados do próprio usuário conectado.
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

-- Informa se o sistema precisa do cadastro do 1º administrador.
-- Deve continuar acessível para o papel "anon" (tela de primeiro acesso).
CREATE OR REPLACE FUNCTION public.sistema_precisa_setup()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (COUNT(*) = 0) FROM public.perfis_usuarios;
$$;

-- Função genérica de manutenção: carimba updated_at = now() em cada UPDATE.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- =====================================================================
-- 4. TRIGGERS AUTOMÁTICOS DO SUPABASE AUTH
-- =====================================================================

-- Trigger 1: auto-confirmação imediata de e-mails (elimina dependência
-- de SMTP externo no ambiente escolar). Mantido como estava.
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

-- Trigger 2: criação automática do perfil em public.perfis_usuarios.
-- SEGURANÇA: o cargo NUNCA vem de raw_user_meta_data (dado controlado pelo
-- cliente). Primeiro perfil => admin ativo; demais => portaria inativo.
CREATE OR REPLACE FUNCTION public.lidar_novo_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total INT;
    v_cargo TEXT;
    v_ativo BOOLEAN;
    v_nome TEXT;
BEGIN
    -- Serializa signups simultâneos para que a contagem do "primeiro usuário"
    -- seja confiável (evita dois primeiros admins em condição de corrida).
    PERFORM pg_advisory_xact_lock(hashtext('public.lidar_novo_usuario')::bigint);

    SELECT COUNT(*) INTO v_total FROM public.perfis_usuarios;

    -- Primeiro perfil do sistema: administrador mestre ativo.
    -- Qualquer outro perfil: portaria, INATIVO, aguardando ativação.
    IF v_total = 0 THEN
        v_cargo := 'admin';
        v_ativo := true;
    ELSE
        v_cargo := 'portaria';
        v_ativo := false;
    END IF;

    -- Do metadado usamos APENAS o nome (nunca o cargo).
    v_nome := COALESCE(
        NULLIF(btrim(new.raw_user_meta_data->>'nome'), ''),
        split_part(new.email, '@', 1)
    );

    INSERT INTO public.perfis_usuarios (id, email, nome_completo, cargo, ativo)
    VALUES (new.id, new.email, v_nome, v_cargo, v_ativo)
    ON CONFLICT (id) DO UPDATE
    -- Em conflito preservamos cargo/ativo já existentes; só sincronizamos
    -- e-mail e nome. Nunca promovemos cargo em um re-trigger.
    SET email = EXCLUDED.email,
        nome_completo = EXCLUDED.nome_completo;

    RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_novo_usuario ON auth.users;
CREATE TRIGGER trg_novo_usuario
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.lidar_novo_usuario();

-- =====================================================================
-- 5. FUNÇÕES ADMINISTRATIVAS (RBAC)
-- =====================================================================

-- Altera nome, cargo e/ou status de um usuário.
-- Proteções: apenas admin ativo; não rebaixa/bloqueia a si mesmo; não
-- rebaixa/bloqueia o último administrador ativo do sistema.
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
DECLARE
    v_cargo_atual TEXT;
    v_ativo_atual BOOLEAN;
    v_novo_cargo TEXT;
    v_novo_ativo BOOLEAN;
    v_outros_admins INT;
BEGIN
    -- Autorização: somente administrador ativo pode alterar permissões.
    IF NOT EXISTS (
        SELECT 1 FROM public.perfis_usuarios
        WHERE id = auth.uid() AND cargo = 'admin' AND ativo = true
    ) THEN
        RAISE EXCEPTION 'Acesso negado: apenas administradores ativos podem alterar permissões.';
    END IF;

    -- Bloqueia, em ordem determinística, todos os administradores ativos
    -- (evita deadlock entre dois admins se alterando ao mesmo tempo) e em
    -- seguida a linha do alvo. Garante consistência da regra do "último admin".
    PERFORM 1 FROM public.perfis_usuarios
    WHERE cargo = 'admin' AND ativo = true
    ORDER BY id
    FOR UPDATE;

    SELECT cargo, ativo INTO v_cargo_atual, v_ativo_atual
    FROM public.perfis_usuarios
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuário não encontrado na tabela de perfis (id: %).', p_user_id;
    END IF;

    -- Cargo/ativo efetivos após a operação (NULL = manter valor atual).
    v_novo_cargo := COALESCE(p_cargo, v_cargo_atual);
    v_novo_ativo := COALESCE(p_ativo, v_ativo_atual);

    IF v_novo_cargo NOT IN ('portaria', 'secretaria', 'coordenacao', 'direcao', 'admin') THEN
        RAISE EXCEPTION 'Cargo informado inválido: %. Valores aceitos: portaria, secretaria, coordenacao, direcao, admin.', v_novo_cargo;
    END IF;

    -- Mantém a proibição original de auto-rebaixamento / auto-bloqueio.
    IF p_user_id = auth.uid() AND (v_novo_cargo <> 'admin' OR v_novo_ativo = false) THEN
        RAISE EXCEPTION 'Você não pode desativar ou remover o cargo de administrador da sua própria conta.';
    END IF;

    -- Se o alvo é um admin ativo e deixará de ser, exige outro admin ativo.
    IF v_cargo_atual = 'admin' AND v_ativo_atual = true
       AND (v_novo_cargo <> 'admin' OR v_novo_ativo = false) THEN
        SELECT COUNT(*) INTO v_outros_admins
        FROM public.perfis_usuarios
        WHERE cargo = 'admin' AND ativo = true AND id <> p_user_id;

        IF v_outros_admins = 0 THEN
            RAISE EXCEPTION 'Operação bloqueada: este é o último administrador ativo do sistema. Ative ou promova outro administrador antes de rebaixar ou bloquear esta conta.';
        END IF;
    END IF;

    UPDATE public.perfis_usuarios
    SET
        nome_completo = COALESCE(NULLIF(btrim(p_nome), ''), nome_completo),
        cargo = v_novo_cargo,
        ativo = v_novo_ativo,
        updated_at = now()
    WHERE id = p_user_id;

    RETURN json_build_object('ok', true);
END;
$$;

-- Redefinir senha de um usuário (somente admin ativo).
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
        RAISE EXCEPTION 'Acesso negado: apenas administradores ativos podem redefinir senhas.';
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

-- Exclui usuário do sistema (somente admin ativo).
-- Proteções: não exclui a própria conta; não exclui o último admin ativo.
CREATE OR REPLACE FUNCTION public.admin_excluir_usuario(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_cargo_atual TEXT;
    v_ativo_atual BOOLEAN;
    v_outros_admins INT;
BEGIN
    -- Mantém a proibição de autoexclusão.
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Você não pode excluir sua própria conta enquanto estiver conectado nela.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.perfis_usuarios
        WHERE id = auth.uid() AND cargo = 'admin' AND ativo = true
    ) THEN
        RAISE EXCEPTION 'Acesso negado: apenas administradores ativos podem excluir contas.';
    END IF;

    -- Bloqueia, em ordem determinística, todos os administradores ativos
    -- (evita deadlock entre dois admins se excluindo ao mesmo tempo) e em
    -- seguida a linha do alvo.
    PERFORM 1 FROM public.perfis_usuarios
    WHERE cargo = 'admin' AND ativo = true
    ORDER BY id
    FOR UPDATE;

    SELECT cargo, ativo INTO v_cargo_atual, v_ativo_atual
    FROM public.perfis_usuarios
    WHERE id = p_user_id
    FOR UPDATE;

    -- O perfil pode não existir (usuário legado só no auth); nesse caso a
    -- exclusão do auth.users continua permitida, pois não há admin a perder.
    IF FOUND AND v_cargo_atual = 'admin' AND v_ativo_atual = true THEN
        SELECT COUNT(*) INTO v_outros_admins
        FROM public.perfis_usuarios
        WHERE cargo = 'admin' AND ativo = true AND id <> p_user_id;

        IF v_outros_admins = 0 THEN
            RAISE EXCEPTION 'Operação bloqueada: este é o último administrador ativo do sistema. Ative ou promova outro administrador antes de excluir esta conta.';
        END IF;
    END IF;

    DELETE FROM auth.users WHERE id = p_user_id;

    RETURN json_build_object('ok', true);
END;
$$;

-- =====================================================================
-- 6. TABELA DE ALUNOS
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
    -- Caminho do objeto dentro do bucket "fotos-alunos" (ex.: pasta/foto.jpg).
    -- É a fonte de verdade para gerar URLs assinadas/públicas no app.
    foto_path TEXT,
    ativo BOOLEAN NOT NULL DEFAULT true,
    observacoes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alunos_uid_nfc ON public.alunos(uid_nfc);
CREATE INDEX IF NOT EXISTS idx_alunos_nome ON public.alunos(nome_completo);

-- Garante a nova coluna também em bancos criados por versões anteriores.
ALTER TABLE public.alunos ADD COLUMN IF NOT EXISTS foto_path TEXT;

-- Backfill de foto_path a partir de foto_url:
--   * Só extrai quando a URL aponta para o bucket "fotos-alunos".
--   * Extrai o caminho após '/fotos-alunos/' e remove querystring (?token=...).
--   * Não sobrescreve foto_path já preenchido.
-- Também limpa foto_url gravada como data: (avatares SVG gerados por bug).
DO $$
DECLARE
    v_afetadas INT;
BEGIN
    UPDATE public.alunos
    SET foto_path = split_part(split_part(foto_url, '/fotos-alunos/', 2), '?', 1)
    WHERE foto_path IS NULL
      AND foto_url LIKE '%/fotos-alunos/%'
      AND split_part(split_part(foto_url, '/fotos-alunos/', 2), '?', 1) <> '';

    GET DIAGNOSTICS v_afetadas = ROW_COUNT;
    RAISE NOTICE 'Backfill de foto_path: % registro(s) atualizado(s).', v_afetadas;

    UPDATE public.alunos
    SET foto_url = NULL
    WHERE foto_url ILIKE 'data:%';

    GET DIAGNOSTICS v_afetadas = ROW_COUNT;
    RAISE NOTICE 'Limpeza de foto_url com "data:": % registro(s) atualizado(s).', v_afetadas;
END;
$$;

-- =====================================================================
-- 7. NORMALIZAÇÃO DO UID NFC (upper/trim) COM VALIDAÇÃO PRÉVIA
-- =====================================================================

-- 7.1 Validação: se a normalização geraria UIDs duplicados, ABORTA antes
-- de tocar em qualquer dado, listando os UIDs conflitantes. Assim a
-- migração nunca falha silenciosamente nem deixa o banco em estado parcial.
DO $$
DECLARE
    v_duplicados TEXT;
BEGIN
    SELECT string_agg(format('%s (%s ocorrência(s))', uid_norm, qtd), ', ' ORDER BY uid_norm)
    INTO v_duplicados
    FROM (
        SELECT upper(btrim(uid_nfc)) AS uid_norm, COUNT(*) AS qtd
        FROM public.alunos
        GROUP BY upper(btrim(uid_nfc))
        HAVING COUNT(*) > 1
    ) AS d;

    IF v_duplicados IS NOT NULL THEN
        RAISE EXCEPTION 'Normalização abortada: existem UIDs NFC duplicados após upper/trim: %. Resolva/una esses registros manualmente e execute novamente.', v_duplicados;
    END IF;
END;
$$;

-- 7.2 Aplicação da normalização nos registros existentes (somente após a
-- checagem acima). Bancos novos não têm linhas: o UPDATE é no-op.
UPDATE public.alunos
SET uid_nfc = upper(btrim(uid_nfc))
WHERE uid_nfc <> upper(btrim(uid_nfc));

-- 7.3 Trigger que normaliza automaticamente todo INSERT/UPDATE futuro.
CREATE OR REPLACE FUNCTION public.normalizar_uid_nfc_aluno()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.uid_nfc IS NOT NULL THEN
        NEW.uid_nfc := upper(btrim(NEW.uid_nfc));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alunos_normalizar_uid ON public.alunos;
CREATE TRIGGER trg_alunos_normalizar_uid
BEFORE INSERT OR UPDATE ON public.alunos
FOR EACH ROW EXECUTE FUNCTION public.normalizar_uid_nfc_aluno();

-- =====================================================================
-- 8. TABELA DE HISTÓRICO DE ACESSOS E ÍNDICES
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

-- Índices para o totem/painel: listagem por data, histórico por aluno e
-- filtros por status (presente/atrasado/saída etc.).
CREATE INDEX IF NOT EXISTS idx_historico_data ON public.historico_acessos(data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_historico_aluno_data ON public.historico_acessos(aluno_id, data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_historico_status ON public.historico_acessos(status);

-- =====================================================================
-- 9. STORAGE BUCKET PARA FOTOS DOS ALUNOS
-- =====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('fotos-alunos', 'fotos-alunos', true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- 10. POLÍTICAS DE SEGURANÇA (ROW LEVEL SECURITY - RLS)
-- =====================================================================
-- Revisão das políticas existentes: RLS restritivo por cargo.
--   * Leitura de perfis: cada usuário vê o próprio perfil; admin lista todos.
--     As mutações passam exclusivamente pelas RPCs admin_* (SECURITY DEFINER),
--     que validam cargo e a regra do último administrador ativo.
--   * O histórico é append-only na prática: não existe política de UPDATE.
--   * O bucket das fotos é público para leitura (necessário para o totem).

-- Habilita RLS em todas as tabelas (idempotente).
ALTER TABLE public.perfis_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alunos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_acessos ENABLE ROW LEVEL SECURITY;

-- Limpa políticas antigas das tabelas públicas para evitar duplicidade.
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
-- Cada usuário vê o próprio perfil; apenas admin pode listar todos.
-- Não há política de INSERT/UPDATE/DELETE direto: as mutações usam as RPCs
-- admin_* (SECURITY DEFINER), que validam o último administrador ativo.
CREATE POLICY "Leitura de perfis"
ON public.perfis_usuarios FOR SELECT
TO authenticated
USING (id = auth.uid() OR public.tem_permissao('admin'));

-- Políticas para ALUNOS:
-- Portaria, Secretaria, Coordenação, Direção e Admin podem ler.
CREATE POLICY "Alunos leitura autorizada"
ON public.alunos FOR SELECT
TO authenticated
USING (public.tem_permissao('portaria', 'secretaria', 'coordenacao', 'direcao', 'admin'));

-- Apenas Secretaria, Coordenação, Direção e Admin podem cadastrar e atualizar.
CREATE POLICY "Alunos escrita secretaria e admin"
ON public.alunos FOR INSERT
TO authenticated
WITH CHECK (public.tem_permissao('secretaria', 'coordenacao', 'direcao', 'admin'));

CREATE POLICY "Alunos update secretaria e admin"
ON public.alunos FOR UPDATE
TO authenticated
USING (public.tem_permissao('secretaria', 'coordenacao', 'direcao', 'admin'))
WITH CHECK (public.tem_permissao('secretaria', 'coordenacao', 'direcao', 'admin'));

-- Apenas Secretaria, Direção e Admin podem excluir aluno.
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

-- Leitura das fotos no bucket (bucket público: totem e painel leem sem login).
CREATE POLICY "Fotos públicas para leitura"
ON storage.objects FOR SELECT
USING (bucket_id = 'fotos-alunos');

-- Apenas Secretaria, Coordenação, Direção e Admin podem subir ou alterar fotos.
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
-- 11. TRIGGERS DE MANUTENÇÃO (updated_at automático)
-- =====================================================================
DROP TRIGGER IF EXISTS trg_perfis_updated_at ON public.perfis_usuarios;
CREATE TRIGGER trg_perfis_updated_at
BEFORE UPDATE ON public.perfis_usuarios
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_alunos_updated_at ON public.alunos;
CREATE TRIGGER trg_alunos_updated_at
BEFORE UPDATE ON public.alunos
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 12. REALTIME (publicação supabase_realtime)
-- =====================================================================
-- Idempotente: adiciona a tabela só se a publicação existir, se a tabela
-- já não estiver publicada e se ela própria existir. Se a publicação não
-- existir (projeto sem Realtime), apenas registra um NOTICE, sem erro.
DO $$
BEGIN
    IF to_regclass('public.historico_acessos') IS NULL THEN
        RAISE NOTICE 'Realtime: public.historico_acessos não existe; nada a publicar.';
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        RAISE NOTICE 'Realtime: publicação supabase_realtime inexistente; nada a fazer.';
    ELSIF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'historico_acessos'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.historico_acessos';
        RAISE NOTICE 'Realtime: public.historico_acessos adicionada à publicação supabase_realtime.';
    ELSE
        RAISE NOTICE 'Realtime: public.historico_acessos já estava publicada.';
    END IF;
END;
$$;

-- =====================================================================
-- 13. PERMISSÕES DE EXECUÇÃO (GRANT/REVOKE)
-- =====================================================================
-- Funções de trigger não exigem EXECUTE em tempo de execução; revogar o
-- acesso público reduz a superfície de ataque via API PostgREST.
REVOKE ALL ON FUNCTION public.auto_confirmar_usuario() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lidar_novo_usuario() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalizar_uid_nfc_aluno() FROM PUBLIC, anon, authenticated;

-- RPCs administrativas: somente usuários autenticados (as próprias funções
-- ainda validam auth.uid(), cargo admin e ativo = true).
REVOKE ALL ON FUNCTION public.admin_alterar_usuario(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_redefinir_senha(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_excluir_usuario(UUID) FROM PUBLIC, anon;

-- RPCs usadas pelo app.
REVOKE ALL ON FUNCTION public.sistema_precisa_setup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.obter_meu_perfil() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.obter_cargo_usuario(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tem_permissao(TEXT[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sistema_precisa_setup() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obter_meu_perfil() TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_cargo_usuario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tem_permissao(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alterar_usuario(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_redefinir_senha(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_excluir_usuario(UUID) TO authenticated;
