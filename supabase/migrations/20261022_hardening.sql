-- =====================================================================
-- MIGRAÇÃO DE HARDENING - 2026-10-22
-- Banco existente (produção) / Supabase SQL Editor
-- =====================================================================
-- O QUE ESTA MIGRAÇÃO FAZ
--   1) Substitui public.lidar_novo_usuario: o cargo de signup em
--      raw_user_meta_data é IGNORADO. Primeiro perfil => admin ativo;
--      demais => 'portaria' INATIVO. Fecha a escalada de privilégio.
--   2) Endurece admin_alterar_usuario / admin_excluir_usuario para impedir
--      rebaixar, bloquear ou excluir o ÚLTIMO administrador ativo.
--   3) Adiciona public.alunos.foto_path + backfill a partir de foto_url do
--      bucket "fotos-alunos" e limpa foto_url gravada como "data:".
--   4) Cria public.set_updated_at() e triggers de updated_at em alunos e
--      perfis_usuarios.
--   5) Cria os índices do histórico de acessos.
--   6) Publica historico_acessos em supabase_realtime (idempotente).
--   7) Normaliza uid_nfc (upper/trim) com validação prévia: se houver
--      duplicados após a normalização, a migração ABORTA e lista os UIDs.
--   8) Revisa/confirma RLS (habilita onde faltar e audita as políticas
--      esperadas) e garante que sistema_precisa_setup siga acessível a anon.
--
-- COMO RODAR (produção)
--   * Faça um backup/snapshot do projeto antes.
--   * Abra o SQL Editor, cole o arquivo INTEIRO e execute uma única vez.
--   * O editor roda o script em uma transação: se qualquer etapa lançar
--     exceção (por exemplo, UIDs duplicados), nada é aplicado.
--   * É idempotente: pode ser reexecutada com segurança.
--   * Não há DROP TABLE, TRUNCATE nem DELETE de alunos/perfis/histórico.
--   * Se as tabelas base não existirem (projeto vazio), a migração apenas
--     emite NOTICEs e não falha; nesse caso use supabase_setup.sql.
--
-- ORDEM RECOMENDADA EM BANCO EXISTENTE: apenas esta migração.
-- Manter em sincronia com supabase_setup.sql (instalação nova completa).
--
-- INTEGRAÇÃO COM O APP (importante para o deploy)
--   * Novos cadastros passam a entrar como 'portaria' INATIVOS. O fluxo de
--     criação de usuário deve, logo após o signUp, chamar
--     admin_alterar_usuario para definir cargo/ativo (o frontend novo já
--     faz isso; o app.js antigo não fazia e precisaria ser ajustado).
--   * O app deve ler alunos.foto_path (fallback para foto_url).
--   * Se a aplicação assinava historico_acessos no Realtime, a publicação
--     desta migração é o que habilita os eventos.
-- =====================================================================

-- =====================================================================
-- 1. FUNÇÕES DE SEGURANÇA E MANUTENÇÃO (CREATE OR REPLACE = idempotente)
-- =====================================================================

-- 1.1 Manutenção genérica de updated_at.
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

-- 1.2 Normalização de UID NFC usada pelo trigger de alunos.
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

-- 1.3 Trigger de criação de perfil, agora SEM confiar no cliente.
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

-- 1.4 Alteração de usuário com proteção do último admin ativo.
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

-- 1.5 Exclusão de usuário com proteção do último admin ativo e autoexclusão.
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
-- 2. RECRIA O TRIGGER DE NOVO USUÁRIO APONTANDO PARA A FUNÇÃO ENDURECIDA
-- =====================================================================
DO $do$
BEGIN
    IF to_regclass('auth.users') IS NULL OR to_regclass('public.perfis_usuarios') IS NULL THEN
        RAISE NOTICE 'Migração: auth.users e/ou public.perfis_usuarios ausente(s); trigger trg_novo_usuario NÃO foi recriado. Rode supabase_setup.sql para instalação completa.';
    ELSE
        DROP TRIGGER IF EXISTS trg_novo_usuario ON auth.users;
        CREATE TRIGGER trg_novo_usuario
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.lidar_novo_usuario();
        RAISE NOTICE 'Migração: trigger trg_novo_usuario recriado com a função endurecida.';
    END IF;
