import json,re,sys
raw=json.load(open('/home/claude/dl/items_raw.json'))['items']
L=json.load(open('/home/claude/dl/loot.json'))['LootDefinition']['Lootlist']
loot={l['@name']:(l['Item'] if isinstance(l['Item'],list) else [l['Item']]) for l in L if 'Item' in l}
names={}
for x in json.load(open('/home/claude/dl/items_formatted.json')):
    ln=x.get('LocalizedNames') or {}; names[x['UniqueName']]=ln.get('RU-RU') or ln.get('EN-US') or x['UniqueName']
allx={}
for k,v in raw.items():
    if isinstance(v,list):
        for x in v: allx[x['@uniquename']]=x
def avg(a):
    a=str(a); 
    if '-' in a: lo,hi=a.split('-'); return (float(lo)+float(hi))/2
    return float(a)
def lootavg(name,want=None):
    it=loot.get(name,[])
    main=[i for i in it if float(i.get('@chance','1'))>=1]
    return (main[0]['@type'],avg(main[0]['@amount'])) if main else (None,0)
def nm(u): return re.sub(r'\s*\([^)]*\)\s*$','',names.get(u,u)).strip()
plants=[];animals=[];foods={}
for x in raw['farmableitem']:
    u=x['@uniquename']; t=int(x['@tier'])
    if x['@kind']=='plant':
        h=x['harvest']; crop,am=lootavg(h['@lootlist'])
        plants.append(dict(seed=u,crop=crop,name=nm(crop),t=t,kind=x['@shopsubcategory1'],y=am,sc=float(h['seed']['@chance']),fb=float(x.get('@activefarmbonus',0)),fc=float(x.get('@activefarmfocuscost',0)),days=round(float(h['@growtime'])/79200,2)))
    elif x.get('@shopsubcategory2')=='babys' and 'grownitem' in x and 'EASTER' not in u:
        g=x['grownitem']; gid=g['@uniquename']; G=allx.get(gid,{})
        f=x.get('consumption',{}).get('food',{}); af=f.get('acceptedfood',{})
        nutr=float(g['@growtime'])/float(f['@secondspernutrition']) if f.get('@secondspernutrition') else 0
        a=dict(baby=u,grown=gid,name=nm(gid),t=t,kind=x['@shopsubcategory1'],cycles=int(x.get('@activefarmmaxcycles',1)),days=round(float(g['@growtime'])/79200,2),oc=float(g.get('offspring',{}).get('@chance',0)),fb=float(x.get('@activefarmbonus',0)),fc=float(x.get('@activefarmfocuscost',0)),
               cat=af.get('@foodcategory'),fav=af.get('@favorite'),favb=float(af.get('@favoritebonus',0) or 0),nutr=round(nutr,1))
        P=G.get('products',{}).get('product')
        if P:
            pid,pam=lootavg(P['@lootlist'])
            gf=G.get('consumption',{}).get('food',{})
            a['prod']=pid; a['pname']=nm(pid); a['py']=pam; a['pnutr']=round(float(P['@productiontime'])/float(gf['@secondspernutrition']),1) if gf.get('@secondspernutrition') else 0
        animals.append(a)
for u,x in allx.items():
    if x.get('@nutrition') and x.get('@foodcategory') in ('plants','meat') and re.match(r'^T\d_',u):
        foods[u]=[float(x['@nutrition']),x['@foodcategory']]
db=json.load(open('db.json',encoding='utf-8'))
db['farm']={'plants':plants,'animals':animals,'foods':foods}
json.dump(db,open('db.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print(len(plants),len(animals),len(foods),file=sys.stderr)
for p in plants[:3]+plants[8:10]: print(p,file=sys.stderr)
for a in animals:
    if a['baby'] in('T4_FARM_GOAT_BABY','T6_FARM_OX_BABY','T5_FARM_COUGAR_BABY','T8_FARM_COW_BABY','T5_FARM_RAM_FW_MARTLOCK_BABY'): print(a,file=sys.stderr)
print(sorted(foods.items())[:12],file=sys.stderr)
