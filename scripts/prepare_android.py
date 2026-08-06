from pathlib import Path
import shutil
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / 'android'
MANIFEST = ANDROID / 'app/src/main/AndroidManifest.xml'
RES = ANDROID / 'app/src/main/res'

if not MANIFEST.exists():
    raise SystemExit('Projeto Android ausente. Execute npx cap add android antes deste script.')

ANDROID_NS = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', ANDROID_NS)
android_attr = lambda name: f'{{{ANDROID_NS}}}{name}'

tree = ET.parse(MANIFEST)
manifest = tree.getroot()

permissions = {
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.SCHEDULE_EXACT_ALARM',
}
existing = {
    node.get(android_attr('name'))
    for node in manifest.findall('uses-permission')
}
for permission in sorted(permissions - existing):
    node = ET.Element('uses-permission')
    node.set(android_attr('name'), permission)
    manifest.insert(0, node)

application = manifest.find('application')
if application is None:
    raise SystemExit('Elemento <application> não encontrado no AndroidManifest.xml.')
application.set(android_attr('usesCleartextTraffic'), 'false')
application.set(android_attr('allowBackup'), 'false')

activity = application.find('activity')
if activity is not None:
    config_changes = activity.get(android_attr('configChanges'), '')
    values = [value for value in config_changes.split('|') if value]
    if 'density' not in values:
        values.append('density')
    activity.set(android_attr('configChanges'), '|'.join(values))
    activity.set(android_attr('screenOrientation'), 'portrait')

tree.write(MANIFEST, encoding='utf-8', xml_declaration=True)

raw = RES / 'raw'
raw.mkdir(parents=True, exist_ok=True)
shutil.copy2(ROOT / 'assets/sounds/focus_reminder.wav', raw / 'focus_reminder.wav')

drawable = RES / 'drawable'
drawable.mkdir(parents=True, exist_ok=True)
(drawable / 'ic_stat_focus.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M5,3 L19,3 L19,7 L10,7 L10,11 L17,11 L17,15 L10,15 L10,21 L5,21 Z" />
</vector>
''', encoding='utf-8')

print('Android preparado: permissões, ícone de notificação, som e configuração de tela aplicados.')
