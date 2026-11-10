// Караван: счётчик урона группы для Albion Online.
// Слушает сетевые пакеты игры (только чтение), считает урон и хил участников пати
// и отдаёт данные Каравану по адресу http://127.0.0.1:48713/state.
//
// Разбор протокола Photon взят из albiondata-client (MIT, папка photon).
// Номера событий и полей сверены с открытым Statistics Analysis Tool.
package main

import (
	"bufio"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	listenAddr = "127.0.0.1:48713"
	fightIdle  = 20 * time.Second // бой заканчивается, если 20 секунд никто из пати не наносил урон и не лечил

	evLeave                     = 1
	evHealthUpdate              = 6
	evHealthUpdates             = 7
	evNewCharacter              = 29
	evCharacterEquipmentChanged = 90
	evPartyJoined               = 230
	evPartyDisbanded            = 231
	evPartyPlayerJoined         = 232
	evPartyPlayerLeft           = 234
	evTakeSilver                = 62
	evUpdateFame                = 82
	evOtherGrabbedLoot          = 278
	evDied                      = 164
	opJoin                      = 2
	opChangeCluster             = 41
)

var knownEvents = map[uint16]bool{evDied: true, evTakeSilver: true, evUpdateFame: true, evOtherGrabbedLoot: true, evLeave: true, evHealthUpdate: true, evHealthUpdates: true, evNewCharacter: true, evCharacterEquipmentChanged: true, evPartyJoined: true, evPartyDisbanded: true, evPartyPlayerJoined: true, evPartyPlayerLeft: true}

//go:embed items_index.txt
var itemsIndexRaw string
var itemByIndex = map[int]string{}

type player struct {
	ObjectID int64
	Name     string
	Guild    string
	GUID     string
	Equip    []int
}

type stat struct {
	Name     string   `json:"name"`
	Guild    string   `json:"guild"`
	Self     bool     `json:"self"`
	Damage   float64  `json:"damage"`
	Heal     float64  `json:"heal"`
	Taken    float64  `json:"taken"`
	Hits     int      `json:"hits"`
	Equip    []string `json:"equip"`
	FirstHit int64    `json:"firstHit"`
	LastHit  int64    `json:"lastHit"`
}

type fight struct {
	Start   int64            `json:"start"`
	End     int64            `json:"end"`
	Players map[string]*stat `json:"players"`
}

type state struct {
	mu        sync.Mutex
	players   map[int64]*player // objectId → игрок
	byGUID    map[string]int64
	byName    map[string]int64
	party     map[string]string // guid → имя
	selfID    int64
	selfName  string
	selfGUID  string
	cur       *fight
	history   []*fight
	packets   int64
	events    int64
	encrypted int64
	devices   []string
	lastPkt   int64
	visit     *visit
	visits    []*visit
}

// Заход на карту: сколько лута, серебра и славы собрала пати за время на карте
type visit struct {
	Map     string         `json:"map"`
	Start   int64          `json:"start"`
	End     int64          `json:"end"`
	Party   int            `json:"party"`
	Silver  float64        `json:"silver"`
	Fame    float64        `json:"fame"`
	Loot    map[string]int `json:"loot"`
	Deaths  int            `json:"deaths"`  // сколько раз умерли ты или пати
	Kills   int            `json:"kills"`   // сколько игроков убила пати
	PvP     int            `json:"pvp"`     // все смерти игроков, которые были видны на карте
	Players int            `json:"players"` // сколько чужих игроков встретилось на карте
	seen    map[string]bool
}

var st = &state{players: map[int64]*player{}, byGUID: map[string]int64{}, byName: map[string]int64{}, party: map[string]string{}}

