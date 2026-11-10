import json
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
html=open('app.src.html',encoding='utf-8').read().replace('/*__CORE__*/',core).replace('/*__UI__*/',ui).replace('/*__CRAFT__*/',rec).replace('/*__FARM__*/',farm).replace('/*__I18N__*/',i18n).replace('/*__GROUP__*/',group).replace('/*__MAPS__*/',maps).replace('/*__META__*/',meta)
assert '</script>' not in core and '</script>' not in ui
open('karavan-albion.html','w',encoding='utf-8').write(html)
open('core.built.js','w',encoding='utf-8').write(core)
print(len(html))
