package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"testing"
)

func gb(n byte) []byte { b := make([]byte, 16); b[0] = n; return b }

func TestFightFlow(t *testing.T) {
	loadItems()
	// Вход в игру: я — Enot, объект 100
	onResponse(1, 0, "", map[byte]interface{}{253: int16(2), 0: int64(100), 1: gb(1), 2: "Enot"})
	// Пати: Enot и Diana (guid 1 и 2), новый формат 8/9
	onEvent(1, map[byte]interface{}{252: int16(230), 8: append(gb(1), gb(2)...), 9: []string{"Enot", "Diana"}})
	// Diana появилась рядом: объект 200, гильдия, экипировка (меч T6 и сумка T4)
	onEvent(1, map[byte]interface{}{252: int16(29), 0: int64(200), 1: "Diana", 7: gb(2), 8: "Guild", 40: []int16{8620, 0, 0, 0, 0, 2888, 0, 0, 0, 0}})
	// Чужой игрок 300 — не в пати
	onEvent(1, map[byte]interface{}{252: int16(29), 0: int64(300), 1: "Stranger", 7: gb(3)})
	// Моя экипировка
	onEvent(1, map[byte]interface{}{252: int16(90), 0: int64(100), 2: []int32{8620}})
	// Урон по мобу 999: я 500, Diana 300 (через HealthUpdates), чужой 1000 не считается
	onEvent(1, map[byte]interface{}{252: int16(6), 0: int64(999), 2: float32(-500), 6: int64(100)})
	onEvent(1, map[byte]interface{}{252: int16(7), 0: int64(999), 2: []float32{-100, -200}, 6: []int64{200, 200}})
	onEvent(1, map[byte]interface{}{252: int16(6), 0: int64(999), 2: float32(-1000), 6: int64(300)})
	// Diana лечит меня на 150, по мне бьют на 80
	onEvent(1, map[byte]interface{}{252: int16(6), 0: int64(100), 2: float32(150), 6: int64(200)})
	onEvent(1, map[byte]interface{}{252: int16(6), 0: int64(100), 2: float32(-80), 6: int64(999)})
	// Код события с переставленными байтами (бывает после обновлений): 6 → 0x0600
	onEvent(1, map[byte]interface{}{252: int16(0x0600), 0: int64(999), 2: float32(-50), 6: int64(100)})

	st.mu.Lock()
	f := st.cur
	st.mu.Unlock()
	if f == nil {
		t.Fatal("бой не начался")
	}
	me, di := f.Players["Enot"], f.Players["Diana"]
	if me == nil || di == nil {
		t.Fatalf("нет игроков: %+v", f.Players)
	}
	if me.Damage != 550 || di.Damage != 300 || di.Heal != 150 || me.Taken != 80 {
		t.Fatalf("неверные цифры: я %+v, Диана %+v", me, di)
	}
	if _, ok := f.Players["Stranger"]; ok {
		t.Fatal("чужой игрок попал в счёт")
	}
	if di.Equip[0] != "T6_MAIN_SWORD" || di.Equip[5] != "T4_BAG" || me.Equip[0] != "T6_MAIN_SWORD" {
		t.Fatalf("экипировка: %v / %v", di.Equip, me.Equip)
	}
	// HTTP
	rr := httptest.NewRecorder()
	handleState(rr, httptest.NewRequest("GET", "/state", nil))
	var out map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "*" || out["self"] != "Enot" || len(out["party"].([]interface{})) != 2 {
		t.Fatalf("state: %s", rr.Body.String())
	}
	// Бой закрывается в историю (делаем вид, что прошло 30 секунд)
	st.mu.Lock()
	st.cur.Start -= 60000
	st.cur.End -= 30000
	st.mu.Unlock()
	onEvent(1, map[byte]interface{}{252: int16(6), 0: int64(999), 2: float32(-10), 6: int64(100)})
	st.mu.Lock()
	defer st.mu.Unlock()
	if len(st.history) != 1 || st.cur == nil || st.cur.Players["Enot"].Damage != 10 {
		t.Fatalf("история %d, текущий %+v", len(st.history), st.cur)
	}
	// Игрок ушёл из пати
	st.mu.Unlock()
	onEvent(1, map[byte]interface{}{252: int16(234), 1: gb(2)})
	st.mu.Lock()
	if _, ok := st.party[guidOf(gb(2))]; ok {
		t.Fatal("игрок не удалён из пати")
	}
}

func TestMapsAndLoot(t *testing.T) {
	st.mu.Lock()
	st.visits = nil
	st.visit = nil
	st.mu.Unlock()
	onResponse(1, 0, "", map[byte]interface{}{253: int16(41), 0: "4325"})
	onEvent(1, map[byte]interface{}{252: int16(278), 1: "MOB_X", 2: "Enot", 3: false, 4: int32(8620), 5: int32(2)})
	onEvent(1, map[byte]interface{}{252: int16(278), 1: "MOB_X", 2: "Stranger", 3: false, 4: int32(2888), 5: int32(1)})
	onEvent(1, map[byte]interface{}{252: int16(278), 1: "MOB_X", 2: "Enot", 3: true, 4: int32(0), 5: int32(500)})
	onEvent(1, map[byte]interface{}{252: int16(62), 0: int64(100), 3: int64(20000000), 4: int64(1000000), 5: int64(0)})
	onEvent(1, map[byte]interface{}{252: int16(82), 2: int64(150000000)})
	onEvent(1, map[byte]interface{}{252: int16(29), 0: int64(301), 1: "Ganker1", 7: gb(9)})
	onEvent(1, map[byte]interface{}{252: int16(29), 0: int64(301), 1: "Ganker1", 7: gb(9)})
	onEvent(1, map[byte]interface{}{252: int16(164), 1: int64(100), 2: "Enot", 9: int64(301), 10: "Ganker1"})
	onEvent(1, map[byte]interface{}{252: int16(164), 1: int64(301), 2: "Ganker1", 9: int64(100), 10: "Enot"})
	st.mu.Lock()
	v := st.visit
	if v == nil || v.Map != "4325" || v.Loot["T6_MAIN_SWORD"] != 2 || v.Loot["T4_BAG"] != 0 || v.Silver != 500+1900 || v.Fame != 15000 || v.Players != 1 || v.Deaths != 1 || v.Kills != 1 || v.PvP != 2 {
		st.mu.Unlock()
		t.Fatalf("заход: %+v", v)
	}
	v.Start -= 120000
	st.mu.Unlock()
	onResponse(1, 0, "", map[byte]interface{}{253: int16(41), 0: "0201"})
	st.mu.Lock()
	defer st.mu.Unlock()
	if len(st.visits) != 1 || st.visits[0].Map != "4325" || st.visit.Map != "0201" {
		t.Fatalf("заходы: %d, текущий %+v", len(st.visits), st.visit)
	}
	os.Remove(visitsPath())
}
