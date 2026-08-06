# Relatório de preparação do APK

## Estado

- Projeto web/PWA: validado por smoke tests.
- Configuração Capacitor: preparada para Android.
- Dependências fixadas: Capacitor Core/Android/CLI 8.4.2 e Local Notifications 8.2.1.
- Bundle JavaScript: preparado com esbuild, incluindo Lucide e APIs nativas.
- Workflow GitHub Actions: criado para gerar APK debug instalável.
- Ícone Android e splash: gerados no workflow por `@capacitor/assets`.
- Notificações: permissão Android 13+, alarme exato, ação de concluir/adiar e som local preparados.
- Privacidade: tráfego HTTP desativado e backup automático do Android desativado.

## Validações executadas neste ambiente

- Sintaxe dos módulos JavaScript.
- Smoke tests de recorrência, conflitos e horários livres.
- Sintaxe do script Python que prepara o AndroidManifest e recursos.
- Estrutura e leitura do workflow YAML.
- Existência dos arquivos obrigatórios do projeto.

## Limitação objetiva

O APK binário não foi compilado neste ambiente porque ele não possui Android SDK/Gradle utilizável e a conta GitHub conectada não disponibilizou nenhum repositório para executar o workflow. O ZIP entregue contém tudo que o GitHub Actions precisa para realizar a compilação assim que for colocado em um repositório autorizado.
