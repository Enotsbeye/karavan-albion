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
# --- фокус и переработка ---
names={}
for x in json.load(open('/home/claude/dl/items_formatted.json')):
    ln=x.get('LocalizedNames') or {}; names[x['UniqueName']]=ln.get('RU-RU') or ln.get('EN-US') or x['UniqueName']
def focus_of(x,e):
    if e==0: cr=x.get('craftingrequirements')
    else:
        en=x.get('enchantments',{}).get('enchantment',[]); en=en if isinstance(en,list) else [en]
        m=[q for q in en if q.get('@enchantmentlevel')==str(e)]
        if not m: return None
        cr=m[0].get('craftingrequirements')
    if isinstance(cr,list): cr=cr[0]
    return float(cr.get('@craftingfocus',0)) if cr else None
F={}; badf=0
for suf in rec:
    x4=by.get(f'T4_{suf}'); f0=focus_of(x4,0)
    ok=f0 and f0>0
    if ok:
        for t in range(4,9):
            for e in range(0,4):
                x=by.get(f'T{t}_{suf}'); f=focus_of(x,e) if x else None
                if f is None: continue
                if abs(f-f0*1.75**(t-4+e))>max(3,f*0.01): ok=False
    if ok: F[suf]=f0
    else: badf+=1
db['focus']=F
api=lambda u: u+('@'+re.search(r'_LEVEL(\d)$',u).group(1) if re.search(r'_LEVEL(\d)$',u) else '')
si={x['@uniquename']:x for x in raw['simpleitem']}
ref=[]
for kind in ['METALBAR','PLANKS','CLOTH','LEATHER','STONEBLOCK']:
    for t in range(4,9):
        for e in range(0,5):
            u=f'T{t}_{kind}'+(f'_LEVEL{e}' if e else ''); x=si.get(u)
            if not x: continue
            cr=x['craftingrequirements']; cr=cr[0] if isinstance(cr,list) else cr
            rs=cr['craftresource']; rs=rs if isinstance(rs,list) else [rs]
            ref.append([api(u),names.get(u.split('@')[0],u),t,e,float(cr['@craftingfocus']),[[api(r['@uniquename']),int(r['@count'])] for r in rs]])
db['refine']=ref
json.dump(db,open('db.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('focus bases',len(F),'bad',badf,'refine',len(ref),ref[0],ref[7],file=sys.stderr)
