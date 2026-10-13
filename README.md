# Acesso Escolar NFC 🎓🏷️

Sistema moderno e completo de controle de acesso escolar e empresarial integrado via hardware **ESP32-S3 + PN532 NFC** e banco de dados **Supabase**.

## 🚀 Principais Recursos
* **Controle de Acesso Baseado em Cargos (RBAC):** 5 perfis de acesso institucionais (`admin`, `direcao`, `coordenacao`, `secretaria` e `portaria`).
* **Operação Híbrida (Nuvem + 100% Offline):** O microcontrolador ESP32-S3 armazena localmente a base de cartões na memória Flash (`cartoes.json`). Se a internet cair, a catraca/porta continua funcionando normalmente com liberação e bloqueio precisos.
* **Totem de Portaria em Tempo Real:** Exibe instantaneamente a foto do aluno, nome, turma, status de acesso (Liberado / Bloqueado) e link direto para notificar o responsável via WhatsApp.
* **Secretaria Digital:** Cadastro de novos alunos com foto compactada via webcam ou upload de arquivo, matrícula, telefone do responsável e atribuição de tag NFC.
* **Ferramentas Web Sem Cabos:** Console Serial remoto via Wi-Fi (`/console`) e atualização de firmware OTA sem fio (`/ota`).

## 📖 Documentação Completa
Consulte o [Manual de Configuração e Publicação](COMO_CONFIGURAR_E_PUBLICAR.md) para o passo a passo detalhado de implantação no Supabase e na Vercel.