END;
$do$;

-- =====================================================================
-- 3. FOTO_PATH: COLUNA + BACKFILL A PARTIR DE FOTO_URL
-- =====================================================================
DO $do$
DECLARE
    v_afetadas INT;
BEGIN
    IF to_regclass('public.alunos') IS NULL THEN
        RAISE NOTICE 'Migração: public.alunos ausente; etapa de foto_path ignorada.';
    ELSE
        -- Coluna nova (idempotente).
        ALTER TABLE public.alunos ADD COLUMN IF NOT EXISTS foto_path TEXT;

        -- Backfill a partir de URLs do bucket "fotos-alunos":
        -- extrai o caminho após '/fotos-alunos/' e descarta a querystring.
        -- Não sobrescreve foto_path já preenchido manualmente.
        UPDATE public.alunos
        SET foto_path = split_part(split_part(foto_url, '/fotos-alunos/', 2), '?', 1)
        WHERE foto_path IS NULL
          AND foto_url LIKE '%/fotos-alunos/%'
          AND split_part(split_part(foto_url, '/fotos-alunos/', 2), '?', 1) <> '';

        GET DIAGNOSTICS v_afetadas = ROW_COUNT;
        RAISE NOTICE 'Migração: backfill de foto_path: % registro(s) atualizado(s).', v_afetadas;

        -- Remove avatares SVG gravados indevidamente em foto_url como data:.
        UPDATE public.alunos
        SET foto_url = NULL
        WHERE foto_url ILIKE 'data:%';

        GET DIAGNOSTICS v_afetadas = ROW_COUNT;
        RAISE NOTICE 'Migração: limpeza de foto_url "data:": % registro(s) atualizado(s).', v_afetadas;
    END IF;
END;
$do$;

-- =====================================================================
-- 4. NORMALIZAÇÃO DE UID_NFC (COM VALIDAÇÃO PRÉVIA DE DUPLICADOS)
-- =====================================================================
DO $do$
DECLARE
    v_duplicados TEXT;
    v_afetadas INT;
BEGIN
    IF to_regclass('public.alunos') IS NULL THEN
        RAISE NOTICE 'Migração: public.alunos ausente; normalização de uid_nfc ignorada.';
    ELSE
        -- 4.1 Validação ANTES de alterar qualquer dado: se upper/trim gerar
        -- duplicidade, aborta a migração inteira listando os UIDs.
        SELECT string_agg(format('%s (%s ocorrência(s))', uid_norm, qtd), ', ' ORDER BY uid_norm)
        INTO v_duplicados
        FROM (
            SELECT upper(btrim(uid_nfc)) AS uid_norm, COUNT(*) AS qtd
            FROM public.alunos
            GROUP BY upper(btrim(uid_nfc))
            HAVING COUNT(*) > 1
        ) AS d;

        IF v_duplicados IS NOT NULL THEN
            RAISE EXCEPTION 'Migração abortada: UIDs NFC duplicados após normalização (upper/trim): %. Resolva/una esses registros manualmente e execute novamente. Nenhum dado foi alterado.', v_duplicados;
        END IF;

        -- 4.2 Aplicação da normalização nos registros existentes.
        UPDATE public.alunos
        SET uid_nfc = upper(btrim(uid_nfc))
        WHERE uid_nfc <> upper(btrim(uid_nfc));

        GET DIAGNOSTICS v_afetadas = ROW_COUNT;
        RAISE NOTICE 'Migração: uid_nfc normalizado em % registro(s).', v_afetadas;
    END IF;
END;
$do$;

-- 4.3 Trigger que aplica upper/trim em todo INSERT/UPDATE futuro.
DO $do$
BEGIN
    IF to_regclass('public.alunos') IS NULL THEN
        RAISE NOTICE 'Migração: public.alunos ausente; trigger de normalização não criado.';
    ELSE
        DROP TRIGGER IF EXISTS trg_alunos_normalizar_uid ON public.alunos;
        CREATE TRIGGER trg_alunos_normalizar_uid
        BEFORE INSERT OR UPDATE ON public.alunos
        FOR EACH ROW EXECUTE FUNCTION public.normalizar_uid_nfc_aluno();
        RAISE NOTICE 'Migração: trigger trg_alunos_normalizar_uid garantido.';
    END IF;
