import json
db=open('db.json',encoding='utf-8').read()
core=open('core.js',encoding='utf-8').read().replace('/*__DB__*/null',db)
ui=open('ui.js',encoding='utf-8').read()
rec=open('craft.js',encoding='utf-8').read()
assert '</script>' not in rec
html=open('app.src.html',encoding='utf-8').read().replace('/*__CORE__*/',core).replace('/*__UI__*/',ui).replace('/*__CRAFT__*/',rec)
assert '</script>' not in core and '</script>' not in ui
open('karavan-albion.html','w',encoding='utf-8').write(html)
open('core.built.js','w',encoding='utf-8').write(core)
print(len(html))