func main() {
	log.SetFlags(log.Ltime)
	for _, a := range os.Args[1:] {
		if a == "--log" || a == "-log" {
			openLog()
		}
	}
	loadItems()
	loadVisits()
	fmt.Println("Караван: счётчик урона группы и журнал карт")
	fmt.Println("Не закрывай это окно, пока играешь. Данные смотри во вкладке «Группа» в Караване.")
	if err := startCapture(); err != nil {
		fmt.Println()
		fmt.Println("Не найден Npcap. Установи его с https://npcap.com (галочка «WinPcap API-compatible Mode»), затем запусти программу снова.")
		fmt.Println("Ошибка:", err)
		waitEnter()
		return
	}
	go reaper()
	http.HandleFunc("/state", handleState)
	http.HandleFunc("/reset", handleReset)
	http.HandleFunc("/maps", handleMaps)
	http.HandleFunc("/gi", handleGameinfo)
	fmt.Println("Слушаю сеть. Адрес для Каравана:", "http://"+listenAddr)
	if err := http.ListenAndServe(listenAddr, nil); err != nil {
		fmt.Println("Не удалось открыть порт 48713:", err, "\nВозможно, счётчик уже запущен в другом окне.")
		waitEnter()
	}
}

func waitEnter() {
	fmt.Println("Нажми Enter, чтобы закрыть.")
	bufio.NewReader(os.Stdin).ReadString('\n')
}

func loadItems() {
	for _, line := range strings.Split(itemsIndexRaw, "\n") {
		sp := strings.IndexByte(line, ' ')
		if sp <= 0 {
			continue
		}
		if n, err := strconv.Atoi(line[:sp]); err == nil {
			itemByIndex[n] = strings.TrimSpace(line[sp+1:])
		}
	}
}

/* ---------- приведение типов из Photon ---------- */

func toI64(v interface{}) (int64, bool) {
	switch x := v.(type) {
	case int8:
		return int64(x), true
	case uint8:
		return int64(x), true
	case int16:
		return int64(x), true
	case uint16:
		return int64(x), true
	case int32:
		return int64(x), true
	case uint32:
		return int64(x), true
	case int64:
		return x, true
	case uint64:
		return int64(x), true
	case int:
		return int64(x), true
	case float32:
		return int64(x), true
	case float64:
		return int64(x), true
	}
	return 0, false
}
func toF64(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float32:
		return float64(x), true
	case float64:
		return x, true
	}
	if n, ok := toI64(v); ok {
		return float64(n), true
	}
	return 0, false
}

// Массив любого числового типа → []float64
func toF64s(v interface{}) []float64 {
	switch x := v.(type) {
	case []float32:
		o := make([]float64, len(x))
		for i, a := range x {
			o[i] = float64(a)
		}
		return o
	case []float64:
		return x
	case []int16:
		o := make([]float64, len(x))
		for i, a := range x {
			o[i] = float64(a)
		}
		return o
	case []int32:
		o := make([]float64, len(x))
		for i, a := range x {
			o[i] = float64(a)
		}
		return o
	case []int64:
		o := make([]float64, len(x))
		for i, a := range x {
			o[i] = float64(a)
		}
		return o
	case []byte:
		o := make([]float64, len(x))
		for i, a := range x {
			o[i] = float64(a)
		}
		return o
	case []interface{}:
		o := make([]float64, len(x))
		for i, a := range x {
			o[i], _ = toF64(a)
		}
		return o
	}
	return nil
}
func toInts(v interface{}) []int {
	f := toF64s(v)
	o := make([]int, len(f))
	for i, a := range f {
		o[i] = int(a)
	}
	return o
}
func guidOf(v interface{}) string {
	if mm, ok := v.(map[string]interface{}); ok {
		v = mm["data"]
	}
	switch x := v.(type) {
	case []byte:
		if len(x) == 16 {
			return hex.EncodeToString(x)
		}
	case []int8:
		if len(x) == 16 {
			b := make([]byte, 16)
			for i, a := range x {
				b[i] = byte(a)
			}
			return hex.EncodeToString(b)
		}
	case []interface{}:
		if len(x) == 16 {
			b := make([]byte, 16)
			for i, a := range x {
				n, _ := toI64(a)
				b[i] = byte(n)
			}
			return hex.EncodeToString(b)
		}
	}
	return ""
}
func guidsOf(v interface{}) []string {
	if mm, ok := v.(map[string]interface{}); ok {
		v = mm["data"]
	}
	switch x := v.(type) {
	case []byte:
		var o []string
		for i := 0; i+16 <= len(x); i += 16 {
			o = append(o, hex.EncodeToString(x[i:i+16]))
		}
		return o
	case []interface{}:
		var o []string
		for _, a := range x {
			o = append(o, guidOf(a))
		}
		return o
	}
	return nil
}
func stringsOf(v interface{}) []string {
	switch x := v.(type) {
	case []string:
		return x
	case []interface{}:
		o := make([]string, len(x))
		for i, a := range x {
			o[i], _ = a.(string)
		}
		return o
	}
	return nil
}

