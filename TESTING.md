# Checklist de testes — FOCUS 1.0

## Inicialização

- [ ] Abrir pela primeira vez e concluir onboarding.
- [ ] Abrir com dados de demonstração.
- [ ] Recarregar e confirmar persistência no IndexedDB.
- [ ] Ativar modo offline no DevTools e reabrir páginas já carregadas.
- [ ] Instalar como PWA em navegador compatível.

## Atividades

- [ ] Criar tarefa sem horário.
- [ ] Criar compromisso com início e fim.
- [ ] Criar atividade com anexo menor que 2 MB.
- [ ] Bloquear anexo maior que 2 MB.
- [ ] Detectar conflito e permitir salvar após o aviso.
- [ ] Criar recorrência diária, semanal, mensal e personalizada.
- [ ] Editar uma ocorrência isolada.
- [ ] Editar toda a série.
- [ ] Excluir uma ocorrência isolada.
- [ ] Excluir toda a série.
- [ ] Concluir e reabrir atividade.
- [ ] Adiar atividade.
- [ ] Duplicar, favoritar e compartilhar.
- [ ] Marcar subtarefas.
- [ ] Arrastar atividade no calendário mensal em desktop.

## Agenda e planejamento

- [ ] Alternar dia, semana, mês e lista.
- [ ] Filtrar categoria, prioridade e status.
- [ ] Pesquisar por título.
- [ ] Abrir um dia pelo calendário.
- [ ] Conferir horários livres.
- [ ] Executar “Organizar minha semana” e rejeitar/aceitar sugestões.

## Foco, hábitos e metas

- [ ] Iniciar, pausar, concluir e abandonar uma sessão.
- [ ] Usar duração personalizada.
- [ ] Confirmar registro no histórico.
- [ ] Criar hábito e marcar dias.
- [ ] Conferir consistência e sequência.
- [ ] Criar meta e marcar etapas.
- [ ] Reorganizar etapas sugeridas.

## Dados e segurança

- [ ] Exportar JSON.
- [ ] Importar mesclando.
- [ ] Importar substituindo.
- [ ] Exportar ICS e abrir em calendário externo.
- [ ] Excluir item, restaurar da lixeira e excluir permanentemente.
- [ ] Apagar todos os dados exigindo a palavra APAGAR.
- [ ] Confirmar que um usuário autenticado não acessa o caminho Firestore de outro UID.
- [ ] Confirmar que `js/firebase-config.js` não contém credenciais privadas.

## Firebase

- [ ] Criar conta com e-mail e senha.
- [ ] Entrar com Google.
- [ ] Recuperar senha.
- [ ] Sincronizar dados locais.
- [ ] Abrir em outro navegador, entrar e buscar dados.
- [ ] Testar falha offline e nova sincronização.

## Android

- [ ] `npm run build:web`.
- [ ] `npx cap sync android`.
- [ ] Abrir no Android Studio.
- [ ] Conceder permissão de notificação.
- [ ] Agendar lembrete e fechar o aplicativo.
- [ ] Testar concluir, adiar e abrir pela notificação.
- [ ] Testar modo escuro, rotação bloqueada e botão voltar.
- [ ] Gerar APK debug e instalar em aparelho físico.
