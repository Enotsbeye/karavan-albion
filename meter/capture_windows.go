//go:build windows

package main

import (
	"fmt"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcap"

	"karavan/meter/photon"
)

func startCapture() error {
	devs, err := pcap.FindAllDevs()
	if err != nil {
		return err
	}
	if len(devs) == 0 {
		return fmt.Errorf("сетевые адаптеры не найдены")
	}
	for _, d := range devs {
		go capture(d)
	}
	return nil
}

func capture(d pcap.Interface) {
	h, err := pcap.OpenLive(d.Name, 65536, false, pcap.BlockForever)
	if err != nil {
		return
	}
	if err := h.SetBPFFilter("udp port 5056 or udp port 5055"); err != nil {
		h.Close()
		return
	}
	name := d.Description
	if name == "" {
		name = d.Name
	}
	st.mu.Lock()
	st.devices = append(st.devices, name)
	st.mu.Unlock()
	parser := photon.NewPhotonParser(onRequest, onResponse, onEvent)
	parser.OnEncrypted = func() { st.mu.Lock(); st.encrypted++; st.mu.Unlock() }
	src := gopacket.NewPacketSource(h, h.LinkType())
	for pkt := range src.Packets() {
		u := pkt.Layer(layers.LayerTypeUDP)
		if u == nil {
			continue
		}
		payload := u.(*layers.UDP).Payload
		if len(payload) == 0 {
			continue
		}
		st.mu.Lock()
		st.packets++
		st.lastPkt = time.Now().UnixMilli()
		st.mu.Unlock()
		func() {
			defer func() { recover() }() // битый пакет не должен ронять программу
			parser.ReceivePacket(payload)
		}()
	}
}