func normalize(code uint16, known func(uint16) bool) uint16 {
	if known(code) {
		return code
	}
	if s := (code << 8) | (code >> 8); known(s) {
		return s
	}
	return code
}

/* ---------- события ---------- */

func onRequest(byte, map[byte]interface{}) {}

func onResponse(_ byte, _ int16, _ string, p map[byte]interface{}) {
	c, ok := toI64(p[253])
	if ok {
		logEvent("op", c, c, p)
	}
	if !ok {
		return
	}
	code := normalize(uint16(c), func(x uint16) bool { return x == opJoin || x == opChangeCluster })
	if code == opChangeCluster {
		if mp, ok := p[0].(string); ok && mp != "" {
			st.mu.Lock()
			st.enterMap(mp)
			st.mu.Unlock()
		}
		return
	}
	if code != opJoin {
		return
	}
	if mp, ok := p[8].(string); ok && mp != "" {
		defer func() { st.mu.Lock(); st.enterMap(mp); st.mu.Unlock() }()
	}
	id, ok := toI64(p[0])
	if !ok {
		return
	}
	name, _ := p[2].(string)
	g := guidOf(p[1])
	st.mu.Lock()
	defer st.mu.Unlock()
	st.selfID, st.selfName, st.selfGUID = id, name, g
	pl := st.ensure(id)
	pl.Name, pl.GUID = name, g
	if name != "" {
		st.byName[name] = id
	}
	if g != "" {
		st.byGUID[g] = id
	}
}