END;
$do$;

-- =====================================================================
-- 5. TRIGGERS DE UPDATED_AT (ALUNOS E PERFIS)
-- =====================================================================
DO $do$
BEGIN
    IF to_regclass('public.perfis_usuarios') IS NULL THEN
        RAISE NOTICE 'Migração: public.perfis_usuarios ausente; trigger de updated_at não criado.';
    ELSE
        DROP TRIGGER IF EXISTS trg_perfis_updated_at ON public.perfis_usuarios;
        CREATE TRIGGER trg_perfis_updated_at
        BEFORE UPDATE ON public.perfis_usuarios
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
        RAISE NOTICE 'Migração: trigger trg_perfis_updated_at garantido.';
    END IF;

    IF to_regclass('public.alunos') IS NULL THEN
        RAISE NOTICE 'Migração: public.alunos ausente; trigger de updated_at não criado.';
    ELSE
        DROP TRIGGER IF EXISTS trg_alunos_updated_at ON public.alunos;
        CREATE TRIGGER trg_alunos_updated_at
        BEFORE UPDATE ON public.alunos
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
        RAISE NOTICE 'Migração: trigger trg_alunos_updated_at garantido.';
    END IF;
END;
$do$;

-- =====================================================================
-- 6. ÍNDICES DO HISTÓRICO DE ACESSOS
-- =====================================================================
DO $do$
BEGIN
    IF to_regclass('public.historico_acessos') IS NULL THEN
        RAISE NOTICE 'Migração: public.historico_acessos ausente; índices não criados.';
    ELSE
        CREATE INDEX IF NOT EXISTS idx_historico_data
            ON public.historico_acessos(data_hora DESC);
        CREATE INDEX IF NOT EXISTS idx_historico_aluno_data
            ON public.historico_acessos(aluno_id, data_hora DESC);
        CREATE INDEX IF NOT EXISTS idx_historico_status
            ON public.historico_acessos(status);
        RAISE NOTICE 'Migração: índices do histórico garantidos (data_hora DESC, aluno_id+data_hora DESC, status).';
    END IF;
END;
$do$;

-- =====================================================================
-- 7. REALTIME (publicação supabase_realtime) - idempotente e tolerante
-- =====================================================================
DO $do$
BEGIN
    IF to_regclass('public.historico_acessos') IS NULL THEN
        RAISE NOTICE 'Migração/Realtime: public.historico_acessos não existe; nada a publicar.';
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        RAISE NOTICE 'Migração/Realtime: publicação supabase_realtime inexistente; nada a fazer (o Supabase a cria por padrão).';
    ELSIF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'historico_acessos'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.historico_acessos';
        RAISE NOTICE 'Migração/Realtime: public.historico_acessos adicionada à publicação supabase_realtime.';
    ELSE
        RAISE NOTICE 'Migração/Realtime: public.historico_acessos já estava publicada.';
    END IF;
END;
$do$;

