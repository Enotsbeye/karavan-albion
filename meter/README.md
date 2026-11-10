# KaravanMeter — счётчик урона группы

Программа для Windows: читает сетевые пакеты Albion Online (UDP 5055/5056) через Npcap, считает урон, хил и полученный урон каждого участника пати, запоминает снаряжение и отдаёт данные вкладке «Группа» по адресу `http://127.0.0.1:48713/state`. В игру ничего не отправляет.

- Разбор протокола Photon (`photon/`) взят из [albiondata-client](https://github.com/ao-data/albiondata-client), лицензия MIT (см. `photon/LICENSE-albiondata-client`).
- Номера событий и полей сверены с открытым [Statistics Analysis Tool](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis).

Сборка:

```
cd meter
go test ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o KaravanMeter.exe .
```
