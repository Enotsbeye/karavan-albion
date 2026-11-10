import json,time,os
BUILD=int(os.environ.get('KARAVAN_BUILD') or time.time())
METER=2
db=open('db.json',encoding='utf-8').read()
core=open('core.js',encoding='utf-8').read().replace('/*__DB__*/null',db)
ui=open('ui.js',encoding='utf-8').read()
rec=open('craft.js',encoding='utf-8').read()
assert '</script>' not in rec
farm=open('farm.js',encoding='utf-8').read()
i18n=open('i18n.js',encoding='utf-8').read()
group=open('group.js',encoding='utf-8').read()
maps=open('maps.js',encoding='utf-8').read()
meta=open('meta.js',encoding='utf-8').read()
home=open('home.js',encoding='utf-8').read()
profile=open('profile.js',encoding='utf-8').read()
update=open('update.js',encoding='utf-8').read().replace('/*__BUILD__*/0',str(BUILD))
html=open('app.src.html',encoding='utf-8').read().replace('/*__CORE__*/',core).replace('/*__UI__*/',ui).replace('/*__CRAFT__*/',rec).replace('/*__FARM__*/',farm).replace('/*__I18N__*/',i18n).replace('/*__GROUP__*/',group).replace('/*__MAPS__*/',maps).replace('/*__META__*/',meta).replace('/*__HOME__*/',home).replace('/*__PROFILE__*/',profile).replace('/*__UPDATE__*/',update).replace('/*__BUILDN__*/',str(BUILD))
assert '</script>' not in core and '</script>' not in ui
open('karavan-albion.html','w',encoding='utf-8').write(html)
open('core.built.js','w',encoding='utf-8').write(core)
open('version.json','w').write(json.dumps({'build':BUILD,'meter':METER}))
# Загрузчик для программы: встроенная версия + запуск более новой, скачанной с GitHub
emb=json.dumps(html,ensure_ascii=False).replace('</','<\\/')
loader="""<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Караван</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{background:#0B0C0E;margin:0}</style></head><body><script>
(function(){var v=%d,h=%s;
try{var cv=+localStorage.getItem('karavan.codev')||0,ok=+localStorage.getItem('karavan.okv')||0,tr=+localStorage.getItem('karavan.tryv')||0;
if(cv>v){if(tr===cv&&ok!==cv){localStorage.setItem('karavan.badv',String(cv));localStorage.removeItem('karavan.code');localStorage.removeItem('karavan.codev');}else{var c=localStorage.getItem('karavan.code');if(c){h=c;localStorage.setItem('karavan.tryv',String(cv));}}}}catch(e){}
window.addEventListener('load',function(){document.open();document.write(h);document.close();});})();
</script></body></html>""" % (BUILD, emb)
open('karavan-desktop.html','w',encoding='utf-8').write(loader)
print(len(html), BUILD)