func onEvent(code byte, p map[byte]interface{}) {
	c64, ok := toI64(p[252])
	if !ok {
		c64 = int64(code)
	}
	ev := normalize(uint16(c64), func(x uint16) bool { return knownEvents[x] })
	logEvent("ev", int64(ev), c64, p)
	if !knownEvents[ev] {
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	st.events++
	switch ev {
	case evNewCharacter:
		id, ok := toI64(p[0])
		if !ok {
			return
		}
		pl := st.ensure(id)
		pl.Name, _ = p[1].(string)
		pl.Guild, _ = p[8].(string)
		if g := guidOf(p[7]); g != "" {
			pl.GUID = g
			st.byGUID[g] = id
		}
		if pl.Name != "" {
			st.byName[pl.Name] = id
		}
		if eq := toInts(p[40]); len(eq) > 0 {
			pl.Equip = eq
		}
		if pl.Name != "" && !s_isMember(pl.Name) {
			v := st.curVisit()
			if v.seen == nil {
				v.seen = map[string]bool{}
			}
			if !v.seen[pl.Name] {
				v.seen[pl.Name] = true
				v.Players++
			}
		}
	case evCharacterEquipmentChanged:
		id, ok := toI64(p[0])
		if !ok {
			return
		}
		if eq := toInts(p[2]); len(eq) > 0 {
			st.ensure(id).Equip = eq
		}
	case evLeave:
		// объект ушёл из видимости: данные игрока оставляем, чтобы бой досчитался
	case evPartyJoined:
		st.party = map[string]string{}
		gs, ns := guidsOf(p[8]), stringsOf(p[9])
		if len(gs) == 0 || len(ns) == 0 { // старый формат события
			gs, ns = guidsOf(p[4]), stringsOf(p[5])
		}
		for i := 0; i < len(gs) && i < len(ns); i++ {
			if gs[i] != "" && ns[i] != "" {
				st.party[gs[i]] = ns[i]
			}
		}
	case evPartyPlayerJoined:
		if g := guidOf(p[1]); g != "" {
			if n, _ := p[2].(string); n != "" {
				st.party[g] = n
			}
		}
	case evPartyPlayerLeft:
		if g := guidOf(p[1]); g != "" {
			delete(st.party, g)
		}
	case evPartyDisbanded:
		st.party = map[string]string{}
	case evOtherGrabbedLoot:
		looter, _ := p[2].(string)
		if !s_isMember(looter) {
			return
		}
		qty, _ := toI64(p[5])
		if qty <= 0 {
			qty = 1
		}
		v := st.curVisit()
		if silver, _ := p[3].(bool); silver {
			v.Silver += float64(qty)
			return
		}
		idx, _ := toI64(p[4])
		if uid := itemByIndex[int(idx)]; uid != "" && !strings.Contains(uid, "TRASH") {
			v.Loot[uid] += int(qty)
		}
	case evDied:
		died, _ := p[2].(string)
		killer, _ := p[10].(string)
		v := st.curVisit()
		v.PvP++
		if s_isMember(died) {
			v.Deaths++
		} else if s_isMember(killer) {
			v.Kills++
		}
	case evTakeSilver:
		who, _ := toI64(p[0])
		if _, ok := st.member(who); !ok {
			return
		}
		y, _ := toF64(p[3])
		ct, _ := toF64(p[4])
		gt, _ := toF64(p[5])
		if net := (y - ct - gt) / 10000; net > 0 {
			st.curVisit().Silver += net
		}
	case evUpdateFame:
		if f, ok := toF64(p[2]); ok && f > 0 {
			st.curVisit().Fame += f / 10000
		}
	case evHealthUpdate:
		target, _ := toI64(p[0])
		ch, ok := toF64(p[2])
		if !ok {
			return
		}
		causer, _ := toI64(p[6])
		st.hit(target, causer, ch)
	case evHealthUpdates:
		target, _ := toI64(p[0])
		chs := toF64s(p[2])
		causers := toF64s(p[6])
		for i, ch := range chs {
			var cz int64
			if i < len(causers) {
				cz = int64(causers[i])
			}
			st.hit(target, cz, ch)
		}
	}
}

func (s *state) ensure(id int64) *player {
	pl := s.players[id]
	if pl == nil {
		pl = &player{ObjectID: id}
		s.players[id] = pl
	}
	return pl
}

// Член ли объект нашей пати (или мы сами, если пати нет)
func (s *state) member(id int64) (*player, bool) {
	pl := s.players[id]
	if id == 0 || pl == nil {
		return nil, false
	}
	if id == s.selfID {
		return pl, true
	}
	if pl.GUID != "" {
		if _, ok := s.party[pl.GUID]; ok {
			return pl, true
		}
	}
	for _, n := range s.party {
		if n == pl.Name && n != "" {
			return pl, true
		}
	}
	return nil, false
}

func (s *state) hit(target, causer int64, change float64) {
	if change == 0 {
		return
	}
	now := time.Now().UnixMilli()
	var who *player
	if change < 0 {
		if pl, ok := s.member(causer); ok && causer != target {
			who = pl
		}
	} else if pl, ok := s.member(causer); ok {
		who = pl
	}
	victim, victimIn := s.member(target)
	if who == nil && !(change < 0 && victimIn) {
		return
	}
	f := s.fightNow(now)
	if who != nil {
		x := f.stat(who, s.selfID)
		if change < 0 {
			x.Damage += -change
		} else {
			x.Heal += change
		}
		x.Hits++
		if x.FirstHit == 0 {
			x.FirstHit = now
		}
		x.LastHit = now
	}
	if change < 0 && victimIn {
		f.stat(victim, s.selfID).Taken += -change
	}
	f.End = now
}

func (s *state) fightNow(now int64) *fight {
	if s.cur != nil && now-s.cur.End > fightIdle.Milliseconds() {
		s.closeFight()
	}
	if s.cur == nil {
		s.cur = &fight{Start: now, End: now, Players: map[string]*stat{}}
	}
	return s.cur
}

func (f *fight) stat(pl *player, selfID int64) *stat {
	key := pl.Name
	if key == "" {
		key = strconv.FormatInt(pl.ObjectID, 10)
	}
	x := f.Players[key]
	if x == nil {
		x = &stat{Name: key, Guild: pl.Guild, Self: pl.ObjectID == selfID}
		f.Players[key] = x
	}
	if eq := equipNames(pl.Equip); hasAny(eq) {
		x.Equip = eq
	}
	return x
}

func hasAny(eq []string) bool {
	for _, e := range eq {
		if e != "" {
			return true
		}
	}
	return false
}

func equipNames(eq []int) []string {
	o := make([]string, 10)
	for i := 0; i < 10 && i < len(eq); i++ {
		if eq[i] > 0 {
			o[i] = itemByIndex[eq[i]]
		}
	}
	return o
}

func (s *state) closeFight() {
	if s.cur == nil {
		return
	}
	if len(s.cur.Players) > 0 && s.cur.End-s.cur.Start >= 3000 {
		s.history = append([]*fight{s.cur}, s.history...)
		if len(s.history) > 30 {
			s.history = s.history[:30]
		}
	}
	s.cur = nil
}

func reaper() {
	for range time.Tick(2 * time.Second) {
		st.mu.Lock()
		if st.cur != nil && time.Now().UnixMilli()-st.cur.End > fightIdle.Milliseconds() {
			st.closeFight()
		}
		st.mu.Unlock()
	}
}

/* ---------- HTTP для Каравана ---------- */

func cors(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

type partyOut struct {
	Name  string   `json:"name"`
	Seen  bool     `json:"seen"`
	Equip []string `json:"equip"`
}

func handleState(w http.ResponseWriter, r *http.Request) {
	if cors(w, r) {
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	var party []partyOut
	names := map[string]bool{}
	add := func(name string, id int64, ok bool) {
		if name == "" || names[name] {
			return
		}
		names[name] = true
		po := partyOut{Name: name}
		if pl := st.players[id]; ok && pl != nil {
			po.Seen, po.Equip = true, equipNames(pl.Equip)
		}
		party = append(party, po)
	}
	if st.selfName != "" {
		add(st.selfName, st.selfID, true)
	}
	for g, n := range st.party {
		id, ok := st.byGUID[g]
		if !ok {
			id, ok = st.byName[n]
		}
		add(n, id, ok)
	}
	sort.Slice(party, func(i, j int) bool { return party[i].Name < party[j].Name })
	known := map[string][]string{}
	for _, po := range party {
		if po.Seen && hasAny(po.Equip) {
			known[po.Name] = po.Equip
		}
	}
	fill := func(f *fight) {
		if f == nil {
			return
		}
		for name, x := range f.Players {
			if !hasAny(x.Equip) {
				if eq, ok := known[name]; ok {
					x.Equip = eq
				}
			}
		}
	}
	fill(st.cur)
	for _, f := range st.history {
		fill(f)
	}
	out := map[string]interface{}{
		"ok": true, "version": 1, "now": time.Now().UnixMilli(), "self": st.selfName,
		"devices": st.devices, "packets": st.packets, "events": st.events, "encrypted": st.encrypted, "lastPacket": st.lastPkt,
		"party": party, "current": st.cur, "history": st.history,
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(out)
}

func handleReset(w http.ResponseWriter, r *http.Request) {
	if cors(w, r) {
		return
	}
	st.mu.Lock()
	st.closeFight()
	if r.URL.Query().Get("all") == "1" {
		st.history = nil
	}
	st.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

/* ---------- заходы на карты ---------- */

func s_isMember(name string) bool {
	if name == "" {
		return false
	}
	if name == st.selfName {
		return true
	}
	for _, n := range st.party {
		if n == name {
			return true
		}
	}
	return false
}

func (s *state) curVisit() *visit {
	if s.visit == nil {
		s.visit = &visit{Map: "?", Start: time.Now().UnixMilli(), Loot: map[string]int{}}
	}
	if n := len(s.party); n > s.visit.Party {
		s.visit.Party = n
	}
	if s.visit.Party == 0 {
		s.visit.Party = 1
	}
	s.visit.End = time.Now().UnixMilli()
	return s.visit
}

func (s *state) enterMap(mp string) {
	now := time.Now().UnixMilli()
	if s.visit != nil && s.visit.Map == mp {
		return
	}
	if v := s.visit; v != nil {
		v.End = now
		if v.End-v.Start >= 60000 {
			s.visits = append(s.visits, v)
			if len(s.visits) > 3000 {
				s.visits = s.visits[len(s.visits)-3000:]
			}
			saveVisits(s.visits)
		}
	}
	party := len(s.party)
	if party == 0 {
		party = 1
	}
	s.visit = &visit{Map: mp, Start: now, End: now, Party: party, Loot: map[string]int{}}
}

func visitsPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "karavan-maps.json"
	}
	return filepath.Join(filepath.Dir(exe), "karavan-maps.json")
}

func saveVisits(v []*visit) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	tmp := visitsPath() + ".tmp"
	if os.WriteFile(tmp, b, 0644) == nil {
		os.Rename(tmp, visitsPath())
	}
}

func loadVisits() {
	b, err := os.ReadFile(visitsPath())
	if err != nil {
		return
	}
	var v []*visit
	if json.Unmarshal(b, &v) == nil {
		st.visits = v
	}
}

func handleMaps(w http.ResponseWriter, r *http.Request) {
	if cors(w, r) {
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "current": st.visit, "visits": st.visits, "now": time.Now().UnixMilli()})
}

/* ---------- киллборд для мета-сетов: браузер не может обратиться к нему напрямую ---------- */

var giHosts = map[string]string{"europe": "gameinfo-ams.albiononline.com", "west": "gameinfo.albiononline.com", "east": "gameinfo-sgp.albiononline.com"}
var giClient = &http.Client{Timeout: 20 * time.Second}

func handleGameinfo(w http.ResponseWriter, r *http.Request) {
	if cors(w, r) {
		return
	}
	q := r.URL.Query()
	host := giHosts[q.Get("server")]
	if host == "" {
		http.Error(w, "unknown server", http.StatusBadRequest)
		return
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	if limit <= 0 || limit > 51 {
		limit = 51
	}
	if offset < 0 || offset > 10000 {
		offset = 0
	}
	resp, err := giClient.Get(fmt.Sprintf("https://%s/api/gameinfo/events?limit=%d&offset=%d", host, limit, offset))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, io.LimitReader(resp.Body, 8<<20))
}

/* ---------- запись событий для проверки (--log) ---------- */

var (
	logMu   sync.Mutex
	logFile *os.File
	logSize int64
)

const logLimit = 30 << 20 // 30 МБ

func openLog() {
	dir := "."
	if exe, err := os.Executable(); err == nil {
		dir = filepath.Dir(exe)
	}
	name := filepath.Join(dir, "karavan-meter-log-"+time.Now().Format("2006-01-02_15-04")+".jsonl")
	f, err := os.Create(name)
	if err != nil {
		fmt.Println("Не удалось создать лог:", err)
		return
	}
	logFile = f
	fmt.Println("Запись событий включена:", name)
	fmt.Println("Подерись пару минут, затем закрой окно и пришли этот файл.")
}

func logEvent(kind string, code, raw int64, p map[byte]interface{}) {
	if logFile == nil {
		return
	}
	logMu.Lock()
	defer logMu.Unlock()
	if logSize > logLimit {
		return
	}
	q := make(map[string]interface{}, len(p))
	for k, v := range p {
		if k == 252 || k == 253 {
			continue
		}
		if b, ok := v.([]byte); ok && len(b) > 64 {
			v = fmt.Sprintf("bytes(%d)", len(b))
		}
		q[strconv.Itoa(int(k))] = v
	}
	b, err := json.Marshal(map[string]interface{}{"t": time.Now().UnixMilli(), "k": kind, "c": code, "raw": raw, "self": st.selfID, "p": q})
	if err != nil {
		return
	}
	b = append(b, '\n')
	n, _ := logFile.Write(b)
	logSize += int64(n)
}