-- =====================================================================
-- 8. RLS: RESTRINGE A LEITURA DE PERFIS E REMOVE ESCRITA DIRETA
-- =====================================================================
-- As mutações de perfis devem passar pelas RPCs admin_* (SECURITY DEFINER),
-- que validam cargo e o último administrador ativo. A política antiga
-- "Admin gerencia perfis" era FOR ALL e permitia escrita direta via API,
-- contornando essas validações; ela é removida.
DO $do$
DECLARE
    r RECORD;
    v_lista TEXT;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('perfis_usuarios'),
            ('alunos'),
            ('historico_acessos')
        ) AS t(nome)
    LOOP
        IF to_regclass('public.' || r.nome) IS NULL THEN
            RAISE NOTICE 'Migração/RLS: tabela public.% ausente; RLS não habilitado.', r.nome;
        ELSE
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.nome);

            SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_lista
            FROM pg_catalog.pg_policies
            WHERE schemaname = 'public' AND tablename = r.nome;

            RAISE NOTICE 'Migração/RLS: RLS habilitado em public.%. Políticas atuais: %',
                r.nome, COALESCE(v_lista, '(nenhuma)');
        END IF;
    END LOOP;

    IF to_regclass('public.perfis_usuarios') IS NULL THEN
        RAISE NOTICE 'Migração/RLS: public.perfis_usuarios ausente; leitura de perfis não ajustada.';
    ELSIF to_regprocedure('public.tem_permissao(text[])') IS NULL THEN
        RAISE NOTICE 'Migração/RLS: public.tem_permissao(text[]) ausente; leitura de perfis não ajustada. Rode supabase_setup.sql.';
    ELSE
        EXECUTE 'DROP POLICY IF EXISTS "Admin gerencia perfis" ON public.perfis_usuarios';
        EXECUTE 'DROP POLICY IF EXISTS "Leitura de perfis" ON public.perfis_usuarios';
        EXECUTE $sql$
            CREATE POLICY "Leitura de perfis"
            ON public.perfis_usuarios FOR SELECT
            TO authenticated
            USING (id = auth.uid() OR public.tem_permissao('admin'))
        $sql$;
        RAISE NOTICE 'Migração/RLS: leitura de perfis restrita ao próprio usuário/admin; escrita direta removida.';
    END IF;

    -- Auditoria das políticas esperadas (somente leitura).
    FOR r IN
        SELECT * FROM (VALUES
            ('public', 'perfis_usuarios', 'Leitura de perfis'),
            ('public', 'alunos', 'Alunos leitura autorizada'),
            ('public', 'alunos', 'Alunos escrita secretaria e admin'),
            ('public', 'alunos', 'Alunos update secretaria e admin'),
            ('public', 'alunos', 'Alunos exclusao'),
            ('public', 'historico_acessos', 'Historico leitura'),
            ('public', 'historico_acessos', 'Historico insercao'),
            ('public', 'historico_acessos', 'Historico exclusao'),
            ('storage', 'objects', 'Fotos públicas para leitura'),
            ('storage', 'objects', 'Upload permitido no fotos-alunos'),
            ('storage', 'objects', 'Atualizacao permitida no fotos-alunos'),
            ('storage', 'objects', 'Delecao permitida no fotos-alunos')
        ) AS e(esq, tab, pol)
    LOOP
        IF to_regclass(format('%I.%I', r.esq, r.tab)) IS NULL THEN
            RAISE NOTICE 'Migração/RLS: %.% ausente; política "%" não verificada.', r.esq, r.tab, r.pol;
        ELSIF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_policies
            WHERE schemaname = r.esq AND tablename = r.tab AND policyname = r.pol
        ) THEN
            RAISE NOTICE 'Migração/RLS: ATENÇÃO - política esperada "%" ausente em %.%. Rode a seção 10 de supabase_setup.sql se o app depende dela.', r.pol, r.esq, r.tab;
        END IF;
    END LOOP;
END;
$do$;

-- =====================================================================
-- 9. PERMISSÕES DE EXECUÇÃO (GRANT/REVOKE)
-- =====================================================================
-- 9.1 Funções recriadas nesta migração: revoga execução pública e das
-- funções de trigger (não precisam de EXECUTE em tempo de execução).
REVOKE ALL ON FUNCTION public.lidar_novo_usuario() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalizar_uid_nfc_aluno() FROM PUBLIC, anon, authenticated;

