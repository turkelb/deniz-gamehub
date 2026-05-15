# Deniz Game Hub

Telefonda (Termux) calisan, internetsiz ortamda LAN uzerinden oynanabilen oyun sunucusu.

## Oyunlar

| Oyun | Port | Link |
|------|------|------|
| Ana Sayfa | 8080 | `http://IP:8080` |
| Satranc (Stockfish AI) | 5000 | `http://IP:5000` |
| Dama (Offline AI) | 5001 | `http://IP:5001` |
| Yilan (Multiplayer) | 8080/snake | `http://IP:8080/snake` |

## Termux Kurulum (Android)

### 1. Termux Yuke

[F-Droid'den Termux indir](https://f-droid.org/packages/com.termux/) (Google Play'deki ESKI surum, F-Droid kullan)

### 2. Paketleri yukle

```bash
pkg update
pkg install git python python-pip nodejs wget
```

### 3. Oyunlari indir

```bash
git clone https://github.com/turkelb/deniz-gamehub.git
cd deniz-gamehub
```

### 4. Kur

```bash
bash install.sh
```

### 5. Baslat

```bash
bash start.sh
```

Telefonun Wi-Fi IP adresini goreceksin. Ayni agdaki herkes bu IP'den oyunlara baglanabilir.

### 6. Durdur

```bash
bash stop.sh
```

## Ucakta / Internetsiz Kullanim

1. Telefonda Wi-Fi hotspot ac
2. Termux'ta `bash start.sh` calistir
3. Hotspot'a baglanan herkes IP uzerinden oynayabilir
4. Tum oyunlar tamamen offline calisir (AI: Stockfish / rastgele hamle)

## Not

- Port 5000, 5001, 3000, 8080 kullanir
- Stockfish satranc motoru icin: `pkg install stockfish` (opsiyonel)
- API anahtarlari olmadan AI'lar offline fallback kullanir
