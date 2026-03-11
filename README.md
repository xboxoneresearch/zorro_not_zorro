# Zorro A0 Checker

Minimal TypeScript + Vite app to inspect an XBFS dump or sp_s.cfg and detect a SocID of 0x77.

Quick start:

```
npm install
npm run dev
```

Open the site, then drag/drop or click the tile to open a dump file. The app looks for `sp_s.cfg` occurrences and reads a SocID byte.
