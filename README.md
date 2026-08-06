# FOCUS — Organizador pessoal local-first

O FOCUS é uma aplicação web responsiva para organizar agenda, tarefas, eventos recorrentes, hábitos, metas e sessões de foco. A aplicação funciona primeiro no dispositivo com IndexedDB. Login e sincronização com Firebase são opcionais.

## Arquitetura

- **Interface:** HTML5, CSS3 e JavaScript ES Modules.
- **Dados principais:** IndexedDB, com stores independentes para atividades, hábitos, metas, sessões, configurações, notas, lixeira e fila de sincronização.
- **Offline:** Service Worker com cache do shell da aplicação.
- **PWA:** `manifest.json`, ícones 192/512, atalhos e fluxo de instalação.
- **Sincronização:** Firebase Authentication e Firestore opcionais. Sem configuração do Firebase, o aplicativo permanece funcional como visitante.
- **Android:** configuração do Capacitor e plugin de notificações locais.
- **Segurança:** regras do Firestore e Storage separadas por UID, validação de formulário, limite de anexos, CSP no Netlify e nenhuma credencial incluída.

## Funcionalidades implementadas

### Rotina e agenda

- Resumo inteligente do dia, atividade atual e próxima atividade.
- Atividades com data, horário, duração, categoria, prioridade, descrição, local, responsável, cor, subtarefas e anexo local.
- Compromissos, tarefas, eventos e blocos de estudo.
- Recorrência diária, dias úteis, semanal, mensal, anual e dias personalizados.
- Edição ou exclusão de uma ocorrência isolada ou de toda a série.
- Detecção de conflito sem bloquear o cadastro.
- Agenda diária, semanal, mensal e cronológica.
- Filtros por categoria, prioridade, status e busca.
- Horários livres e indicador de ocupação.
- Arrastar eventos entre datas na visualização mensal em computadores.
- Planejamento semanal com sugestões confirmadas individualmente.
- Conclusão, adiamento, duplicação, favoritos, compartilhamento e checklist de subtarefas.
- Lixeira, restauração e exclusão permanente.

### Produtividade

- Temporizador de foco com 25, 45, 50, 60 minutos ou duração personalizada.
- Seleção da atividade atual, pausar, concluir e abandonar sessão.
- Histórico de sessões e tempo focado.
- Hábitos com meta semanal, calendário de marcações, consistência e sequência.
- Metas com prazo, progresso e etapas.
- Assistente local baseado em regras, sem API paga.
- Relatórios de conclusão, atraso, foco, hábitos, melhores dias e categorias.
- Notas rápidas.
- Exportação JSON, importação de backup e exportação ICS.
- Dados de demonstração removíveis.

### Conta, PWA e Android

- Uso completo como visitante.
- E-mail/senha, Google e recuperação de senha quando o Firebase estiver configurado.
- Conversão dos dados locais por sincronização após o login.
- Tema claro/escuro, configurações de horário, sons, vibração e limite diário.
- PWA instalável.
- Notificações no navegador enquanto o ambiente permitir.
- Base para notificações locais confiáveis no APK por Capacitor.

## Limites técnicos da versão 1.0

1. **O navegador não garante alarmes quando está fechado.** Para lembretes confiáveis com o aplicativo fechado, gere o APK e use o plugin Local Notifications do Capacitor.
2. **Anexos são armazenados localmente no IndexedDB, com limite de 2 MB.** O envio dos binários ao Firebase Storage não está ativado por padrão; implemente o upload antes de depender da sincronização de anexos entre aparelhos.
3. A sincronização incluída é manual e do tipo “enviar e buscar”. Para uso multi-dispositivo intensivo, acrescente resolução de conflitos por versão e listeners em tempo real.
4. O modo foco registra sessões, mas não bloqueia outros aplicativos do Android. Um bloqueio real de aplicativos exigiria permissões e APIs nativas adicionais, com implicações de privacidade.
5. O projeto contém código e configuração Android, mas **não inclui um APK assinado**, porque a assinatura precisa ser criada e protegida pelo proprietário do aplicativo.

## Executar localmente

Pré-requisito: Node.js 20 ou superior. O projeto usa módulos JavaScript nativos; não há etapa obrigatória de empacotamento para executar a versão web.

```bash
npm install
npm run dev
```

Abra o endereço exibido no terminal. Não abra o `index.html` diretamente pelo gerenciador de arquivos, pois Service Worker e módulos ES exigem servidor HTTP/HTTPS.

Também é possível usar:

```bash
python -m http.server 8080
```

e abrir `http://localhost:8080`.

## Criar a versão web de publicação

```bash
npm run build:web
```

O conteúdo pronto será copiado para a pasta `www/`.

## Publicar no Netlify

### Pela interface

