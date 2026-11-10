import json,re,sys
raw=json.load(open('/home/claude/dl/items_raw.json'))['items']
db=json.load(open('db.json',encoding='utf-8'))
by={}
for k in ('weapon','equipmentitem','transformationweapon'):
    for x in raw.get(k,[]): by[x['@uniquename']]=x
MATS={'METALBAR','LEATHER','CLOTH','PLANKS','STONEBLOCK'}
def parse(t,suf):
    x=by.get(f'T{t}_{suf}')
    if not x: return None
    cr=x.get('craftingrequirements')
    if isinstance(cr,list): cr=cr[0]
    if not cr: return None
    rs=cr.get('craftresource')
    if isinstance(rs,dict): rs=[rs]
    out=[]
    for r in rs or []:
        u=r['@uniquename']; n=int(r['@count']); ret=r.get('@maxreturnamount')!='0'
        if '_BP' in u or 'TOKEN' in u or r.get('@preservequality'): return None
        m=re.match(rf'^T{t}_(.+)$',u)
        if not m: return None
        s=m.group(1)
        if s in MATS: out.append([s,n,1 if ret else 0])
        elif s.startswith('ARTEFACT_') or s.startswith('ALCHEMY') or s.startswith('RUNE') or s.startswith('SOUL') or s.startswith('RELIC') or s.startswith('SHARD'):
            out.append(['A:'+s,n,0])
        else: return None
    return out
rec={}; bad=[]
for g in db['gear']:
    suf=g[0]; rs=[parse(t,suf) for t in range(4,9)]
    if any(r is None for r in rs): bad.append(suf); continue
    if any(r!=rs[2] for r in rs):
        # counts must match across tiers
        if any([a[0] for a in r]!=[a[0] for a in rs[2]] for r in rs): bad.append(suf+'*'); continue
    rec[suf]=rs[2]
db['rec']=rec
json.dump(db,open('db.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('recipes',len(rec),'skipped',len(bad),bad[:40],file=sys.stderr)
print({k:rec[k] for k in ['MAIN_SWORD','2H_CLAYMORE_AVALON','BAG','ARMOR_PLATE_SET1','OFF_SHIELD','CAPE'] if k in rec},file=sys.stderr)
