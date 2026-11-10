import json,re,collections,sys
D='/home/claude/dl/'
raw=json.load(open(D+'items_raw.json'))['items']
fm=json.load(open(D+'items_formatted.json'))
names={}; exists=set()
for x in fm:
    u=x['UniqueName']; exists.add(u)
    ln=x.get('LocalizedNames') or {}
    names[u]=(ln.get('RU-RU') or ln.get('EN-US') or u)
MELEE={'sword','axe','mace','hammer','spear','dagger','quarterstaff','knuckles'}
RANGED={'bow','crossbow'}
def cat_weapon(x):
    s=x.get('@shopsubcategory1')
    if x.get('@shopcategory')!='weapons': return None
    if s in MELEE: return 'melee'
    if s in RANGED: return 'ranged'
    return 'magic'
def cat_equip(x):
    c=x.get('@shopcategory'); s=x.get('@shopsubcategory1') or ''; u=x['@uniquename']
    if c in('head','armors','shoes'):
        if '_CLOTH_' in u: return 'cloth'
        if '_LEATHER_' in u: return 'leather'
        if '_PLATE_' in u: return 'plate'
        return None
    if c=='offhands': return 'offhand'
    if c=='capes': return 'cape'
    if c=='bags': return 'bag'
    return None
bases=collections.OrderedDict()
def add(x,cat):
    u=x['@uniquename']; m=re.match(r'^T([4-8])_(.+)$',u)
    if not m or cat is None: return
    if x.get('@maxqualitylevel','1')!='5': return
    t=int(m.group(1)); suf=m.group(2)
    b=bases.setdefault(suf,{'cat':cat,'w':{}, 'name':None,'ench':{}})
    b['w'][t]=float(x['@weight'])
    nm=names.get(u,u); nm=re.sub(r'\s*\([^)]*\)\s*$','',nm).strip()
    if b['name'] is None: b['name']=nm
    e=max([n for n in range(0,5) if n==0 or (u+'@%d'%n) in exists])
    b['ench'][t]=e
for x in raw['weapon']: add(x,cat_weapon(x))
for x in raw.get('transformationweapon',[]):
    x=dict(x); add(x,'magic' if x.get('@shopcategory')=='weapons' else None)
for x in raw['equipmentitem']: add(x,cat_equip(x))
gear=[]
skipped=[]
for suf,b in bases.items():
    ts=sorted(b['w'])
    if 'VANITY' in suf or 'ARENA' in suf or 'DEBUG' in suf or len(ts)<5: skipped.append(suf); continue
    row=[suf,b['name'],b['cat'],[b['w'].get(t,0) for t in range(4,9)]]
    me=min(b['ench'].values())
    if me!=4: row.append(me)
    gear.append(row)
# resources
res=[]
R={}
for x in raw['simpleitem']:
    if x.get('@shopcategory')!='crafting' or x.get('@shopsubcategory1') not in('resources','refinedresources'): continue
    u=x['@uniquename']; m=re.match(r'^T([2-8])_([A-Z]+?)(?:_LEVEL(\d))?$',u)
    if not m: skipped.append(u); continue
    t=int(m.group(1)); kind=m.group(2); lv=int(m.group(3) or 0)
    r=R.setdefault(kind,{'cat':'raw' if x['@shopsubcategory1']=='resources' else 'refined','t':{}})
    d=r['t'].setdefault(t,{'w':float(x['@weight']),'e':0,'name':None})
    d['e']=max(d['e'],lv)
    if lv==0: d['name']=names.get(u,u)
for kind,r in R.items():
    res.append([kind,r['cat'],[[d['name'],d['w'],d['e']] for t,d in sorted(r['t'].items()) if t>=4]])
print('gear bases',len(gear),'res kinds',len(res),'skipped',skipped[:30],file=sys.stderr)
print(collections.Counter(g[2] for g in gear),file=sys.stderr)
for g in gear[:8]+gear[-8:]: print(g,file=sys.stderr)
for r in res: print(r,file=sys.stderr)
# sanity: check enchant id existence & names for a few
bad=[g for g in gear if 0 in g[3]]
print('partial tiers',[(g[0],g[3]) for g in bad],file=sys.stderr)
json.dump({'gear':gear,'res':res},open('db.json','w'),ensure_ascii=False,separators=(',',':'))
