-- =====================================================================
-- MIGRAÇÃO: BIOMETRIA ÓPTICA OPCIONAL (AS608 / FPM10A)
-- Data: 2026-11-10
-- =====================================================================
-- Adiciona suporte opcional ao identificador de biometria (posições 1 a 300)
-- na tabela public.alunos sem alterar a obrigatoriedade ou funcionamento do
-- cartão NFC (uid_nfc). Quando um aluno utiliza apenas biometria, o painel
-- gera automaticamente o identificador virtual canônico FB:10:XX:YY em uid_nfc.
-- =====================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'alunos'
    ) THEN
        ALTER TABLE public.alunos
          ADD COLUMN IF NOT EXISTS biometria_id INTEGER;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'alunos_biometria_id_faixa'
        ) THEN
            ALTER TABLE public.alunos
              ADD CONSTRAINT alunos_biometria_id_faixa
              CHECK (biometria_id IS NULL OR (biometria_id >= 1 AND biometria_id <= 300));
        END IF;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_alunos_biometria_id
          ON public.alunos(biometria_id)
          WHERE biometria_id IS NOT NULL;

        RAISE NOTICE 'Migração de biometria opcional aplicada com sucesso em public.alunos.';
    ELSE
        RAISE NOTICE 'Tabela public.alunos não encontrada; execute supabase_setup.sql primeiro.';
    END IF;
END;
$$;