-- 9.2 RPCs administrativas recriadas: somente autenticados.
REVOKE ALL ON FUNCTION public.admin_alterar_usuario(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_excluir_usuario(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_alterar_usuario(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_excluir_usuario(UUID) TO authenticated;

-- 9.3 Objetos que já existem no banco (criados pelo setup): ajustes
-- condicionais para manter o menor privilégio sem quebrar o app.
DO $do$
BEGIN
    IF to_regprocedure('public.auto_confirmar_usuario()') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.auto_confirmar_usuario() FROM PUBLIC, anon, authenticated';
    ELSE
        RAISE NOTICE 'Migração/Permissões: public.auto_confirmar_usuario() ausente; rode supabase_setup.sql.';
    END IF;

    -- Requisito: o RPC de primeiro acesso continua disponível para anon.
    IF to_regprocedure('public.sistema_precisa_setup()') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.sistema_precisa_setup() FROM PUBLIC';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.sistema_precisa_setup() TO anon, authenticated';
    ELSE
        RAISE NOTICE 'Migração/Permissões: public.sistema_precisa_setup() ausente; rode supabase_setup.sql.';
    END IF;

    IF to_regprocedure('public.obter_meu_perfil()') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.obter_meu_perfil() FROM PUBLIC, anon';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.obter_meu_perfil() TO authenticated';
    ELSE
        RAISE NOTICE 'Migração/Permissões: public.obter_meu_perfil() ausente; rode supabase_setup.sql.';
    END IF;

    IF to_regprocedure('public.obter_cargo_usuario(uuid)') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.obter_cargo_usuario(uuid) FROM PUBLIC, anon';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.obter_cargo_usuario(uuid) TO authenticated';
    ELSE
        RAISE NOTICE 'Migração/Permissões: public.obter_cargo_usuario(uuid) ausente; rode supabase_setup.sql.';
    END IF;

    -- Usada pelas políticas RLS: obrigatório manter para authenticated.
    IF to_regprocedure('public.tem_permissao(text[])') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.tem_permissao(text[]) FROM PUBLIC, anon';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.tem_permissao(text[]) TO authenticated';
    ELSE
        RAISE NOTICE 'Migração/Permissões: public.tem_permissao(text[]) ausente; rode supabase_setup.sql.';
    END IF;

    IF to_regprocedure('public.admin_redefinir_senha(uuid, text)') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.admin_redefinir_senha(uuid, text) FROM PUBLIC, anon';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_redefinir_senha(uuid, text) TO authenticated';
    ELSE
        RAISE NOTICE 'Migração/Permissões: public.admin_redefinir_senha(uuid, text) ausente; rode supabase_setup.sql.';
    END IF;
END;
$do$;

-- =====================================================================
-- 10. RESUMO / VERIFICAÇÃO FINAL (somente leitura)
-- =====================================================================
DO $do$
DECLARE
    v_ok TEXT := '';
    v_admins INT;
BEGIN
    SELECT string_agg(nome, ', ') INTO v_ok
    FROM (
        SELECT 'trigger lidar_novo_usuario' AS nome
        WHERE EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_novo_usuario')
        UNION ALL
        SELECT 'trigger uid_nfc'
        WHERE EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_alunos_normalizar_uid')
        UNION ALL
        SELECT 'trigger updated_at (alunos)'
        WHERE EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_alunos_updated_at')
        UNION ALL
        SELECT 'trigger updated_at (perfis)'
        WHERE EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_perfis_updated_at')
        UNION ALL
        SELECT 'coluna alunos.foto_path'
        WHERE EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'alunos' AND column_name = 'foto_path'
        )
    ) AS t;

    RAISE NOTICE 'Migração concluída. Itens confirmados: %.', COALESCE(NULLIF(v_ok, ''), '(nenhum - verifique se o esquema base existe)');
    RAISE NOTICE 'Revisão sugerida: SELECT id, email, cargo, ativo FROM public.perfis_usuarios ORDER BY created_at;';

    -- Alerta operacional: sem administrador ativo, novos cadastros entram
    -- inativos e ninguém conseguirá ativá-los pela interface.
    IF to_regclass('public.perfis_usuarios') IS NOT NULL THEN
        SELECT COUNT(*) INTO v_admins
        FROM public.perfis_usuarios
        WHERE cargo = 'admin' AND ativo = true;

        IF v_admins = 0 THEN
            RAISE WARNING 'Migração: NÃO existe administrador ativo. Novos cadastros entrarão inativos e não poderão ser aprovados pela interface; regularize via SQL/service_role.';
        ELSE
            RAISE NOTICE 'Migração: % administrador(es) ativo(s) no sistema.', v_admins;
        END IF;
    END IF;
END;
$do$;
