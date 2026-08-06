# Gerar o APK pelo GitHub

O repositório contém o workflow `.github/workflows/build-android-apk.yml`.

## Resultado

O GitHub Actions gera um APK debug assinado automaticamente com o nome:

`FOCUS-Poco-F5-Pro-v1.0.0.apk`

Esse APK pode ser instalado diretamente no Poco F5 Pro. Ele é uma versão de teste instalável, não uma versão assinada para publicação na Play Store.

## Execução automática

O workflow roda quando o projeto é enviado ao branch `main` ou `master`.

## Execução manual

1. Abra a aba **Actions** do repositório.
2. Selecione **Gerar APK Android**.
3. Clique em **Run workflow**.
4. Depois que o processo terminar, abra a execução.
5. Na seção **Artifacts**, baixe `FOCUS-Poco-F5-Pro-v1.0.0`.
6. Extraia o ZIP do artefato e instale o APK no celular.

## Permissões no Poco F5 Pro

Ao abrir pela primeira vez:

1. Autorize notificações.
2. Para lembretes precisos, abra as configurações do aplicativo e permita alarmes/lembretes exatos quando o Android oferecer essa opção.
3. Caso o HyperOS atrase notificações, defina a bateria do FOCUS como **Sem restrições** e permita inicialização automática.

## Segurança

- Não há chave de assinatura de produção dentro do repositório.
- O APK debug usa a chave temporária gerada pelo ambiente Android.
- Firebase continua opcional.
- Nunca envie arquivo de conta de serviço ou chave privada para o repositório.