1. Descompacte o projeto.
2. Envie o projeto para um repositório Git ou use o deploy manual.
3. Para deploy com Git:
   - Build command: `node build.mjs`
   - Publish directory: `www`
4. O arquivo `netlify.toml` já contém essas configurações e cabeçalhos básicos de segurança.

### Pelo Netlify CLI

```bash
npm install
npm run build:web
npx netlify deploy --dir=www
npx netlify deploy --prod --dir=www
```

## Configurar Firebase

1. Crie um projeto no Firebase Console.
2. Adicione um aplicativo Web.
3. Ative:
   - Authentication > E-mail/senha;
   - Authentication > Google;
   - Firestore Database;
   - Storage, somente quando implementar sincronização de anexos.
4. Copie:

```bash
cp js/firebase-config.example.js js/firebase-config.js
```

No Windows PowerShell:

```powershell
Copy-Item js/firebase-config.example.js js/firebase-config.js
```

5. Preencha `js/firebase-config.js` com a configuração pública do aplicativo Web.
6. No Authentication, adicione o domínio do Netlify em **Authorized domains**.
7. Publique as regras:

```bash
npm install -g firebase-tools
firebase login
firebase init
firebase deploy --only firestore:rules,storage
```

A configuração pública do Firebase Web não é uma chave privada. A proteção real depende de Authentication, Security Rules e restrição de acesso. Nunca coloque credenciais de conta de serviço no navegador.

## Estrutura de dados no Firestore

Cada usuário possui subcoleções próprias:

```text
users/{uid}/activities/{activityId}
users/{uid}/habits/{habitId}
users/{uid}/goals/{goalId}
users/{uid}/focusSessions/{sessionId}
users/{uid}/notes/{noteId}
users/{uid}/settings/{settingId}
```

As regras incluídas exigem que `request.auth.uid` seja igual ao `{uid}` do caminho.

## Gerar Android com Capacitor

Pré-requisitos:

- Node.js 20+;
- Android Studio atualizado;
- JDK compatível com a versão atual do Android Gradle Plugin;
- Android SDK instalado.

Comandos:

```bash
npm install
npm run build:web
npx cap add android
npx cap sync android
npx cap open android
```

Depois:

1. No Android Studio, aguarde a sincronização do Gradle.
2. Teste em um aparelho físico.
3. Abra `android-manifest-snippet.xml` e adicione as permissões necessárias ao `AndroidManifest.xml`. O Android 12+ pode exigir configuração de alarmes exatos; o usuário ainda pode desativá-los nas configurações do sistema.
4. Copie `assets/sounds/focus_reminder.wav` para:

```text
android/app/src/main/res/raw/focus_reminder.wav
```

Crie a pasta `raw` se necessário.

5. Confirme as permissões de notificação e, quando aplicável, de alarmes exatos no Android.
6. Gere um APK de teste em **Build > Build App Bundles or APKs > Build APKs**.
7. Para publicação, crie e proteja uma keystore e gere um Android App Bundle assinado.

Sempre execute `npm run build:web` e `npx cap sync android` depois de alterar os arquivos web.

## Notificações

- No navegador, o FOCUS usa a Notifications API e temporizadores enquanto a página está disponível. O sistema operacional ou navegador pode suspender a execução.
- No Android via Capacitor, o arquivo `js/notifications.js` acessa o plugin `LocalNotifications` pela ponte injetada no WebView, agenda notificações com `allowWhileIdle` e registra ações de concluir, adiar e abrir.
- Teste em versões recentes do Android, incluindo permissão de notificações e restrições de bateria do fabricante.

## Testes

Execute:

```bash
npm test
```

O smoke test valida arquivos obrigatórios, JSON, regras básicas de recorrência, conflito e cálculo de horários livres.

Testes manuais recomendados estão em `TESTING.md`.

## Atalhos

- `Ctrl/Cmd + K`: pesquisa global.
- `N`: nova atividade, quando nenhum campo estiver em edição.
- `Esc`: fecha a janela aberta.

## Dados de demonstração

O botão “Explorar com dados de demonstração” cria:

- trabalho, 7h–13h30;
- academia, 15h–16h20;
- faculdade, 19h–22h10;
- estudo de 45 minutos;
- pagamento de conta;
- consulta médica;
- revisão semanal;
- hábitos de leitura e água;
- uma meta de curso.

Remova esses registros em Perfil > Configurações > Remover demonstração.

## Build automático do APK no GitHub

O projeto inclui `.github/workflows/build-android-apk.yml`. O workflow instala as dependências, executa os smoke tests, gera o projeto Android com Capacitor, aplica recursos nativos e compila um APK debug instalável.

Consulte `GITHUB-APK.md` para o procedimento de execução e download do artefato.
