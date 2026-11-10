# Программа для Windows

Караван собирается в программу на [Neutralino](https://neutralino.js.org/): около 3 МБ, использует встроенный в Windows движок WebView2.

```
cd desktop
npm i -D @neutralinojs/neu
mkdir -p resources && cp ../index.html resources/index.html
npx neu update
npx neu build
```

Готовые файлы: `dist/Karavan/Karavan-win_x64.exe` и `dist/Karavan/resources.neu`, они должны лежать рядом.
